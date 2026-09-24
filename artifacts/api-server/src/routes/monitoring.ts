import { Router } from "express";
import { db } from "@workspace/db";
import { hostsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth.js";
import { getLatestStatuses, triggerCycle } from "../lib/monitoring.js";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/monitoring/statuses", requireAuth, async (_req, res) => {
  const statuses = await getLatestStatuses();
  res.json(statuses);
});

router.get("/monitoring/summary", requireAuth, async (_req, res) => {
  const statuses = await getLatestStatuses();
  const allHosts = await db.select().from(hostsTable);

  const enabledIds = new Set(allHosts.filter((h) => h.enabled).map((h) => h.id));
  const enabledStatuses = statuses.filter((s) => enabledIds.has(s.hostId));

  const pcs = allHosts.filter((h) => h.type === "pc");
  const servers = allHosts.filter((h) => h.type === "server");
  const pcIds = new Set(pcs.map((h) => h.id));
  const serverIds = new Set(servers.map((h) => h.id));

  const online = enabledStatuses.filter((s) => s.status === "online").length;
  const offline = enabledStatuses.filter((s) => s.status === "offline").length;
  const unknown = enabledStatuses.filter((s) => s.status === "unknown").length;

  const pcStatuses = enabledStatuses.filter((s) => pcIds.has(s.hostId));
  const serverStatuses = enabledStatuses.filter((s) => serverIds.has(s.hostId));

  res.json({
    total: enabledStatuses.length,
    online,
    offline,
    unknown,
    pcTotal: pcs.filter((h) => h.enabled).length,
    pcOnline: pcStatuses.filter((s) => s.status === "online").length,
    serverTotal: servers.filter((h) => h.enabled).length,
    serverOnline: serverStatuses.filter((s) => s.status === "online").length,
  });
});

router.post("/monitoring/trigger", requireAuth, async (_req, res) => {
  triggerCycle().catch(() => {});
  res.json({ message: "Ciclo de monitoramento iniciado" });
});

export default router;
