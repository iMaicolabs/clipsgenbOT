import { Router } from "express";
import { z } from "zod";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  hashPassword,
  verifyPassword,
  signToken,
  setAuthCookie,
  clearAuthCookie,
  requireAuth,
  type AuthRequest,
} from "../lib/auth";

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  username: z.string().min(2).max(30),
  password: z.string().min(6),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/auth/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos", details: parsed.error.issues });
    return;
  }
  const { email, username, password } = parsed.data;

  const existing = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (existing.length > 0) {
    res.status(409).json({ error: "El correo ya está registrado" });
    return;
  }

  const passwordHash = await hashPassword(password);
  const [user] = await db.insert(usersTable).values({ email, username, passwordHash }).returning();
  const token = signToken({ userId: user.id, email: user.email });
  setAuthCookie(res, token);
  res.json({ id: user.id, email: user.email, username: user.username });
});

router.post("/auth/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos" });
    return;
  }
  const { email, password } = parsed.data;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (!user) {
    res.status(401).json({ error: "Correo o contraseña incorrectos" });
    return;
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "Correo o contraseña incorrectos" });
    return;
  }
  const token = signToken({ userId: user.id, email: user.email });
  setAuthCookie(res, token);
  res.json({ id: user.id, email: user.email, username: user.username });
});

router.post("/auth/logout", (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get("/auth/me", requireAuth as any, async (req: AuthRequest, res) => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
  if (!user) { res.status(404).json({ error: "Usuario no encontrado" }); return; }
  res.json({ id: user.id, email: user.email, username: user.username, createdAt: user.createdAt });
});

export default router;
