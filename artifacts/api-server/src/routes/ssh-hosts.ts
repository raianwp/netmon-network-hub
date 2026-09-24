import { Router } from "express";
import { db } from "@workspace/db";
import { sshHostsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import {
  CreateSshHostBody,
  UpdateSshHostParams,
  UpdateSshHostBody,
  DeleteSshHostParams,
} from "@workspace/api-zod";
import { requireAiTerminalAccess } from "../middlewares/auth.js";
import { encryptSecret } from "../lib/crypto.js";

const router = Router();

function serializeSshHost(h: typeof sshHostsTable.$inferSelect) {
  const { passwordEncrypted: _passwordEncrypted, ...rest } = h;
  return rest;
}

router.get("/ssh-hosts", requireAiTerminalAccess, async (_req, res) => {
  const hosts = await db.select().from(sshHostsTable).orderBy(asc(sshHostsTable.orderIndex), asc(sshHostsTable.id));
  res.json(hosts.map(serializeSshHost));
});

router.post("/ssh-hosts", requireAiTerminalAccess, async (req, res) => {
  const parsed = CreateSshHostBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const data = parsed.data;
  const [host] = await db.insert(sshHostsTable).values({
    name: data.name,
    ipAddress: data.ipAddress,
    protocol: data.protocol as "ssh" | "telnet",
    port: data.port,
    username: data.username,
    passwordEncrypted: encryptSecret(data.password),
    systemType: data.systemType as typeof sshHostsTable.$inferSelect.systemType,
    enabled: data.enabled ?? true,
    orderIndex: data.orderIndex ?? 0,
  }).returning();
  res.status(201).json(serializeSshHost(host));
});

router.put("/ssh-hosts/:id", requireAiTerminalAccess, async (req, res) => {
  const params = UpdateSshHostParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = UpdateSshHostBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid body" }); return; }

  const updates: Record<string, unknown> = {};
  const d = body.data;
  if (d.name != null) updates.name = d.name;
  if (d.ipAddress != null) updates.ipAddress = d.ipAddress;
  if (d.protocol != null) updates.protocol = d.protocol;
  if (d.port != null) updates.port = d.port;
  if (d.username != null) updates.username = d.username;
  if (d.password) updates.passwordEncrypted = encryptSecret(d.password);
  if (d.systemType != null) updates.systemType = d.systemType;
  if (d.enabled != null) updates.enabled = d.enabled;
  if (d.orderIndex != null) updates.orderIndex = d.orderIndex;

  const [host] = await db.update(sshHostsTable).set(updates).where(eq(sshHostsTable.id, params.data.id)).returning();
  if (!host) { res.status(404).json({ error: "Host not found" }); return; }
  res.json(serializeSshHost(host));
});

router.delete("/ssh-hosts/:id", requireAiTerminalAccess, async (req, res) => {
  const params = DeleteSshHostParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(sshHostsTable).where(eq(sshHostsTable.id, params.data.id));
  res.json({ message: "Host excluído com sucesso" });
});

export default router;
