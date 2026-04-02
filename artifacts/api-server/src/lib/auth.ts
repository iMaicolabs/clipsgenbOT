import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import type { Request, Response, NextFunction } from "express";

const JWT_SECRET = process.env.JWT_SECRET ?? "clipsgenbot-secret-key-dev";
const COOKIE_NAME = "cgb_token";

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(payload: { userId: number; email: string }): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
}

export function verifyToken(token: string): { userId: number; email: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { userId: number; email: string };
  } catch {
    return null;
  }
}

export function setAuthCookie(res: Response, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearAuthCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

export function getTokenFromRequest(req: Request): string | null {
  if (req.cookies?.[COOKIE_NAME]) return req.cookies[COOKIE_NAME];
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

export interface AuthRequest extends Request {
  userId?: number;
  userEmail?: string;
}

export function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  const token = getTokenFromRequest(req);
  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      req.userId = payload.userId;
      req.userEmail = payload.email;
    }
  }
  next();
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = getTokenFromRequest(req);
  if (!token) { res.status(401).json({ error: "No autenticado" }); return; }
  const payload = verifyToken(token);
  if (!payload) { res.status(401).json({ error: "Token inválido" }); return; }
  req.userId = payload.userId;
  req.userEmail = payload.email;
  next();
}
