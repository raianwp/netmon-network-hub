import { Router } from "express";
import { db } from "@workspace/db";
import { mikrotikConfigTable } from "@workspace/db";
import { SaveMikrotikConfigBody } from "@workspace/api-zod";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";
import { logger } from "../lib/logger.js";

const router = Router();

async function fetchMikrotikApi(config: typeof mikrotikConfigTable.$inferSelect, path: string, timeoutMs = 5000) {
  const url = `http://${config.ipAddress}:${config.apiPort}/rest${path}`;
  const credentials = Buffer.from(`${config.apiUser}:${config.apiPassword}`).toString("base64");
  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`MikroTik API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

router.get("/mikrotik/config", requireAuth, async (_req, res) => {
  const configs = await db.select().from(mikrotikConfigTable).limit(1);
  if (!configs[0]) {
    res.status(404).json({ error: "MikroTik not configured" });
    return;
  }
  const c = configs[0];
  res.json({ id: c.id, name: c.name, ipAddress: c.ipAddress, apiUser: c.apiUser, apiPort: c.apiPort, enabled: c.enabled, refreshIntervalSeconds: c.refreshIntervalSeconds });
});

router.post("/mikrotik/config", requireAdmin, async (req, res) => {
  const parsed = SaveMikrotikConfigBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const d = parsed.data;

  const existing = await db.select().from(mikrotikConfigTable).limit(1);
  let config;
  if (existing[0]) {
    const updateData: Record<string, unknown> = {
      name: d.name,
      ipAddress: d.ipAddress,
      apiUser: d.apiUser,
      apiPort: d.apiPort ?? 80,
      enabled: d.enabled ?? true,
      refreshIntervalSeconds: d.refreshIntervalSeconds ?? 30,
    };
    // Only update password if a new one was provided (non-empty)
    if (d.apiPassword && d.apiPassword.trim() !== "") {
      updateData.apiPassword = d.apiPassword;
    }
    const [updated] = await db.update(mikrotikConfigTable).set(updateData).returning();
    config = updated;
  } else {
    const [inserted] = await db.insert(mikrotikConfigTable).values({
      name: d.name,
      ipAddress: d.ipAddress,
      apiUser: d.apiUser,
      apiPassword: d.apiPassword,
      apiPort: d.apiPort ?? 80,
      enabled: d.enabled ?? true,
      refreshIntervalSeconds: d.refreshIntervalSeconds ?? 30,
    }).returning();
    config = inserted;
  }
  res.json({ id: config.id, name: config.name, ipAddress: config.ipAddress, apiUser: config.apiUser, apiPort: config.apiPort, enabled: config.enabled, refreshIntervalSeconds: config.refreshIntervalSeconds });
});

router.get("/mikrotik/dhcp-leases", requireAuth, async (_req, res) => {
  const configs = await db.select().from(mikrotikConfigTable).limit(1);
  if (!configs[0] || !configs[0].enabled) {
    res.status(503).json({ error: "MikroTik not configured or disabled" });
    return;
  }
  try {
    const data = await fetchMikrotikApi(configs[0], "/ip/dhcp-server/lease") as Record<string, string>[];
    const leases = data.map((l) => ({
      address: l["address"] ?? l["active-address"] ?? "",
      macAddress: l["mac-address"] ?? "",
      hostName: l["host-name"] ?? l["client-id"] ?? null,
      server: l["server"] ?? "",
      status: l["status"] ?? "waiting",
      expiresAfter: l["expires-after"] ?? null,
      comment: l["comment"] ?? null,
    }));
    res.json(leases);
  } catch (err) {
    logger.error({ err }, "Failed to fetch MikroTik DHCP leases");
    res.status(503).json({ error: "Cannot connect to MikroTik" });
  }
});

router.get("/mikrotik/test", requireAuth, async (_req, res) => {
  const configs = await db.select().from(mikrotikConfigTable).limit(1);
  if (!configs[0]) {
    res.status(404).json({ ok: false, error: "MikroTik não configurado" });
    return;
  }
  const c = configs[0];
  const url = `http://${c.ipAddress}:${c.apiPort}/rest/system/resource`;
  const credentials = Buffer.from(`${c.apiUser}:${c.apiPassword}`).toString("base64");
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const data = await response.json();
      res.json({ ok: true, url, statusCode: response.status, version: (data as Record<string,string>)["version"] ?? "?" });
    } else {
      const text = await response.text().catch(() => "");
      res.json({ ok: false, url, statusCode: response.status, error: `HTTP ${response.status} ${response.statusText}`, detail: text.slice(0, 200) });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.json({ ok: false, url, error: msg });
  }
});

