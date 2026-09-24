import { exec } from "child_process";
import { promisify } from "util";
import { db } from "@workspace/db";
import { hostsTable, hostStatusesTable } from "@workspace/db";
import { eq, gte, and, sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { getSettingsFromDb } from "../routes/settings.js";

const execAsync = promisify(exec);

interface PingResult {
  alive: boolean;
  responseTimeMs?: number;
}

async function pingHost(ip: string, timeoutMs: number): Promise<PingResult> {
  try {
    const start = Date.now();
    const isWindows = process.platform === "win32";
    const cmd = isWindows
      ? `ping -n 1 -w ${timeoutMs} ${ip}`
      : `ping -c 1 -W ${Math.ceil(timeoutMs / 1000)} ${ip}`;

    await execAsync(cmd, { timeout: timeoutMs + 2000 });
    return { alive: true, responseTimeMs: Date.now() - start };
  } catch {
    return { alive: false };
  }
}

const consecutiveFailures: Map<number, number> = new Map();
const previousReportedStatus: Map<number, "online" | "offline"> = new Map();

async function checkHost(hostId: number, ip: string, attempts: number, timeoutMs: number, failuresBeforeOffline: number): Promise<void> {
  let alive = false;
  let responseTimeMs: number | undefined;

  for (let i = 0; i < attempts; i++) {
    const result = await pingHost(ip, timeoutMs);
    if (result.alive) {
      alive = true;
      responseTimeMs = result.responseTimeMs;
      break;
    }
  }

  const prev = consecutiveFailures.get(hostId) ?? 0;
  let newFailures: number;
  let status: "online" | "offline";

  if (alive) {
    newFailures = 0;
    status = "online";
  } else {
    newFailures = prev + 1;
    status = newFailures >= failuresBeforeOffline ? "offline" : "online";
  }

  consecutiveFailures.set(hostId, newFailures);

  const prevStatus = previousReportedStatus.get(hostId);
  const now = new Date();

  if (prevStatus !== status) {
    if (status === "online") {
      await db.update(hostsTable).set({ lastWentOnlineAt: now }).where(eq(hostsTable.id, hostId));
    } else {
      await db.update(hostsTable).set({ lastWentOfflineAt: now }).where(eq(hostsTable.id, hostId));
    }
    previousReportedStatus.set(hostId, status);
  } else if (prevStatus === undefined) {
    previousReportedStatus.set(hostId, status);
  }

  await db.insert(hostStatusesTable).values({
    hostId,
    status,
    responseTimeMs: responseTimeMs ?? null,
    consecutiveFailures: newFailures,
  });
}

async function runMonitoringCycle(): Promise<void> {
  const settings = await getSettingsFromDb();
  const hosts = await db.select().from(hostsTable).where(eq(hostsTable.enabled, true));

  logger.info({ count: hosts.length }, "Starting monitoring cycle");

  for (const host of hosts) {
    try {
      await checkHost(host.id, host.ipAddress, settings.pingAttempts, settings.pingTimeoutMs, settings.failuresBeforeOffline);
    } catch (err) {
      logger.error({ err, hostId: host.id, ip: host.ipAddress }, "Error checking host");
    }
  }

  logger.info("Monitoring cycle complete");
}

let monitoringTimer: NodeJS.Timeout | null = null;

export async function triggerCycle(): Promise<void> {
  await runMonitoringCycle();
  reschedule();
}

function reschedule(): void {
  if (monitoringTimer) clearTimeout(monitoringTimer);
  getSettingsFromDb().then((settings) => {
    monitoringTimer = setTimeout(async () => {
      await runMonitoringCycle();
      reschedule();
    }, settings.checkIntervalSeconds * 1000);
  });
}

export function startMonitoring(): void {
  logger.info("Starting monitoring service");
  reschedule();
  runMonitoringCycle().catch((err) => logger.error({ err }, "Initial monitoring cycle failed"));
}

// ---------------------------------------------------------------------------
// Prune old host_statuses records
// Keeps at most 5 days of history, but ALWAYS preserves the most recent record
// per host so hosts that haven't changed state in a long time are not lost.
// ---------------------------------------------------------------------------
export async function pruneOldStatuses(): Promise<number> {
  try {
    const result = await db.execute(sql`
      WITH latest AS (
        SELECT DISTINCT ON (host_id) id
        FROM host_statuses
        ORDER BY host_id, checked_at DESC
      )
      DELETE FROM host_statuses
      WHERE checked_at < NOW() - INTERVAL '5 days'
        AND id NOT IN (SELECT id FROM latest)
    `);
    const deleted = result.rowCount ?? 0;
    if (deleted > 0) {
      logger.info({ deleted }, "Pruned old host_statuses records");
    }
    return deleted;
  } catch (err) {
    logger.error({ err }, "Failed to prune old host_statuses");
    return 0;
  }
}

export function startPruneScheduler(): void {
  const INTERVAL_MS = 24 * 60 * 60 * 1000; // run once per day

  // First run: 60 seconds after startup so the app is fully ready
  setTimeout(async () => {
    logger.info("Running initial host_statuses prune");
    await pruneOldStatuses();
  }, 60 * 1000);

  setInterval(async () => {
    logger.info("Running scheduled host_statuses prune");
    await pruneOldStatuses();
  }, INTERVAL_MS);

  logger.info("Prune scheduler started (retention: 5 days)");
}

// ---------------------------------------------------------------------------
// getLatestStatuses — rewritten to use 2 batch queries instead of N+1 loop
// ---------------------------------------------------------------------------
export async function getLatestStatuses(): Promise<Array<{
  hostId: number;
  status: "online" | "offline" | "unknown";
  checkedAt: string | null;
  responseTimeMs: number | null;
  consecutiveFailures: number;
  lastOnlineAt: string | null;
  lastOfflineAt: string | null;
  uptimePercent24h: number | null;
}>> {
  // 1. Latest status per host using DISTINCT ON (uses the index efficiently)
  const latestRows = await db.execute<{
    host_id: number;
    status: "online" | "offline" | "unknown";
    checked_at: Date;
    response_time_ms: number | null;
    consecutive_failures: number;
    last_went_online_at: Date | null;
    last_went_offline_at: Date | null;
  }>(sql`
    SELECT DISTINCT ON (hs.host_id)
      hs.host_id,
      hs.status,
      hs.checked_at,
      hs.response_time_ms,
      hs.consecutive_failures,
      h.last_went_online_at,
      h.last_went_offline_at
    FROM host_statuses hs
    JOIN hosts h ON h.id = hs.host_id
    ORDER BY hs.host_id, hs.checked_at DESC
  `);

  // 2. 24h uptime counts per host (single aggregation query)
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const uptimeRows = await db.select({
    hostId: hostStatusesTable.hostId,
    total: sql<number>`count(*)::int`,
    online: sql<number>`sum(case when ${hostStatusesTable.status} = 'online' then 1 else 0 end)::int`,
  })
    .from(hostStatusesTable)
    .where(and(gte(hostStatusesTable.checkedAt, since24h)))
    .groupBy(hostStatusesTable.hostId);

  const uptimeMap = new Map<number, { total: number; online: number }>();
  for (const row of uptimeRows) {
    uptimeMap.set(row.hostId, { total: row.total, online: row.online });
  }

  // 3. Fetch all hosts to cover ones that have never been checked
  const allHosts = await db.select({ id: hostsTable.id }).from(hostsTable);
  const latestMap = new Map<number, typeof latestRows.rows[number]>();
  for (const row of latestRows.rows) {
    latestMap.set(row.host_id, row);
  }

  return allHosts.map((host) => {
    const latest = latestMap.get(host.id);
    const uptime = uptimeMap.get(host.id);
    const total = uptime?.total ?? 0;
    const online = uptime?.online ?? 0;
    return {
      hostId: host.id,
      status: (latest?.status ?? "unknown") as "online" | "offline" | "unknown",
      checkedAt: latest?.checked_at ? new Date(latest.checked_at).toISOString() : null,
      responseTimeMs: latest?.response_time_ms ?? null,
      consecutiveFailures: latest?.consecutive_failures ?? 0,
      lastOnlineAt: latest?.last_went_online_at ? new Date(latest.last_went_online_at).toISOString() : null,
      lastOfflineAt: latest?.last_went_offline_at ? new Date(latest.last_went_offline_at).toISOString() : null,
      uptimePercent24h: total > 0 ? Math.round((online / total) * 100) : null,
    };
  });
}
