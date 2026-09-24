import { Router } from "express";
import { db } from "@workspace/db";
import { hostsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import {
  ListHostsQueryParams,
  CreateHostBody,
  UpdateHostParams,
  UpdateHostBody,
  DeleteHostParams,
} from "@workspace/api-zod";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";

const router = Router();

function serializeHost(h: typeof hostsTable.$inferSelect) {
  return { ...h, createdAt: h.createdAt.toISOString() };
}

router.get("/hosts", requireAuth, async (req, res) => {
  const query = ListHostsQueryParams.safeParse(req.query);
  let baseQuery = db.select().from(hostsTable).orderBy(asc(hostsTable.orderIndex), asc(hostsTable.id));
  if (query.success && query.data.type) {
    const hosts = await db.select().from(hostsTable)
      .where(eq(hostsTable.type, query.data.type as "pc" | "server"))
      .orderBy(asc(hostsTable.orderIndex), asc(hostsTable.id));
    res.json(hosts.map(serializeHost));
    return;
  }
  const hosts = await baseQuery;
  res.json(hosts.map(serializeHost));
});

router.post("/hosts", requireAdmin, async (req, res) => {
  const parsed = CreateHostBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const data = parsed.data;
  const [host] = await db.insert(hostsTable).values({
    name: data.name,
    ipAddress: data.ipAddress,
    type: (data.type as "pc" | "server") ?? "pc",
    userName: data.userName ?? null,
    sector: data.sector ?? null,
    enabled: data.enabled ?? true,
    notifyDesktop: data.notifyDesktop ?? false,
    agentEnabled: data.agentEnabled ?? false,
    agentPort: data.agentPort ?? 9182,
    orderIndex: data.orderIndex ?? 0,
  }).returning();
  res.status(201).json(serializeHost(host));
});

router.put("/hosts/:id", requireAdmin, async (req, res) => {
  const params = UpdateHostParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = UpdateHostBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid body" }); return; }

  const updates: Record<string, unknown> = {};
  const d = body.data;
  if (d.name != null) updates.name = d.name;
  if (d.ipAddress != null) updates.ipAddress = d.ipAddress;
  if (d.type != null) updates.type = d.type;
  if (d.userName !== undefined) updates.userName = d.userName;
  if (d.sector !== undefined) updates.sector = d.sector;
  if (d.enabled != null) updates.enabled = d.enabled;
  if (d.notifyDesktop != null) updates.notifyDesktop = d.notifyDesktop;
  if (d.agentEnabled != null) updates.agentEnabled = d.agentEnabled;
  if (d.agentPort != null) updates.agentPort = d.agentPort;
  if (d.orderIndex != null) updates.orderIndex = d.orderIndex;

  const [host] = await db.update(hostsTable).set(updates).where(eq(hostsTable.id, params.data.id)).returning();
  if (!host) { res.status(404).json({ error: "Host not found" }); return; }
  res.json(serializeHost(host));
});

router.delete("/hosts/:id", requireAdmin, async (req, res) => {
  const params = DeleteHostParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(hostsTable).where(eq(hostsTable.id, params.data.id));
  res.json({ message: "Host excluído com sucesso" });
});

export default router;
