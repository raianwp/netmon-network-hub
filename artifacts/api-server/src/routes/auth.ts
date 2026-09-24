import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { LoginBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

router.post("/auth/login", async (req, res) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const { username, password, rememberMe } = parsed.data;

  const users = await db.select().from(usersTable).where(eq(usersTable.username, username)).limit(1);
  const user = users[0];
  if (!user) {
    res.status(401).json({ error: "Usuário ou senha inválidos" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Usuário ou senha inválidos" });
    return;
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.role = user.role;
  req.session.canAccessAiTerminal = user.canAccessAiTerminal;

  // "Lembrar Login": extends the session cookie well past the default 7 days
  // instead of the usual session middleware setting.
  if (rememberMe) {
    req.session.cookie.maxAge = 90 * 24 * 60 * 60 * 1000;
  }

  res.json({ id: user.id, username: user.username, role: user.role, canAccessAiTerminal: user.canAccessAiTerminal });
});

router.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ message: "Logout realizado com sucesso" });
  });
});

router.get("/auth/me", requireAuth, (req, res) => {
  res.json({
    id: req.session.userId!,
    username: req.session.username!,
    role: req.session.role || "admin",
    canAccessAiTerminal: req.session.canAccessAiTerminal ?? false,
  });
});

export default router;
