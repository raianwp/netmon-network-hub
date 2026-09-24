import { execFile } from "child_process";
import { promisify } from "util";
import { logger } from "./logger.js";

const execFileAsync = promisify(execFile);
const REPO_DIR = process.cwd();

let updateInProgress = false;

function stripV(tag: string): string {
  return tag.replace(/^v/, "");
}

function compareVersions(a: string, b: string): number {
  const pa = stripV(a).split(".").map(Number);
  const pb = stripV(b).split(".").map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

async function git(args: string[], timeoutMs = 30_000): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: REPO_DIR,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

async function run(cmd: string, args: string[], timeoutMs: number, extraEnv: Record<string, string> = {}): Promise<void> {
  await execFileAsync(cmd, args, {
    cwd: REPO_DIR,
    env: { ...process.env, ...extraEnv },
    timeout: timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
  });
}

async function getInstalledVersion(): Promise<string> {
  try {
    const exact = await git(["describe", "--tags", "--exact-match", "HEAD"]);
    return stripV(exact);
  } catch {
    try {
      const nearest = await git(["describe", "--tags", "--abbrev=0"]);
      return stripV(nearest);
    } catch {
      return "desconhecida";
    }
  }
}

async function getLatestRemoteVersion(): Promise<string> {
  const output = await git(["ls-remote", "--tags", "--refs", "origin"]);
  const tags = output
    .split("\n")
    .map((line) => line.split("refs/tags/")[1])
    .filter((t): t is string => Boolean(t) && /^v?\d+\.\d+(\.\d+)?$/.test(t));
  if (tags.length === 0) throw new Error("Nenhuma tag de versão encontrada no repositório remoto");
  tags.sort(compareVersions);
  return stripV(tags[tags.length - 1]);
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  installedVersion: string;
  latestVersion: string;
  error?: string;
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const installedVersion = await getInstalledVersion();
  try {
    const latestVersion = await getLatestRemoteVersion();
    return {
      hasUpdate: compareVersions(latestVersion, installedVersion) > 0,
      installedVersion,
      latestVersion,
    };
  } catch (err) {
    return {
      hasUpdate: false,
      installedVersion,
      latestVersion: installedVersion,
      error: err instanceof Error ? err.message : "Falha ao verificar atualizações",
    };
  }
}

export interface UpdateApplyResult {
  success: boolean;
  version?: string;
  error?: string;
}

// Only swaps to the new version if every step below succeeds — on any
// failure the working tree (and node_modules) are rolled back to the commit
// that was running before, and the service is left untouched (no restart).
export async function applyUpdate(): Promise<UpdateApplyResult> {
  if (updateInProgress) {
    return { success: false, error: "Já existe uma atualização em andamento" };
  }
  updateInProgress = true;

  let previousCommit: string;
  try {
    previousCommit = await git(["rev-parse", "HEAD"]);
  } catch {
    updateInProgress = false;
    return { success: false, error: "Não foi possível ler o commit atual do repositório" };
  }

  try {
    logger.info("Update: fetching from origin");
    await git(["fetch", "origin", "main", "--tags", "--force"], 60_000);
    await git(["reset", "--hard", "origin/main"]);

    logger.info("Update: installing dependencies");
    await run("pnpm", ["install", "--frozen-lockfile"], 5 * 60_000);

    logger.info("Update: applying database schema");
    await run("pnpm", ["--filter", "@workspace/db", "run", "push-force"], 60_000);

    logger.info("Update: building api-server");
    await run("pnpm", ["--filter", "@workspace/api-server", "run", "build"], 3 * 60_000);

    logger.info("Update: building netmon frontend");
    await run("pnpm", ["--filter", "@workspace/netmon", "run", "build"], 3 * 60_000, {
      NODE_ENV: "production",
      BASE_PATH: "/",
      PORT: process.env.PORT ?? "8080",
    });

    const version = await getInstalledVersion();
    logger.info({ version }, "Update: build succeeded");
    updateInProgress = false;
    return { success: true, version };
  } catch (err) {
    logger.error({ err }, "Update failed, rolling back to previous commit");
    try {
      await git(["reset", "--hard", previousCommit]);
      await run("pnpm", ["install", "--frozen-lockfile"], 5 * 60_000);
    } catch (rollbackErr) {
      logger.error({ rollbackErr }, "Update rollback also failed — manual intervention may be needed");
    }
    updateInProgress = false;
    return {
      success: false,
      error: err instanceof Error ? err.message : "Falha desconhecida durante a atualização",
    };
  }
}
