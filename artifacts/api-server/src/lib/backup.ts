import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import { logger } from "./logger.js";
import { db } from "@workspace/db";
import { settingsTable } from "@workspace/db";

const execAsync = promisify(exec);

export function getBackupDir(): string {
  return process.env["BACKUP_DIR"] ?? "/opt/netmon/backups";
}

async function clearOldBackups(dir: string): Promise<void> {
  try {
    const files = await fs.readdir(dir);
    for (const f of files) {
      if (f.startsWith("netmon_backup_") || f.startsWith("netmon_env_")) {
        await fs.rm(path.join(dir, f), { force: true });
      }
    }
  } catch {
    // Directory may not exist yet — ignore
  }
}

export async function runBackup(): Promise<{ ok: boolean; path: string; message: string }> {
  const dir = getBackupDir();
  const now = new Date();
  const stamp = now.toISOString().replace(/T/, "_").replace(/:/g, "-").slice(0, 19);

  try {
    await fs.mkdir(dir, { recursive: true });
    await clearOldBackups(dir);

    const dbUrl = process.env["DATABASE_URL"] ?? "";
    const dbFile = path.join(dir, `netmon_backup_${stamp}.sql`);

    await execAsync(`pg_dump "${dbUrl}" -f "${dbFile}"`);

    const envSrc = process.env["ENV_FILE_PATH"] ?? "/opt/netmon/.env";
    const envDst = path.join(dir, `netmon_env_${stamp}`);
    try {
      await fs.copyFile(envSrc, envDst);
    } catch {
      // .env may not exist in dev — not fatal
    }

    await db.insert(settingsTable)
      .values({ key: "backup_last_at", value: now.toISOString() })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value: now.toISOString() } });

    logger.info({ path: dbFile }, "Backup completed");
    return { ok: true, path: dir, message: `Backup salvo em ${dir}` };
  } catch (err) {
    logger.error({ err }, "Backup failed");
    return { ok: false, path: dir, message: `Erro no backup: ${String(err)}` };
  }
}

export async function getBackupStatus(): Promise<{
  lastBackupAt: string | null;
  nextBackupAt: string | null;
  backupDir: string;
  intervalHours: number;
}> {
  const rows = await db.select().from(settingsTable);
  const map: Record<string, string> = {};
  for (const row of rows) map[row.key] = row.value;

  const lastAt = map["backup_last_at"] ?? null;
  const intervalHours = parseInt(map["backupIntervalHours"] ?? "24");
  const nextAt = lastAt
    ? new Date(new Date(lastAt).getTime() + intervalHours * 3600 * 1000).toISOString()
    : null;

  return { lastBackupAt: lastAt, nextBackupAt: nextAt, backupDir: getBackupDir(), intervalHours };
}

export function startBackupScheduler(): void {
  const CHECK_INTERVAL_MS = 5 * 60 * 1000; // check every 5 min

  const checkAndBackup = async () => {
    try {
      const status = await getBackupStatus();
      const now = Date.now();
      const lastAt = status.lastBackupAt ? new Date(status.lastBackupAt).getTime() : 0;
      const intervalMs = status.intervalHours * 3600 * 1000;
      if (now - lastAt >= intervalMs) {
        logger.info("Starting scheduled backup");
        await runBackup();
      }
    } catch (err) {
      logger.error({ err }, "Backup scheduler check failed");
    }
  };

  setTimeout(checkAndBackup, 30 * 1000);
  setInterval(checkAndBackup, CHECK_INTERVAL_MS);
  logger.info("Backup scheduler started");
}
