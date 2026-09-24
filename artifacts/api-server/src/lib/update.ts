import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// Read-only check against the private repo (deploy key configured for the
// service user's SSH client) — no local git working copy required, since
// production is a plain rsync/netmon.sh checkout, not a git clone.
const REPO_URL = "git@github.com:raianwp/netmon-network-hub.git";

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

async function getLatestRemoteVersion(): Promise<string> {
  const { stdout } = await execFileAsync("git", ["ls-remote", "--tags", "--refs", REPO_URL], {
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    timeout: 15_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  const tags = stdout
    .trim()
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

export async function checkForUpdate(installedVersion: string): Promise<UpdateCheckResult> {
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