// In-memory previous sample per interface, used to compute a real-time
// bps rate from RouterOS's cumulative rx-byte/tx-byte counters — same delta
// idiom as the CPU% calculation in agent-monitoring.ts.
const previousInterfaceSamples = new Map<string, { rxBytes: number; txBytes: number; sampledAt: number }>();

router.get("/mikrotik/interfaces", requireAuth, async (_req, res) => {
  const configs = await db.select().from(mikrotikConfigTable).limit(1);
  if (!configs[0] || !configs[0].enabled) {
    res.status(503).json({ error: "MikroTik not configured or disabled" });
    return;
  }
  try {
    const data = await fetchMikrotikApi(configs[0], "/interface") as Record<string, string>[];
    const now = Date.now();
    const interfaces = data.map((i) => {
      const name = i["name"] ?? "";
      const rxBytes = Number(i["rx-byte"] ?? "0");
      const txBytes = Number(i["tx-byte"] ?? "0");

      let rxRateBps: number | null = null;
      let txRateBps: number | null = null;
      const prev = previousInterfaceSamples.get(name);
      if (prev) {
        const elapsedSeconds = (now - prev.sampledAt) / 1000;
        if (elapsedSeconds > 0 && rxBytes >= prev.rxBytes && txBytes >= prev.txBytes) {
          rxRateBps = ((rxBytes - prev.rxBytes) * 8) / elapsedSeconds;
          txRateBps = ((txBytes - prev.txBytes) * 8) / elapsedSeconds;
        }
      }
      previousInterfaceSamples.set(name, { rxBytes, txBytes, sampledAt: now });

      return {
        name,
        type: i["type"] ?? "",
        running: i["running"] === "true",
        disabled: i["disabled"] === "true",
        macAddress: i["mac-address"] ?? "",
        rxBytes: i["rx-byte"] ?? "0",
        txBytes: i["tx-byte"] ?? "0",
        rxPackets: i["rx-packet"] ?? "0",
        txPackets: i["tx-packet"] ?? "0",
        rxRateBps,
        txRateBps,
        comment: i["comment"] ?? null,
      };
    });
    res.json(interfaces);
  } catch (err) {
    logger.error({ err }, "Failed to fetch MikroTik interfaces");
    res.status(503).json({ error: "Cannot connect to MikroTik" });
  }
});

router.get("/mikrotik/health", requireAuth, async (_req, res) => {
  const configs = await db.select().from(mikrotikConfigTable).limit(1);
  if (!configs[0] || !configs[0].enabled) {
    res.status(503).json({ error: "MikroTik not configured or disabled" });
    return;
  }
  try {
    const data = await fetchMikrotikApi(configs[0], "/system/health") as Record<string, string>[];
    // Shape/availability of /system/health entries varies by RouterBoard model
    // (some have no thermal sensor at all, e.g. CHR virtual routers).
    const cpuEntry = data.find((e) => /cpu/i.test(e["name"] ?? "") && /temp/i.test(e["name"] ?? ""));
    const fallbackEntry = data.find((e) => /temp/i.test(e["name"] ?? ""));
    const entry = cpuEntry ?? fallbackEntry;
    const cpuTempC = entry ? parseFloat(entry["value"] ?? "") : null;
    res.json({ cpuTempC: Number.isFinite(cpuTempC) ? cpuTempC : null });
  } catch (err) {
    logger.error({ err }, "Failed to fetch MikroTik health");
    res.status(503).json({ error: "Cannot connect to MikroTik" });
  }
});

router.get("/mikrotik/firewall/filter", requireAuth, async (_req, res) => {
  const configs = await db.select().from(mikrotikConfigTable).limit(1);
  if (!configs[0] || !configs[0].enabled) {
    res.status(503).json({ error: "MikroTik not configured or disabled" });
    return;
  }
  try {
    const data = await fetchMikrotikApi(configs[0], "/ip/firewall/filter") as Record<string, string>[];
    const rules = data.map((r) => ({
      chain: r["chain"] ?? "",
      action: r["action"] ?? "",
      srcAddress: r["src-address"] ?? null,
      dstAddress: r["dst-address"] ?? null,
      protocol: r["protocol"] ?? null,
      disabled: r["disabled"] === "true",
      bytes: r["bytes"] ?? "0",
      packets: r["packets"] ?? "0",
      comment: r["comment"] ?? null,
    }));
    res.json(rules);
  } catch (err) {
    logger.error({ err }, "Failed to fetch MikroTik firewall filter rules");
    res.status(503).json({ error: "Cannot connect to MikroTik" });
  }
});

