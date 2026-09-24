import { Router } from "express";
import { db } from "@workspace/db";
import { settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { UpdateSettingsBody } from "@workspace/api-zod";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";

const router = Router();

const DEFAULTS = {
  checkIntervalSeconds: 120,
  pingAttempts: 3,
  pingTimeoutMs: 1000,
  failuresBeforeOffline: 3,
  backupIntervalHours: 24,
  notificationDurationSeconds: 10,
  agentCheckIntervalSeconds: 60,
  internetCheckEnabled: true,
  internetCheckIntervalSeconds: 120,
  internetCheckHosts: ["8.8.8.8", "1.1.1.1"],
  internetCheckNotifyDesktop: false,
};

export async function getSettingsFromDb() {
  const rows = await db.select().from(settingsTable);
  const map: Record<string, string> = {};
  for (const row of rows) map[row.key] = row.value;

  let internetCheckHosts: string[] = DEFAULTS.internetCheckHosts;
  try {
    if (map["internetCheckHosts"]) {
      internetCheckHosts = JSON.parse(map["internetCheckHosts"]) as string[];
    }
  } catch { /* keep defaults */ }

  return {
    checkIntervalSeconds: parseInt(map["checkIntervalSeconds"] ?? String(DEFAULTS.checkIntervalSeconds)),
    pingAttempts: parseInt(map["pingAttempts"] ?? String(DEFAULTS.pingAttempts)),
    pingTimeoutMs: parseInt(map["pingTimeoutMs"] ?? String(DEFAULTS.pingTimeoutMs)),
    failuresBeforeOffline: parseInt(map["failuresBeforeOffline"] ?? String(DEFAULTS.failuresBeforeOffline)),
    backupIntervalHours: parseInt(map["backupIntervalHours"] ?? String(DEFAULTS.backupIntervalHours)),
    notificationDurationSeconds: parseInt(map["notificationDurationSeconds"] ?? String(DEFAULTS.notificationDurationSeconds)),
    agentCheckIntervalSeconds: parseInt(map["agentCheckIntervalSeconds"] ?? String(DEFAULTS.agentCheckIntervalSeconds)),
    internetCheckEnabled: (map["internetCheckEnabled"] ?? "true") === "true",
    internetCheckIntervalSeconds: parseInt(map["internetCheckIntervalSeconds"] ?? String(DEFAULTS.internetCheckIntervalSeconds)),
    internetCheckHosts,
    internetCheckNotifyDesktop: (map["internetCheckNotifyDesktop"] ?? "false") === "true",
  };
}

router.get("/settings", requireAuth, async (_req, res) => {
  const settings = await getSettingsFromDb();
  res.json(settings);
});

router.put("/settings", requireAdmin, async (req, res) => {
  const parsed = UpdateSettingsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const d = parsed.data;

  const updates: { key: string; value: string }[] = [];
  if (d.checkIntervalSeconds != null) updates.push({ key: "checkIntervalSeconds", value: String(d.checkIntervalSeconds) });
  if (d.pingAttempts != null) updates.push({ key: "pingAttempts", value: String(d.pingAttempts) });
  if (d.pingTimeoutMs != null) updates.push({ key: "pingTimeoutMs", value: String(d.pingTimeoutMs) });
  if (d.failuresBeforeOffline != null) updates.push({ key: "failuresBeforeOffline", value: String(d.failuresBeforeOffline) });
  if (d.backupIntervalHours != null) updates.push({ key: "backupIntervalHours", value: String(d.backupIntervalHours) });
  if (d.notificationDurationSeconds != null) updates.push({ key: "notificationDurationSeconds", value: String(d.notificationDurationSeconds) });
  if (d.agentCheckIntervalSeconds != null) updates.push({ key: "agentCheckIntervalSeconds", value: String(d.agentCheckIntervalSeconds) });
  if (d.internetCheckEnabled != null) updates.push({ key: "internetCheckEnabled", value: String(d.internetCheckEnabled) });
  if (d.internetCheckIntervalSeconds != null) updates.push({ key: "internetCheckIntervalSeconds", value: String(d.internetCheckIntervalSeconds) });
  if (d.internetCheckHosts != null) updates.push({ key: "internetCheckHosts", value: JSON.stringify(d.internetCheckHosts) });
  if (d.internetCheckNotifyDesktop != null) updates.push({ key: "internetCheckNotifyDesktop", value: String(d.internetCheckNotifyDesktop) });

  for (const update of updates) {
    await db.insert(settingsTable).values(update)
      .onConflictDoUpdate({ target: settingsTable.key, set: { value: update.value } });
  }

  const settings = await getSettingsFromDb();
  res.json(settings);
});

export default router;
