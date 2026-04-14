import { Router } from "express";
import fs from "fs";
import path from "path";
import os from "os";
import { spawn, execSync } from "child_process";
import { DATA_DIR, hasCookies } from "../lib/clipProcessor";
import { logger } from "../lib/logger";

const router = Router();
const COOKIES_PATH = path.join(DATA_DIR, "yt_cookies.txt");
const OAUTH_CACHE_PATH = path.join(os.homedir(), ".cache", "yt-dlp", "youtube-oauth2", "token_data.json");

const YTDLP_BIN =
  process.env["YTDLP_BIN"] ??
  (fs.existsSync("/home/runner/workspace/bin/yt-dlp")
    ? "/home/runner/workspace/bin/yt-dlp"
    : "yt-dlp");

const NODE_BIN = (() => {
  try { return execSync("which node", { encoding: "utf8" }).trim(); }
  catch { return "node"; }
})();

// ── In-memory OAuth2 session ─────────────────────────────────────────────────
interface OAuthSession {
  deviceUrl: string;
  userCode: string;
  startedAt: number;
  done: boolean;
  error?: string;
}
let oauthSession: OAuthSession | null = null;
let oauthProc: ReturnType<typeof spawn> | null = null;

function hasOAuthToken(): boolean {
  try {
    if (!fs.existsSync(OAUTH_CACHE_PATH)) return false;
    const d = JSON.parse(fs.readFileSync(OAUTH_CACHE_PATH, "utf8"));
    return !!(d?.refresh_token || d?.access_token);
  } catch {
    return false;
  }
}

// ── Cookies endpoints ─────────────────────────────────────────────────────────

router.get("/admin/cookies/status", (_req, res) => {
  const oAuth = hasOAuthToken();
  if (!hasCookies() && !oAuth) {
    res.json({ hasCookies: false, hasOAuth: false });
    return;
  }
  const result: Record<string, unknown> = { hasCookies: hasCookies(), hasOAuth: oAuth };
  if (hasCookies()) {
    const stat = fs.statSync(COOKIES_PATH);
    result.sizeBytes = stat.size;
    result.updatedAt = stat.mtime.toISOString();
  }
  if (oAuth) {
    try {
      const d = JSON.parse(fs.readFileSync(OAUTH_CACHE_PATH, "utf8"));
      result.oauthExpires = d?.expires
        ? new Date(d.expires * 1000).toISOString()
        : null;
    } catch {}
  }
  res.json(result);
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

// ── OAuth2 endpoints ──────────────────────────────────────────────────────────

router.post("/admin/oauth2/start", (_req, res) => {
  if (oauthSession && !oauthSession.done && Date.now() - oauthSession.startedAt < 600_000) {
    res.json({ ok: true, ...oauthSession });
    return;
  }

  oauthSession = null;
  if (oauthProc) { try { oauthProc.kill("SIGTERM"); } catch {} oauthProc = null; }

  const proc = spawn(YTDLP_BIN, [
    "--js-runtimes", `node:${NODE_BIN}`,
    "--username", "oauth2",
    "--password", "",
    "--skip-download",
    "--no-playlist",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  ], { stdio: ["pipe", "pipe", "pipe"] });

  oauthProc = proc;

  let stdoutBuf = "";
  let resolved = false;

  // yt-dlp writes OAuth2 "go to ... enter code ..." to STDOUT
  proc.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stdoutBuf += text;
    logger.info({ text }, "oauth2 stdout");

    if (!resolved) {
      const urlMatch = stdoutBuf.match(/go to\s+(https:\/\/[^\s]+)/i);
      const codeMatch = stdoutBuf.match(/enter code\s+([A-Z0-9-]{8,})/i);
      if (urlMatch && codeMatch) {
        resolved = true;
        oauthSession = {
          deviceUrl: urlMatch[1].trim(),
          userCode: codeMatch[1].trim(),
          startedAt: Date.now(),
          done: false,
        };
        res.json({ ok: true, ...oauthSession });
      }
    }
  });

  proc.stderr.on("data", (chunk: Buffer) => {
    logger.info({ text: chunk.toString() }, "oauth2 stderr");
  });

  proc.on("close", (code) => {
    logger.info({ code }, "oauth2 process exited");
    if (oauthSession) {
      if (code === 0) {
        oauthSession.done = true;
      } else {
        oauthSession.error = `yt-dlp exited with code ${code}`;
        oauthSession.done = true;
      }
    }
    oauthProc = null;
  });

  proc.on("error", (e) => {
    logger.error({ err: e.message }, "oauth2 spawn error");
    if (!resolved) {
      res.status(500).json({ error: e.message });
      resolved = true;
    }
  });

  setTimeout(() => {
    if (!resolved) {
      proc.kill("SIGTERM");
      res.status(504).json({ error: "Timeout esperando el código de autenticación" });
      resolved = true;
    }
  }, 15000);
});

router.get("/admin/oauth2/status", (_req, res) => {
  const tokenOk = hasOAuthToken();
  res.json({
    hasToken: tokenOk,
    session: oauthSession,
  });
});

router.delete("/admin/oauth2/token", (_req, res) => {
  try {
    if (fs.existsSync(OAUTH_CACHE_PATH)) fs.unlinkSync(OAUTH_CACHE_PATH);
    if (oauthProc) { try { oauthProc.kill("SIGTERM"); } catch {} oauthProc = null; }
    oauthSession = null;
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
