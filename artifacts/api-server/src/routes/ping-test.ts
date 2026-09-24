import { Router } from "express";
import { exec } from "child_process";
import { requireAuth } from "../middlewares/auth.js";
import { logger } from "../lib/logger.js";

const router = Router();

// Validate IP address (IPv4 only, no shell injection)
function isValidIp(ip: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) &&
    ip.split(".").every(n => parseInt(n) >= 0 && parseInt(n) <= 255);
}

// Extract time from ping stdout, e.g. "time=1.234 ms" → 1.234
function parsePingTime(stdout: string): number | null {
  const m = stdout.match(/time[<=]([\d.]+)\s*ms/i);
  return m ? parseFloat(m[1]) : null;
}

// Run a single ping and return raw output + result
function runSinglePing(ip: string, seq: number): Promise<{
  alive: boolean;
  ms: number | null;
  raw: string;
}> {
  return new Promise((resolve) => {
    const cmd = `ping -c 1 -W 2 ${ip}`;
    exec(cmd, { timeout: 4000 }, (_error, stdout) => {
      const timeMs = parsePingTime(stdout);
      if (timeMs !== null) {
        const line = stdout
          .split("\n")
          .find(l => l.includes("bytes from"))
          ?.trim() ?? `64 bytes from ${ip}: icmp_seq=${seq} time=${timeMs.toFixed(1)} ms`;
        resolve({ alive: true, ms: timeMs, raw: line });
      } else {
        resolve({
          alive: false,
          ms: null,
          raw: `Requisição para ${ip}: tempo limite excedido.`,
        });
      }
    });
  });
}

/**
 * GET /api/monitoring/ping-test
 * Query params: ip (required), continuous ("true" = keep going)
 *
 * Server-Sent Events stream. Each event:
 *   data: { seq, alive, ms, raw, done }
 */
router.get("/monitoring/ping-test", requireAuth, (req, res) => {
  const ip = (req.query.ip as string | undefined)?.trim() ?? "";
  const continuous = req.query.continuous === "true";

  if (!ip || !isValidIp(ip)) {
    res.status(400).json({ error: "IP inválido" });
    return;
  }

  // SSE headers — X-Accel-Buffering: no tells nginx/proxies not to buffer
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");   // disable nginx buffering
  res.setHeader("Transfer-Encoding", "chunked");
  res.flushHeaders();

  let stopped = false;
  let seq = 0;
  const MAX_SINGLE = 5;

  // Flush helper — forces bytes through any compression/buffering layer
  const flush = () => {
    if (typeof (res as unknown as { flush?: () => void }).flush === "function") {
      (res as unknown as { flush: () => void }).flush();
    }
  };

  const send = (data: object) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      flush();
    }
  };

  req.on("close", () => { stopped = true; });

  const loop = async () => {
    while (!stopped) {
      seq++;
      const result = await runSinglePing(ip, seq);
      if (stopped) break;

      send({ seq, ...result, done: false });

      if (!continuous && seq >= MAX_SINGLE) {
        // Small delay so the last result is visible before done signal
        await new Promise<void>(r => setTimeout(r, 150));
        send({ seq, alive: false, ms: null, raw: "", done: true });
        res.end();
        return;
      }

      // 1s between pings (standard ping interval)
      await new Promise<void>(r => setTimeout(r, 1000));
    }
    if (!res.writableEnded) res.end();
  };

  loop().catch(err => {
    logger.error({ err }, "ping-test stream error");
    if (!res.writableEnded) res.end();
  });
});

export default router;
