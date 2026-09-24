import { Router } from "express";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";
import { runBackup, getBackupStatus } from "../lib/backup.js";
import { logger } from "../lib/logger.js";

const router = Router();

router.get("/backup/status", requireAuth, async (_req, res) => {
  try {
    const status = await getBackupStatus();
    res.json(status);
  } catch (err) {
    logger.error({ err }, "Failed to get backup status");
    res.status(500).json({ error: "Failed to get backup status" });
  }
});

router.post("/backup/run", requireAdmin, async (_req, res) => {
  const result = await runBackup();
  res.status(result.ok ? 200 : 500).json(result);
});

export default router;
