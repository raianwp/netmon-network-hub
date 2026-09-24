import { exec } from "child_process";
import { promisify } from "util";
import { logger } from "./logger.js";
import { getSettingsFromDb } from "../routes/settings.js";

const execAsync = promisify(exec);

export interface InternetCheckState {
  status: "online" | "offline" | "unknown";
  lastCheckedAt: string | null;
  lastChangedAt: string | null;
}

const state: InternetCheckState = {
  status: "unknown",
  lastCheckedAt: null,
  lastChangedAt: null,
};

async function pingOnce(ip: string, timeoutMs = 2000): Promise<boolean> {
  try {
    const cmd = process.platform === "win32"
      ? `ping -n 1 -w ${timeoutMs} ${ip}`
      : `ping -c 1 -W ${Math.ceil(timeoutMs / 1000)} ${ip}`;
    await execAsync(cmd, { timeout: timeoutMs + 1000 });
    return true;
  } catch {
    return false;
  }
}

async function runCheck(): Promise<void> {
  const settings = await getSettingsFromDb();

  if (!settings.internetCheckEnabled) return;

  const hosts = settings.internetCheckHosts;
  if (!hosts.length) return;

  let online = false;

  for (const host of hosts) {
    let hostAlive = false;
    for (let i = 0; i < 3; i++) {
      if (await pingOnce(host, 2000)) {
        hostAlive = true;
        break;
      }
    }
    if (hostAlive) {
      online = true;
      break;
    }
  }

  const newStatus = online ? "online" : "offline";
  const now = new Date().toISOString();

  if (state.status !== newStatus) {
    state.lastChangedAt = now;
    logger.info({ from: state.status, to: newStatus }, "Internet connectivity changed");
  }

  state.status = newStatus;
  state.lastCheckedAt = now;
}

export function getInternetCheckState(): InternetCheckState {
  return { ...state };
}

let checkTimer: NodeJS.Timeout | null = null;

function scheduleNext(): void {
  if (checkTimer) clearTimeout(checkTimer);
  getSettingsFromDb()
    .then((settings) => {
      const intervalMs = settings.internetCheckIntervalSeconds * 1000;
      checkTimer = setTimeout(async () => {
        try {
          await runCheck();
        } catch (err) {
          logger.error({ err }, "Internet check cycle failed");
        }
        scheduleNext();
      }, intervalMs);
    })
    .catch((err) => {
      logger.error({ err }, "Failed to read settings for internet check schedule");
      checkTimer = setTimeout(scheduleNext, 60_000);
    });
}

export function startInternetCheck(): void {
  logger.info("Starting internet connectivity check service");
  scheduleNext();
  runCheck().catch((err) => logger.error({ err }, "Initial internet check failed"));
}
