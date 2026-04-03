import { Router } from "express";
import fs from "fs";
import path from "path";
import { DATA_DIR, hasCookies } from "../lib/clipProcessor";

const router = Router();
const COOKIES_PATH = path.join(DATA_DIR, "yt_cookies.txt");

router.get("/admin/cookies/status", (req, res) => {
  if (!hasCookies()) {
    res.json({ hasCookies: false });
    return;
  }
  const stat = fs.statSync(COOKIES_PATH);
  res.json({
    hasCookies: true,
    sizeBytes: stat.size,
    updatedAt: stat.mtime.toISOString(),
  });
});

router.post("/admin/cookies", (req, res) => {
  const { content } = req.body as { content?: string };
  if (!content || typeof content !== "string" || content.length < 50) {
    res.status(400).json({ error: "Contenido de cookies inválido" });
    return;
  }
  if (!content.includes("youtube.com") && !content.includes("# Netscape")) {
    res.status(400).json({ error: "El archivo no parece contener cookies de YouTube válidas" });
    return;
  }
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(COOKIES_PATH, content.trim(), "utf8");
    res.json({ ok: true, sizeBytes: Buffer.byteLength(content, "utf8") });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/admin/cookies", (_req, res) => {
  try {
    if (fs.existsSync(COOKIES_PATH)) fs.unlinkSync(COOKIES_PATH);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
