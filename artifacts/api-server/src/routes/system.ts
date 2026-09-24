import { Router } from "express";
import { exec } from "child_process";
import { promisify } from "util";
import os from "os";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";
import { checkForUpdate, applyUpdate } from "../lib/update.js";

const router = Router();
const execAsync = promisify(exec);

async function runCmd(cmd: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(cmd);
    return (stdout || stderr).trim();
  } catch {
    return "N/D";
  }
}

router.get("/system/info", requireAuth, async (_req, res) => {
  const [osKernel, osDistro, nginxRaw, pgClientRaw] = await Promise.all([
    runCmd("uname -r"),
    runCmd(`grep PRETTY_NAME /etc/os-release | cut -d'"' -f2`),
    runCmd("nginx -v 2>&1"),
    runCmd("psql --version"),
  ]);

  let postgresVersion = "N/D";
  let dbSize = "N/D";
  try {
    const [vRow, sRow] = await Promise.all([
      db.execute(sql`SELECT version()`),
      db.execute(sql`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`),
    ]);
    const vResult = vRow.rows[0] as { version?: string } | undefined;
    const sResult = sRow.rows[0] as { size?: string } | undefined;
    if (vResult?.version) {
      const match = vResult.version.match(/PostgreSQL [\d.]+/);
      postgresVersion = match ? match[0] : vResult.version.split(",")[0];
    }
    if (sResult?.size) dbSize = sResult.size;
  } catch {
    if (pgClientRaw !== "N/D") postgresVersion = pgClientRaw;
  }

  const nginxVersion = nginxRaw.startsWith("nginx version:")
    ? nginxRaw.replace("nginx version: ", "")
    : nginxRaw;

  res.json({
    appName: "NetMon",
    appVersion: "4.6",
    appDescription: "Network HUB para administradores de rede: monitoramento de hosts via ping ICMP, monitoramento detalhado de hosts Windows via NetMon Agent (CPU, RAM, uptime, processos), dashboard MikroTik completo (RouterOS REST API — recursos, temperatura, tráfego em tempo real, firewall, endereços IP, log do sistema), descoberta de hosts, terminal SSH/Telnet integrado, chat com IA (Claude, GPT, Gemini, DeepSeek, Groq) com leitura do terminal e execução de comandos mediante aprovação, e atualização automática via GitHub direto pela tela de Informações.",
    developerName: "Raian William",
    developerEmail: "raian_wp@hotmail.com",
    nodeVersion: process.version,
    hostname: os.hostname(),
    uptimeSeconds: os.uptime(),
    osKernel,
    osDistro,
    postgresVersion,
    nginxVersion,
    dbSize,
  });
});

router.get("/system/update/check", requireAdmin, async (_req, res) => {
  const result = await checkForUpdate();
  res.json(result);
});

router.post("/system/update/apply", requireAdmin, async (_req, res) => {
  const result = await applyUpdate();
  res.json(result);
  if (result.success) {
    setTimeout(() => process.exit(0), 300);
  }
});

export default router;