router.get("/mikrotik/firewall/nat", requireAuth, async (_req, res) => {
  const configs = await db.select().from(mikrotikConfigTable).limit(1);
  if (!configs[0] || !configs[0].enabled) {
    res.status(503).json({ error: "MikroTik not configured or disabled" });
    return;
  }
  try {
    const data = await fetchMikrotikApi(configs[0], "/ip/firewall/nat") as Record<string, string>[];
    const rules = data.map((r) => ({
      chain: r["chain"] ?? "",
      action: r["action"] ?? "",
      srcAddress: r["src-address"] ?? null,
      dstAddress: r["dst-address"] ?? null,
      toAddresses: r["to-addresses"] ?? null,
      protocol: r["protocol"] ?? null,
      disabled: r["disabled"] === "true",
      bytes: r["bytes"] ?? "0",
      packets: r["packets"] ?? "0",
      comment: r["comment"] ?? null,
    }));
    res.json(rules);
  } catch (err) {
    logger.error({ err }, "Failed to fetch MikroTik NAT rules");
    res.status(503).json({ error: "Cannot connect to MikroTik" });
  }
});

router.get("/mikrotik/addresses", requireAuth, async (_req, res) => {
  const configs = await db.select().from(mikrotikConfigTable).limit(1);
  if (!configs[0] || !configs[0].enabled) {
    res.status(503).json({ error: "MikroTik not configured or disabled" });
    return;
  }
  try {
    const data = await fetchMikrotikApi(configs[0], "/ip/address") as Record<string, string>[];
    const addresses = data.map((a) => ({
      address: a["address"] ?? "",
      network: a["network"] ?? "",
      interfaceName: a["interface"] ?? "",
      disabled: a["disabled"] === "true",
      comment: a["comment"] ?? null,
    }));
    res.json(addresses);
  } catch (err) {
    logger.error({ err }, "Failed to fetch MikroTik IP addresses");
    res.status(503).json({ error: "Cannot connect to MikroTik" });
  }
});

const MAX_LOG_ENTRIES = 200;

router.get("/mikrotik/log", requireAuth, async (_req, res) => {
  const configs = await db.select().from(mikrotikConfigTable).limit(1);
  if (!configs[0] || !configs[0].enabled) {
    res.status(503).json({ error: "MikroTik not configured or disabled" });
    return;
  }
  try {
    const data = await fetchMikrotikApi(configs[0], "/log") as Record<string, string>[];
    // RouterOS returns the log buffer oldest-first; show the most recent
    // entries first, capped so the payload stays reasonable.
    const entries = data.slice(-MAX_LOG_ENTRIES).reverse().map((e) => ({
      time: e["time"] ?? "",
      topics: e["topics"] ?? "",
      message: e["message"] ?? "",
    }));
    res.json(entries);
  } catch (err) {
    logger.error({ err }, "Failed to fetch MikroTik log");
    res.status(503).json({ error: "Cannot connect to MikroTik" });
  }
});

router.get("/mikrotik/resources", requireAuth, async (_req, res) => {
  const configs = await db.select().from(mikrotikConfigTable).limit(1);
  if (!configs[0] || !configs[0].enabled) {
    res.status(503).json({ error: "MikroTik not configured or disabled" });
    return;
  }
  try {
    const data = await fetchMikrotikApi(configs[0], "/system/resource") as Record<string, string>;
    res.json({
      cpuLoad: parseInt(data["cpu-load"] ?? "0"),
      freeMemory: parseInt(data["free-memory"] ?? "0"),
      totalMemory: parseInt(data["total-memory"] ?? "0"),
      uptime: data["uptime"] ?? "",
      version: data["version"] ?? "",
      boardName: data["board-name"] ?? "",
    });
  } catch (err) {
    logger.error({ err }, "Failed to fetch MikroTik resources");
    res.status(503).json({ error: "Cannot connect to MikroTik" });
  }
});

router.get("/mikrotik/routes", requireAuth, async (_req, res) => {
  const configs = await db.select().from(mikrotikConfigTable).limit(1);
  if (!configs[0] || !configs[0].enabled) {
    res.status(503).json({ error: "MikroTik not configured or disabled" });
    return;
  }
  try {
    const data = await fetchMikrotikApi(configs[0], "/ip/route") as Record<string, string>[];
    const routes = data.map((r) => ({
      dstAddress: r["dst-address"] ?? "",
      gateway: r["gateway"] ?? "",
      distance: parseInt(r["distance"] ?? "0"),
      active: r["active"] === "true",
      dynamic: r["dynamic"] === "true",
      comment: r["comment"] ?? null,
    }));
    res.json(routes);
  } catch (err) {
    logger.error({ err }, "Failed to fetch MikroTik routes");
    res.status(503).json({ error: "Cannot connect to MikroTik" });
  }
});

export default router;
