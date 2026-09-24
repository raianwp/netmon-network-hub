import { Router } from "express";
import { exec } from "child_process";
import { promisify } from "util";
import { requireAdmin } from "../middlewares/auth.js";
import { logger } from "../lib/logger.js";

const execAsync = promisify(exec);

function ipToLong(ip: string): number {
  return ip.split('.').map(Number).reduce((acc, v) => acc * 256 + v, 0);
}

function longToIp(long: number): string {
  return [(long >>> 24) & 255, (long >>> 16) & 255, (long >>> 8) & 255, long & 255].join('.');
}

async function pingHost(ip: string): Promise<boolean> {
  try {
    const cmd = process.platform === "win32"
      ? `ping -n 1 -w 1000 ${ip}`
      : `ping -c 1 -W 1 ${ip}`;
    await execAsync(cmd, { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

const router = Router();

router.post("/hosts/discover", requireAdmin, async (req, res) => {
  const { startIp, endIp } = req.body;
  if (!startIp || !endIp) {
    res.status(400).json({ error: "startIp e endIp são obrigatórios" });
    return;
  }

  const start = ipToLong(startIp);
  const end = ipToLong(endIp);
  const total = end - start + 1;

  if (total > 254 || total < 1) {
    res.status(400).json({ error: "Intervalo inválido: máximo 254 IPs por varredura" });
    return;
  }

  const results: Array<{ ipAddress: string; name: null; reachable: boolean }> = [];

  for (let i = 0; i < total; i++) {
    const ip = longToIp(start + i);
    try {
      const alive = await pingHost(ip);
      if (alive) {
        results.push({ ipAddress: ip, name: null, reachable: true });
      }
    } catch (err) {
      logger.error({ err, ip }, "Erro ao escanear IP");
    }
  }

  res.json(results);
});

export default router;
