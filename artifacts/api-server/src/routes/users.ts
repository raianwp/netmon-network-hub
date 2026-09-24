import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateUserBody,
  UpdateUserBody,
  UpdateUserParams,
  DeleteUserParams,
} from "@workspace/api-zod";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";

const router = Router();

const userColumns = {
  id: usersTable.id,
  username: usersTable.username,
  role: usersTable.role,
  canAccessAiTerminal: usersTable.canAccessAiTerminal,
  createdAt: usersTable.createdAt,
};

router.get("/users", requireAuth, async (_req, res) => {
  const users = await db.select(userColumns).from(usersTable).orderBy(usersTable.id);
  res.json(users.map(u => ({ ...u, createdAt: u.createdAt.toISOString() })));
});

router.post("/users", requireAdmin, async (req, res) => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const { username, password, role, canAccessAiTerminal } = parsed.data;
  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await db.insert(usersTable).values({
    username,
    passwordHash,
    role: role || "viewer",
    canAccessAiTerminal: canAccessAiTerminal ?? false,
  }).returning(userColumns);
  res.status(201).json({ ...user, createdAt: user.createdAt.toISOString() });
});

router.put("/users/:id", requireAdmin, async (req, res) => {
  const params = UpdateUserParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = UpdateUserBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid body" }); return; }

  const updates: Record<string, unknown> = {};
  if (body.data.username) updates.username = body.data.username;
  if (body.data.password) updates.passwordHash = await bcrypt.hash(body.data.password, 10);
  if (body.data.role) updates.role = body.data.role;
  if (body.data.canAccessAiTerminal != null) updates.canAccessAiTerminal = body.data.canAccessAiTerminal;

  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, params.data.id)).returning(userColumns);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json({ ...user, createdAt: user.createdAt.toISOString() });
});

router.delete("/users/:id", requireAdmin, async (req, res) => {
  const params = DeleteUserParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(usersTable).where(eq(usersTable.id, params.data.id));
  res.json({ message: "Usuário excluído com sucesso" });
});

export default router;
