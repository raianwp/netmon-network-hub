import { db } from "@workspace/db";
import { hostsTable, hostMetricsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "./logger.js";
import { getSettingsFromDb } from "../routes/settings.js";

// ---------------------------------------------------------------------------
// Prometheus text-exposition-format parser (windows_exporter output).
// Trivial line format: `metric_name{label="val",...} value`, comments start
// with '#'. No need for a parsing library for this.
// ---------------------------------------------------------------------------
export interface PrometheusSample {
  labels: Record<string, string>;
  value: number;
}

export function parsePrometheusText(text: string): Map<string, PrometheusSample[]> {
  const result = new Map<string, PrometheusSample[]>();

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const braceIdx = trimmed.indexOf("{");
    let name: string;
    let labelsStr = "";
    let rest: string;

    if (braceIdx === -1) {
      const spaceIdx = trimmed.indexOf(" ");
      if (spaceIdx === -1) continue;
      name = trimmed.slice(0, spaceIdx);
      rest = trimmed.slice(spaceIdx + 1).trim();
    } else {
      name = trimmed.slice(0, braceIdx);
      const closeIdx = trimmed.indexOf("}", braceIdx);
      if (closeIdx === -1) continue;
      labelsStr = trimmed.slice(braceIdx + 1, closeIdx);
      rest = trimmed.slice(closeIdx + 1).trim();
    }

    const value = parseFloat(rest.split(" ")[0]);
    if (Number.isNaN(value)) continue;

    const labels: Record<string, string> = {};
    if (labelsStr) {
      const labelRegex = /(\w+)="((?:[^"\\]|\\.)*)"/g;
      let m: RegExpExecArray | null;
      while ((m = labelRegex.exec(labelsStr)) !== null) {
        labels[m[1]] = m[2].replace(/\\"/g, '"');
      }
    }

    const arr = result.get(name);
    if (arr) arr.push({ labels, value });
    else result.set(name, [{ labels, value }]);
  }

  return result;
}

async function fetchAgentMetrics(ip: string, port: number): Promise<string> {
  const response = await fetch(`http://${ip}:${port}/metrics`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    throw new Error(`Agent HTTP ${response.status} ${response.statusText}`);
  }
  return response.text();
}

