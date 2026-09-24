import { Router } from "express";
import { db } from "@workspace/db";
import { hostsTable, hostMetricsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";
import { logger } from "../lib/logger.js";
import { parsePrometheusText, extractHostSample, checkAgentHost } from "../lib/agent-monitoring.js";

const router = Router();

function serializeMetric(m: typeof hostMetricsTable.$inferSelect) {
  return {
    id: m.id,
    hostId: m.hostId,
    collectedAt: m.collectedAt.toISOString(),
    cpuPercent: m.cpuPercent,
    cpuModel: m.cpuModel,
    memUsedBytes: m.memUsedBytes,
    memTotalBytes: m.memTotalBytes,
    uptimeSeconds: m.uptimeSeconds,
    osVersion: m.osVersion,
    scrapeOk: m.scrapeOk,
    processes: m.processesJson ? JSON.parse(m.processesJson) : [],
  };
}

router.get("/hosts/:id/agent/latest", requireAuth, async (req, res) => {
  const hostId = Number(req.params.id);
  if (!Number.isInteger(hostId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [row] = await db
    .select()
    .from(hostMetricsTable)
    .where(eq(hostMetricsTable.hostId, hostId))
    .limit(1);

  if (!row) { res.status(404).json({ error: "No metrics collected yet for this host" }); return; }
  res.json(serializeMetric(row));
});

router.post("/hosts/:id/agent/refresh", requireAuth, async (req, res) => {
  const hostId = Number(req.params.id);
  if (!Number.isInteger(hostId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [host] = await db.select().from(hostsTable).where(eq(hostsTable.id, hostId)).limit(1);
  if (!host) { res.status(404).json({ error: "Host not found" }); return; }

  await checkAgentHost(hostId, host.ipAddress, host.agentPort ?? 9182);

  const [row] = await db
    .select()
    .from(hostMetricsTable)
    .where(eq(hostMetricsTable.hostId, hostId))
    .limit(1);

  if (!row) { res.status(404).json({ error: "No metrics collected yet for this host" }); return; }
  res.json(serializeMetric(row));
});

router.get("/hosts/:id/agent/test", requireAuth, async (req, res) => {
  const hostId = Number(req.params.id);
  if (!Number.isInteger(hostId)) { res.status(400).json({ ok: false, error: "Invalid id" }); return; }

  const [host] = await db.select().from(hostsTable).where(eq(hostsTable.id, hostId)).limit(1);
  if (!host) { res.status(404).json({ ok: false, error: "Host not found" }); return; }

  const ip = typeof req.query.ip === "string" ? req.query.ip : host.ipAddress;
  const portRaw = req.query.port;
  const port = typeof portRaw === "string" && Number(portRaw) > 0 ? Number(portRaw) : (host.agentPort ?? 9182);
  const url = `http://${ip}:${port}/metrics`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      res.json({ ok: false, url, statusCode: response.status, error: `HTTP ${response.status} ${response.statusText}` });
      return;
    }
    const text = await response.text();
    const parsed = parsePrometheusText(text);
    const sample = extractHostSample(hostId, parsed);
    res.json({ ok: true, url, statusCode: response.status, sample });
  } catch (err: unknown) {
    logger.warn({ err, url }, "Agent test scrape failed");
    const msg = err instanceof Error ? err.message : String(err);
    res.json({ ok: false, url, error: msg });
  }
});

export default router;