// ---------------------------------------------------------------------------
// windows_exporter's exact metric names drift a bit across versions/builds,
// so instead of betting on a single name we try a short list of known
// candidates in priority order and use whichever is actually present.
// ---------------------------------------------------------------------------
function firstMetric(parsed: Map<string, PrometheusSample[]>, names: string[]): PrometheusSample[] | undefined {
  for (const name of names) {
    const samples = parsed.get(name);
    if (samples && samples.length > 0) return samples;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// CPU is exposed as a monotonic counter (seconds spent per mode since boot),
// not a gauge, so the percentage only exists from the 2nd scrape of a host
// onward (needs a delta between two samples). Same in-memory-Map idiom as
// `consecutiveFailures` in monitoring.ts. Per-process CPU works the same way,
// keyed by hostId+process+pid since a PID can be reused across restarts.
// ---------------------------------------------------------------------------
interface CpuSample {
  idleSeconds: number;
  totalSeconds: number;
}

const previousCpuSamples = new Map<number, CpuSample>();
const previousProcessCpuSamples = new Map<string, { cpuSeconds: number; sampledAt: number }>();

export interface ExtractedProcess {
  name: string;
  running: boolean;
  cpuPercent: number | null;
  memBytes: number | null;
}

export interface ExtractedSample {
  cpuPercent: number | null;
  cpuModel: string | null;
  memUsedBytes: number | null;
  memTotalBytes: number | null;
  uptimeSeconds: number | null;
  osVersion: string | null;
  processes: ExtractedProcess[];
}

export function extractHostSample(
  hostId: number,
  parsed: Map<string, PrometheusSample[]>,
): ExtractedSample {
  let cpuPercent: number | null = null;
  const cpuTimeTotal = parsed.get("windows_cpu_time_total");
  if (cpuTimeTotal && cpuTimeTotal.length > 0) {
    let idleSeconds = 0;
    let totalSeconds = 0;
    for (const sample of cpuTimeTotal) {
      totalSeconds += sample.value;
      if (sample.labels.mode === "idle") idleSeconds += sample.value;
    }
    const prev = previousCpuSamples.get(hostId);
    if (prev) {
      const deltaTotal = totalSeconds - prev.totalSeconds;
      const deltaIdle = idleSeconds - prev.idleSeconds;
      if (deltaTotal > 0) {
        cpuPercent = Math.max(0, Math.min(100, 100 * (1 - deltaIdle / deltaTotal)));
      }
    }
    previousCpuSamples.set(hostId, { idleSeconds, totalSeconds });
  }

  let cpuModel: string | null = null;
  const cpuInfo = firstMetric(parsed, ["windows_cpu_info"]);
  if (cpuInfo) cpuModel = cpuInfo[0].labels.name ?? cpuInfo[0].labels.model ?? null;

  // Total physical RAM and free RAM both come from the `os` collector (not
  // `cs`/`memory`), which is what NetMon asks users to enable.
  let memTotalBytes: number | null = null;
  const memTotal = firstMetric(parsed, [
    "windows_os_visible_memory_bytes",
    "windows_cs_physical_memory_bytes",
    "windows_memory_physical_total_bytes",
  ]);
  if (memTotal) memTotalBytes = memTotal[0].value;

  let memFreeBytes: number | null = null;
  const memFree = firstMetric(parsed, [
    "windows_os_physical_memory_free_bytes",
    "windows_memory_available_bytes",
  ]);
  if (memFree) memFreeBytes = memFree[0].value;

  const memUsedBytes =
    memTotalBytes != null && memFreeBytes != null
      ? Math.max(0, memTotalBytes - memFreeBytes)
      : null;

  let uptimeSeconds: number | null = null;
  const upTime = firstMetric(parsed, [
    "windows_system_boot_time_timestamp",
    "windows_system_boot_time_timestamp_seconds",
    "windows_system_system_up_time",
  ]);
  if (upTime) {
    uptimeSeconds = Math.max(0, Date.now() / 1000 - upTime[0].value);
  }

  let osVersion: string | null = null;
  const osInfo = parsed.get("windows_os_info");
  if (osInfo && osInfo.length > 0) {
    const labels = osInfo[0].labels;
    osVersion = labels.product ?? labels.version ?? labels.build_number ?? null;
  }

  // Process collector: gather every metric per process (memory is a gauge,
  // CPU is a monotonic counter needing the same delta trick as host CPU).
  const processMem = new Map<string, number>();
  const processCpuTotalNow = new Map<string, number>();
  for (const [metricName, samples] of parsed) {
    if (!metricName.startsWith("windows_process_")) continue;
    for (const sample of samples) {
      const name = sample.labels.process;
      const pid = sample.labels.process_id ?? "";
      if (!name) continue;
      const key = `${name}:${pid}`;
      if (metricName === "windows_process_working_set_private_bytes") {
        processMem.set(key, sample.value);
      } else if (metricName === "windows_process_cpu_time_total") {
        processCpuTotalNow.set(key, (processCpuTotalNow.get(key) ?? 0) + sample.value);
      }
    }
  }

  const processes: ExtractedProcess[] = [];
  const seen = new Set<string>();
  for (const [metricName, samples] of parsed) {
    if (!metricName.startsWith("windows_process_")) continue;
    for (const sample of samples) {
      const name = sample.labels.process;
      const pid = sample.labels.process_id ?? "";
      if (!name || seen.has(`${name}:${pid}`)) continue;
      seen.add(`${name}:${pid}`);

      const key = `${name}:${pid}`;
      const stateKey = `${hostId}:${key}`;
      let cpuPercentProc: number | null = null;
      const cpuNow = processCpuTotalNow.get(key);
      const now = Date.now();
      if (cpuNow != null) {
        const prev = previousProcessCpuSamples.get(stateKey);
        if (prev && cpuNow >= prev.cpuSeconds) {
          const elapsedSeconds = (now - prev.sampledAt) / 1000;
          if (elapsedSeconds > 0) {
            cpuPercentProc = Math.max(0, Math.min(100, ((cpuNow - prev.cpuSeconds) / elapsedSeconds) * 100));
          }
        }
        previousProcessCpuSamples.set(stateKey, { cpuSeconds: cpuNow, sampledAt: now });
      }

      processes.push({
        name,
        running: true,
        cpuPercent: cpuPercentProc,
        memBytes: processMem.get(key) ?? null,
      });
    }
  }

  return { cpuPercent, cpuModel, memUsedBytes, memTotalBytes, uptimeSeconds, osVersion, processes };
}

export async function checkAgentHost(hostId: number, ip: string, port: number): Promise<void> {
  try {
    const text = await fetchAgentMetrics(ip, port);
    const parsed = parsePrometheusText(text);
    const sample = extractHostSample(hostId, parsed);
    const now = new Date();

    const row = {
      collectedAt: now,
      cpuPercent: sample.cpuPercent,
      cpuModel: sample.cpuModel,
      memUsedBytes: sample.memUsedBytes,
      memTotalBytes: sample.memTotalBytes,
      uptimeSeconds: sample.uptimeSeconds != null ? Math.round(sample.uptimeSeconds) : null,
      osVersion: sample.osVersion,
      scrapeOk: true,
      processesJson: JSON.stringify(sample.processes),
    };

    await db.insert(hostMetricsTable).values({ hostId, ...row })
      .onConflictDoUpdate({ target: hostMetricsTable.hostId, set: row });
  } catch (err) {
    logger.warn({ err, hostId, ip, port }, "Agent scrape failed");
    // Keep whatever was last collected successfully — only flip the flag so
    // the dialog shows "sem resposta" instead of wiping known-good values.
    await db.insert(hostMetricsTable).values({ hostId, scrapeOk: false })
      .onConflictDoUpdate({ target: hostMetricsTable.hostId, set: { scrapeOk: false } });
  }
}

async function runAgentMonitoringCycle(): Promise<void> {
  const hosts = await db
    .select()
    .from(hostsTable)
    .where(and(eq(hostsTable.enabled, true), eq(hostsTable.agentEnabled, true)));

  if (hosts.length === 0) return;

  logger.info({ count: hosts.length }, "Starting agent monitoring cycle");

  for (const host of hosts) {
    await checkAgentHost(host.id, host.ipAddress, host.agentPort ?? 9182);
  }

  logger.info("Agent monitoring cycle complete");
}

let agentMonitoringTimer: NodeJS.Timeout | null = null;

function reschedule(): void {
  if (agentMonitoringTimer) clearTimeout(agentMonitoringTimer);
  getSettingsFromDb().then((settings) => {
    agentMonitoringTimer = setTimeout(async () => {
      await runAgentMonitoringCycle();
      reschedule();
    }, settings.agentCheckIntervalSeconds * 1000);
  });
}

export function startAgentMonitoring(): void {
  logger.info("Starting agent monitoring service (windows_exporter scraper)");
  reschedule();
  runAgentMonitoringCycle().catch((err) => logger.error({ err }, "Initial agent monitoring cycle failed"));
}
