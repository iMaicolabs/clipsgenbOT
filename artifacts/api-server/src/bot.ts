import { Telegraf } from "telegraf";
import { spawn, execSync } from "child_process";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import https from "https";
import path from "path";
import os from "os";
import { logger } from "./lib/logger";

const execAsync = promisify(exec);

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");

export const bot = new Telegraf(token);

const COOKIES_PATH = path.join("/home/runner/workspace/data", "yt_cookies.txt");
const LOGO_PATH = path.join("/home/runner/workspace/attached_assets", "bot_logo.png");
const YTDLP_BIN = fs.existsSync("/home/runner/workspace/bin/yt-dlp")
  ? "/home/runner/workspace/bin/yt-dlp"
  : "yt-dlp";
const NODE_BIN = (() => {
  try { return execSync("which node", { encoding: "utf8" }).trim(); }
  catch { return "node"; }
})();
const OWNER_ID = process.env.TELEGRAM_OWNER_ID ? Number(process.env.TELEGRAM_OWNER_ID) : null;

function isOwner(chatId: number): boolean {
  if (!OWNER_ID) return true;
  return chatId === OWNER_ID;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const H = { parse_mode: "HTML" as const };

type Step =
  | "idle"
  | "waiting_url"
  | "waiting_start"
  | "waiting_end"
  | "waiting_quality"
  | "waiting_live_url"
  | "waiting_record_duration";

type Quality = "1080" | "720" | "480" | "360";

const QUALITY_LABELS: Record<Quality, string> = {
  "1080": "🔵 1080p Full HD",
  "720":  "🟢 720p HD",
  "480":  "🟡 480p SD",
  "360":  "🔴 360p Compacto",
};

const QUALITY_ICONS: Record<Quality, string> = {
  "1080": "🔵", "720": "🟢", "480": "🟡", "360": "🔴",
};

function qualityFormat(q: Quality): string {
  return (
    `bestvideo[ext=mp4][height<=${q}]+bestaudio[ext=m4a]` +
    `/bestvideo[height<=${q}]+bestaudio` +
    `/best[height<=${q}]/best`
  );
}

interface UserSession {
  step: Step;
  url?: string;
  startSec?: number;
  startStr?: string;
  endSec?: number;
  endStr?: string;
}

const sessions = new Map<number, UserSession>();

function getSession(chatId: number): UserSession {
  if (!sessions.has(chatId)) sessions.set(chatId, { step: "idle" });
  return sessions.get(chatId)!;
}

function resetSession(chatId: number) {
  sessions.set(chatId, { step: "idle" });
}

function parseTime(t: string): number {
  const parts = t.split(":").map(Number);
  if (parts.some(isNaN)) throw new Error(`Tiempo inválido: "${t}"`);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function progressBar(pct: number, total = 12): string {
  const filled = Math.min(total, Math.round((pct / 100) * total));
  return "█".repeat(filled) + "░".repeat(total - filled);
}

function phaseLabel(pct: number): string {
  if (pct < 10) return "🔍 <b>Analizando</b>";
  if (pct < 88) return "⚡ <b>Codificando</b>";
  if (pct < 99) return "🔄 <b>Finalizando</b>";
  return "✅ <b>Listo</b>";
}

const CANCEL_KB = {
  reply_markup: {
    inline_keyboard: [[{ text: "❌ Cancelar", callback_data: "cancel_session" }]],
  },
};

function stepTracker(done: number, total: number): string {
  const icons = ["①", "②", "③", "④"];
  return icons.slice(0, total).map((icon, i) => {
    if (i < done) return `✅`;
    if (i === done) return `▶️ ${icon}`;
    return icon;
  }).join(" ");
}

async function cleanupFiles(files: string[]) {
  for (const f of files) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  }
}

function hasCookies(): boolean {
  return fs.existsSync(COOKIES_PATH) && fs.statSync(COOKIES_PATH).size > 100;
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve()));
    }).on("error", (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

interface ProgressInfo {
  percent: number;
  size: string;
  speed: string;
  eta: string;
}

function parseYtdlpProgress(line: string): ProgressInfo | null {
  const match = line.match(
    /\[download\]\s+([\d.]+)%\s+of\s+~?([\d.]+\w+)\s+at\s+([\d.]+\S+)\s+ETA\s+(\S+)/
  );
  if (!match) return null;
  return { percent: parseFloat(match[1]), size: match[2], speed: match[3], eta: match[4] };
}

function parseFfmpegProgress(chunk: string, totalSec: number): ProgressInfo | null {
  const timeMatch = chunk.match(/time=(\d+):(\d+):(\d+\.?\d*)/);
  if (!timeMatch || totalSec <= 0) return null;

  const currentSec =
    parseInt(timeMatch[1]) * 3600 +
    parseInt(timeMatch[2]) * 60 +
    parseFloat(timeMatch[3]);

  const percent = Math.min(98, (currentSec / totalSec) * 100);
  const sizeMatch = chunk.match(/size=\s*([\d.]+\s*\S*B)/);
  const speedMatch = chunk.match(/speed=\s*([\d.]+x)/);
  const fpsMatch = chunk.match(/fps=\s*([\d.]+)/);

  const size = sizeMatch ? sizeMatch[1].replace(/\s+/, "") : "–";
  const speed = speedMatch ? speedMatch[1] : fpsMatch ? `${parseFloat(fpsMatch[1]).toFixed(0)} fps` : "–";
  const remaining = Math.max(0, totalSec - currentSec);
  const eta = remaining > 0
    ? `${Math.floor(remaining / 60)}:${Math.round(remaining % 60).toString().padStart(2, "0")}`
    : "0:00";

  return { percent, size, speed, eta };
}

function spawnYtdlp(
  args: string[],
  onProgress: (info: ProgressInfo) => void,
  timeoutMs = 180000,
  totalDurationSec = 0
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP_BIN, args, { shell: false });
    let stderrBuf = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      reject(new Error("TIMEOUT"));
    }, timeoutMs);

    proc.stdout.on("data", (data: Buffer) => {
      for (const line of data.toString().split("\n")) {
        const info = parseYtdlpProgress(line);
        if (info) onProgress(info);
      }
    });

    proc.stderr.on("data", (data: Buffer) => {
      const text = data.toString();
      stderrBuf += text;
      if (totalDurationSec > 0) {
        for (const chunk of text.split(/[\r\n]+/)) {
          const info = parseFfmpegProgress(chunk, totalDurationSec);
          if (info) onProgress(info);
        }
      }
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return;
      if (code === 0) resolve();
      else {
        const err: any = new Error(`yt-dlp exited with code ${code}`);
        err.stderr = stderrBuf;
        reject(err);
      }
    });

    proc.on("error", (err) => { clearTimeout(timer); reject(err); });
  });
}

async function tryYtdlpDownload(
  args: string[],
  outputFile: string,
  onProgress: (info: ProgressInfo) => void,
  timeoutMs = 180000,
  totalDurationSec = 0
): Promise<boolean> {
  try {
    await spawnYtdlp(args, onProgress, timeoutMs, totalDurationSec);
    return fs.existsSync(outputFile) && fs.statSync(outputFile).size > 0;
  } catch {
    await cleanupFiles([outputFile]);
    return false;
  }
}

async function updateProgress(
  ctx: any,
  chatId: number,
  msgId: number,
  info: ProgressInfo,
  startStr: string,
  endStr: string,
  quality: Quality,
  lastUpdateRef: { pct: number; time: number }
) {
  const now = Date.now();
  const pctDiff = Math.abs(info.percent - lastUpdateRef.pct);
  if (pctDiff < 5 && now - lastUpdateRef.time < 2000) return;

  lastUpdateRef.pct = info.percent;
  lastUpdateRef.time = now;

  const bar = progressBar(info.percent);
  const pct = info.percent.toFixed(0);
  const phase = phaseLabel(info.percent);

  const text =
    `${phase}\n\n` +
    `<code>${bar}</code>  <b>${pct}%</b>\n\n` +
    `📦 <b>${esc(info.size)}</b>  ·  ⚡ ${esc(info.speed)}  ·  ⏳ ETA ${esc(info.eta)}\n` +
    `🎬 <code>${esc(startStr)}</code> → <code>${esc(endStr)}</code>  ${QUALITY_ICONS[quality]}`;

  try {
    await ctx.telegram.editMessageText(chatId, msgId, undefined, text, H);
  } catch {}
}

async function processClip(
  ctx: any,
  url: string,
  startSec: number,
  startStr: string,
  endSec: number,
  endStr: string,
  quality: Quality = "720"
) {
  const duration = endSec - startSec;
  const tmpDir = os.tmpdir();
  const timestamp = Date.now();
  const rawFile = path.join(tmpDir, `yt_raw_${timestamp}.mp4`);
  const clipFile = path.join(tmpDir, `yt_clip_${timestamp}.mp4`);

  const cookiesArgs = hasCookies() ? ["--cookies", COOKIES_PATH] : [];
  const jsArgs = ["--js-runtimes", `node:${NODE_BIN}`];
  const fmt = qualityFormat(quality);

  const statusMsg = await ctx.reply(
    `🔍 <b>Analizando video...</b>\n\n` +
    `🎬 <code>${esc(startStr)}</code> → <code>${esc(endStr)}</code>  (${formatDuration(duration)})\n` +
    `${QUALITY_LABELS[quality]}`,
    H
  );
  const chatId = ctx.chat.id;
  const msgId = statusMsg.message_id;

  const lastUpdate = { pct: -1, time: 0 };
  const progressHandler = (info: ProgressInfo) => {
    updateProgress(ctx, chatId, msgId, info, startStr, endStr, quality, lastUpdate).catch(() => {});
  };

  try {
    logger.info({ url, startSec, endSec, quality, hasCookies: hasCookies() }, "Downloading YouTube video");

    await ctx.telegram.editMessageText(chatId, msgId, undefined,
      `🔍 <b>Analizando video...</b>\n\n` +
      `<code>${progressBar(0)}</code>  <b>0%</b>\n\n` +
      `🎬 <code>${esc(startStr)}</code> → <code>${esc(endStr)}</code>`,
      H
    );

    let downloaded = false;
    const clients = ["default", "web"];

    for (const client of clients) {
      const clientArgs = client === "default" ? [] : ["--extractor-args", `youtube:player_client=${client}`];
      const args = [
        ...jsArgs, ...clientArgs, ...cookiesArgs,
        "-f", fmt,
        "--merge-output-format", "mp4",
        "--download-sections", `*${startSec}-${endSec}`,
        "--force-keyframes-at-cuts",
        "--newline",
        "-o", rawFile, url,
      ];
      const ok = await tryYtdlpDownload(args, rawFile, progressHandler, 120000, duration);
      if (ok) { downloaded = true; logger.info({ client, method: "sections" }, "Download succeeded"); break; }
      lastUpdate.pct = -1; lastUpdate.time = 0;
      logger.warn({ client, method: "sections" }, "failed, trying next");
    }

    if (!downloaded) {
      for (const client of clients) {
        const clientArgs = client === "default" ? [] : ["--extractor-args", `youtube:player_client=${client}`];
        const args = [
          ...jsArgs, ...clientArgs, ...cookiesArgs,
          "-f", fmt,
          "--merge-output-format", "mp4",
          "--download-sections", `*${startSec}-${endSec}`,
          "--newline",
          "-o", rawFile, url,
        ];
        const ok = await tryYtdlpDownload(args, rawFile, progressHandler, 120000, duration);
        if (ok) { downloaded = true; logger.info({ client, method: "sections-nofkac" }, "Download succeeded"); break; }
        logger.warn({ client, method: "sections-nofkac" }, "failed, trying next");
      }
    }

    if (!downloaded) {
      logger.info("Falling back to full download + local trim");
      await ctx.telegram.editMessageText(chatId, msgId, undefined,
        `🌐 <b>Descargando stream completo...</b>\n\n` +
        `<code>${progressBar(0)}</code>  <b>0%</b>\n\n` +
        `⚠️ Stream live — puede tardar más de lo habitual`,
        H
      );
      lastUpdate.pct = -1; lastUpdate.time = 0;

      const fullFile = path.join(tmpDir, `yt_full_${timestamp}.mp4`);
      try {
        for (const client of clients) {
          const clientArgs = client === "default" ? [] : ["--extractor-args", `youtube:player_client=${client}`];
          const args = [
            ...jsArgs, ...clientArgs, ...cookiesArgs,
            "-f", fmt,
            "--merge-output-format", "mp4",
            "--max-filesize", "400M",
            "--newline",
            "-o", fullFile, url,
          ];
          const ok = await tryYtdlpDownload(args, fullFile, progressHandler, 300000, duration);
          if (ok) { downloaded = true; logger.info({ client, method: "full-download" }, "Full download succeeded"); break; }
          logger.warn({ client, method: "full-download" }, "failed, trying next");
        }

        if (downloaded && fs.existsSync(fullFile)) {
          await ctx.telegram.editMessageText(chatId, msgId, undefined,
            `✂️ <b>Recortando clip del stream...</b>`, H
          );
          await execAsync(
            `ffmpeg -y -i "${fullFile}" -ss ${startSec} -t ${duration} -map 0 -c:v libx264 -c:a aac -preset fast "${rawFile}"`,
            { timeout: 120000 }
          );
          await cleanupFiles([fullFile]);
        }
      } catch (e: any) {
        await cleanupFiles([fullFile]);
        throw e;
      }
    }

    if (!downloaded || !fs.existsSync(rawFile)) {
      throw new Error("LIVE_NOT_READY");
    }

    await ctx.telegram.editMessageText(chatId, msgId, undefined,
      `✂️ <b>Recortando clip...</b>\n\n` +
      `🎬 <code>${esc(startStr)}</code> → <code>${esc(endStr)}</code>`,
      H
    );

    // Check if raw file has audio stream before trimming
    const probeOut = await execAsync(`ffprobe -v quiet -print_format json -show_streams "${rawFile}"`, { timeout: 10000 }).catch(() => ({ stdout: "{}" }));
    const probeData = JSON.parse((probeOut as any).stdout || "{}");
    const hasAudio = (probeData.streams || []).some((s: any) => s.codec_type === "audio");
    logger.info({ rawFile, clipFile, duration, hasAudio }, "Trimming video");

    if (hasAudio) {
      // Re-encode with explicit stream mapping — ensures no black frames at start and audio is always included
      await execAsync(
        `ffmpeg -y -i "${rawFile}" -ss 0 -t ${duration} -map 0:v:0 -map 0:a:0 -c:v libx264 -c:a aac -preset fast -movflags +faststart "${clipFile}"`,
        { timeout: 60000 }
      );
    } else {
      // No audio in raw — re-download audio separately and mux
      logger.warn({ rawFile }, "No audio in raw file, attempting audio re-download");
      const audioFile = rawFile.replace(".mp4", "_audio.m4a");
      const jsArgs2 = ["--js-runtimes", `node:${NODE_BIN}`, ...cookiesArgs];
      const audioArgs = [...jsArgs2, "-f", "bestaudio[ext=m4a]/bestaudio", "--download-sections", `*${startSec}-${endSec}`, "-o", audioFile, url];
      const gotAudio = await tryYtdlpDownload(audioArgs, audioFile, () => {}, 60000, duration);
      if (gotAudio) {
        await execAsync(
          `ffmpeg -y -i "${rawFile}" -i "${audioFile}" -ss 0 -t ${duration} -map 0:v:0 -map 1:a:0 -c:v libx264 -c:a aac -preset fast -shortest -movflags +faststart "${clipFile}"`,
          { timeout: 60000 }
        );
        await cleanupFiles([audioFile]);
      } else {
        // Last resort: video only
        await execAsync(
          `ffmpeg -y -i "${rawFile}" -ss 0 -t ${duration} -map 0:v:0 -c:v libx264 -preset fast -an -movflags +faststart "${clipFile}"`,
          { timeout: 60000 }
        );
      }
    }

    if (!fs.existsSync(clipFile)) throw new Error("No se pudo recortar el clip");

    const stats = fs.statSync(clipFile);
    const sizeMB = stats.size / (1024 * 1024);

    if (sizeMB > 50) {
      await cleanupFiles([rawFile, clipFile]);
      return ctx.telegram.editMessageText(chatId, msgId, undefined,
        `⚠️ <b>Clip demasiado grande</b>\n\n` +
        `El clip pesa <b>${sizeMB.toFixed(1)} MB</b> y Telegram solo acepta hasta 50 MB.\n\n` +
        `Prueba con un rango de tiempo más corto o elige una calidad menor.`,
        H
      );
    }

    await ctx.telegram.editMessageText(chatId, msgId, undefined,
      `📤 <b>Enviando clip...</b>  <b>${sizeMB.toFixed(1)} MB</b>`, H
    );

    logger.info({ clipFile, sizeMB }, "Sending clip to Telegram");

    await ctx.replyWithVideo(
      { source: clipFile },
      {
        caption:
          `🎬 <b>${esc(startStr)} → ${esc(endStr)}</b>  ·  ${QUALITY_LABELS[quality]}\n` +
          `⏱ Duración: ${formatDuration(duration)}  ·  💾 ${sizeMB.toFixed(1)} MB`,
        parse_mode: "HTML",
      }
    );

    await ctx.telegram.deleteMessage(chatId, msgId).catch(() => {});
  } catch (err: any) {
    logger.error({ err, url }, "Error processing clip");
    const msg = err.stderr || err.message || "";

    let friendly: string;
    let retryKb: any = { reply_markup: { inline_keyboard: [[{ text: "🔁 Intentar de nuevo", callback_data: "retry_clip" }]] } };

    if (msg.includes("LIVE_NOT_READY")) {
      friendly =
        `⏳ <b>Stream no disponible aún</b>\n\n` +
        `YouTube tarda varios minutos (a veces horas) en archivar el video después de que termina el directo.\n\n` +
        `Espera un momento e inténtalo de nuevo.`;
    } else if (msg.includes("Sign in") || msg.includes("cookies")) {
      friendly =
        `🔒 <b>Autenticación requerida</b>\n\n` +
        `YouTube pide inicio de sesión para este video. Configura tus cookies con /cookies.`;
      retryKb = undefined;
    } else if (msg.includes("unavailable") || msg.includes("Private")) {
      friendly = `🚫 <b>Video no disponible</b>\n\nEl video es privado o fue eliminado.`;
      retryKb = undefined;
    } else if (msg.includes("age")) {
      friendly = `🔞 <b>Restricción de edad</b>\n\nEste video requiere verificación de edad. Configura tus cookies con /cookies.`;
      retryKb = undefined;
    } else if (msg.includes("TIMEOUT") || msg.includes("timeout")) {
      friendly = `⏱ <b>Tiempo agotado</b>\n\nEl proceso tardó demasiado. Prueba con un clip más corto o espera un momento.`;
    } else {
      friendly = `❌ <b>Error al procesar el clip</b>\n\nVerifica que el link sea válido y el video esté disponible.`;
    }

    try {
      await ctx.telegram.editMessageText(chatId, msgId, undefined, friendly, { ...H, ...retryKb });
    } catch {
      await ctx.reply(friendly, { ...H, ...retryKb });
    }
  } finally {
    await cleanupFiles([rawFile, clipFile]);
  }
}

async function processRecording(ctx: any, url: string, durationSec: number) {
  const tmpDir = os.tmpdir();
  const timestamp = Date.now();
  const outFile = path.join(tmpDir, `yt_live_${timestamp}.mp4`);
  const cookiesArgs = hasCookies() ? ["--cookies", COOKIES_PATH] : [];
  const chatId = ctx.chat.id;

  const statusMsg = await ctx.reply(
    `🔴 <b>Preparando grabación en vivo...</b>\n\n⏱ Duración: <b>${formatDuration(durationSec)}</b>`,
    H
  );
  const msgId = statusMsg.message_id;

  try {
    await ctx.telegram.editMessageText(chatId, msgId, undefined,
      `🔍 <b>Localizando stream...</b>\n\nObteniendo URL del directo activo...`, H
    );

    logger.info({ url, durationSec }, "Getting live stream URL");

    const { stdout } = await execAsync(
      `"${YTDLP_BIN}" --js-runtimes "node:${NODE_BIN}" ${cookiesArgs.map(a => `"${a}"`).join(" ")} ` +
      `-f "best[height<=480]/best" --get-url "${url}"`,
      { timeout: 30000 }
    );

    const streamUrl = stdout.trim().split("\n")[0];
    if (!streamUrl || !streamUrl.startsWith("http")) {
      throw new Error("No se pudo obtener la URL del stream en vivo.");
    }

    logger.info({ streamUrl: streamUrl.slice(0, 80) + "..." }, "Got stream URL, starting recording");

    const recordingBar = progressBar(0);
    await ctx.telegram.editMessageText(chatId, msgId, undefined,
      `🔴 <b>Grabando en vivo</b>\n\n` +
      `<code>${recordingBar}</code>  <b>0%</b>\n\n` +
      `⏳ <b>${formatDuration(durationSec)}</b> restantes\n\n` +
      `<i>Recibirás el video al terminar automáticamente.</i>`,
      H
    );

    let elapsed = 0;
    const countdownInterval = setInterval(async () => {
      elapsed += 10;
      const remaining = Math.max(0, durationSec - elapsed);
      const pct = Math.min(98, (elapsed / durationSec) * 100);
      const bar = progressBar(pct);
      try {
        await ctx.telegram.editMessageText(chatId, msgId, undefined,
          `🔴 <b>Grabando en vivo</b>\n\n` +
          `<code>${bar}</code>  <b>${pct.toFixed(0)}%</b>\n\n` +
          `⏳ <b>${formatDuration(remaining)}</b> restantes\n\n` +
          `<i>Recibirás el video al terminar automáticamente.</i>`,
          H
        );
      } catch {}
    }, 10000);

    try {
      await execAsync(
        `ffmpeg -y -i "${streamUrl}" -t ${durationSec} ` +
        `-c:v libx264 -preset fast -crf 28 -c:a aac -movflags +faststart "${outFile}"`,
        { timeout: (durationSec + 60) * 1000 }
      );
    } finally {
      clearInterval(countdownInterval);
    }

    if (!fs.existsSync(outFile) || fs.statSync(outFile).size === 0) {
      throw new Error("La grabación falló o el archivo está vacío.");
    }

    const stats = fs.statSync(outFile);
    const sizeMB = stats.size / (1024 * 1024);

    if (sizeMB > 50) {
      await cleanupFiles([outFile]);
      return ctx.telegram.editMessageText(chatId, msgId, undefined,
        `⚠️ <b>Grabación demasiado grande</b>\n\n` +
        `El archivo pesa <b>${sizeMB.toFixed(1)} MB</b> (límite Telegram: 50 MB).\n` +
        `Prueba grabando menos tiempo.`,
        H
      );
    }

    await ctx.telegram.editMessageText(chatId, msgId, undefined,
      `📤 <b>Enviando grabación...</b>  <b>${sizeMB.toFixed(1)} MB</b>`, H
    );

    logger.info({ outFile, sizeMB }, "Sending live recording");

    await ctx.replyWithVideo(
      { source: outFile },
      {
        caption:
          `🔴 <b>Grabación en vivo</b>  ·  ⏱ ${formatDuration(durationSec)}\n` +
          `💾 ${sizeMB.toFixed(1)} MB`,
        parse_mode: "HTML",
      }
    );

    await ctx.telegram.deleteMessage(chatId, msgId).catch(() => {});
  } catch (err: any) {
    logger.error({ err, url }, "Error recording live stream");
    const msg = err.stderr || err.message || "";

    let friendly: string;
    if (msg.includes("403") || msg.includes("Forbidden")) {
      friendly =
        `🔒 <b>Acceso denegado por YouTube</b>\n\n` +
        `Verifica que las cookies estén configuradas con /cookies y que el video sea público.`;
    } else if (msg.includes("live") || msg.includes("not available")) {
      friendly = `📴 <b>No es un directo activo</b>\n\nEste link no corresponde a un YouTube Live en emisión ahora mismo.`;
    } else if (msg.includes("timeout") || msg.includes("TIMEOUT")) {
      friendly = `⏱ <b>Tiempo agotado</b>\n\nLa grabación tardó demasiado. Inténtalo de nuevo.`;
    } else {
      friendly = `❌ <b>Error al grabar</b>\n\nVerifica que el link sea de un YouTube Live activo y que tengas cookies configuradas.`;
    }

    try {
      await ctx.telegram.editMessageText(chatId, msgId, undefined, friendly, H);
    } catch {
      await ctx.reply(friendly, H);
    }
  } finally {
    await cleanupFiles([outFile]);
  }
}

bot.command("start", async (ctx) => {
  resetSession(ctx.chat.id);
  const caption =
    `🎬 <b>YouTube Clip Bot</b>\n\n` +
    `Recorta cualquier fragmento de YouTube con calidad HD y recíbelo aquí al instante.\n\n` +
    `<b>¿Qué puedo hacer?</b>\n` +
    `› Clips de cualquier video de YouTube\n` +
    `› Grabaciones de YouTube Live en tiempo real\n` +
    `› Calidad seleccionable: 360p hasta 1080p\n\n` +
    `<b>Comandos:</b>\n` +
    `/clip — Recortar un fragmento\n` +
    `/grabar — Grabar un directo activo\n` +
    `/cancelar — Cancelar lo que estés haciendo\n\n` +
    `<i>Creado por @iMaicol</i>`;
  const keyboard = {
    inline_keyboard: [
      [
        { text: "✂️ Nuevo clip", callback_data: "start_clip" },
        { text: "🔴 Grabar Live", callback_data: "start_grabar" },
      ],
      [{ text: "🍪 Configurar cookies", callback_data: "show_cookies" }],
    ],
  };
  try {
    await ctx.replyWithPhoto(
      { source: fs.createReadStream(LOGO_PATH) },
      { caption, parse_mode: "HTML", reply_markup: keyboard }
    );
  } catch {
    await ctx.reply(caption, { ...H, reply_markup: keyboard });
  }
});

bot.command("cookies", (ctx) => {
  const ok = hasCookies();
  ctx.reply(
    `🍪 <b>Cookies de YouTube</b>\n\n` +
    (ok
      ? `✅ <b>Cookies configuradas</b> — las descargas de YouTube Live están habilitadas.\n\n`
      : `⚠️ <b>Sin cookies</b> — los videos /live y algunos restringidos no funcionarán.\n\n`) +
    `<b>¿Cómo exportar tus cookies?</b>\n` +
    `1. Instala la extensión <b>"Get cookies.txt LOCALLY"</b> en Chrome/Edge\n` +
    `2. Entra a <a href="https://youtube.com">youtube.com</a> con tu cuenta\n` +
    `3. Haz clic en la extensión y exporta <code>cookies.txt</code>\n` +
    `4. Envíame ese archivo aquí como documento\n\n` +
    `🔒 Las cookies se guardan solo en este servidor.`,
    { ...H, link_preview_options: { is_disabled: true } }
  );
});

bot.command("cancelar", (ctx) => {
  resetSession(ctx.chat.id);
  ctx.reply(
    `✅ <b>Cancelado</b>\n\nPuedes comenzar de nuevo cuando quieras.`,
    {
      ...H,
      reply_markup: {
        inline_keyboard: [[{ text: "✂️ Nuevo clip", callback_data: "start_clip" }]],
      },
    }
  );
});

bot.command("clip", (ctx) => {
  const session = getSession(ctx.chat.id);
  session.step = "waiting_url";
  session.url = undefined;
  session.startSec = undefined;
  session.startStr = undefined;
  ctx.reply(
    `✂️ <b>Nuevo clip</b>\n\n` +
    `${stepTracker(0, 4)}\n\n` +
    `🔗 <b>Paso 1 — Link del video</b>\n` +
    `Pega el enlace de YouTube:`,
    { ...H, ...CANCEL_KB }
  );
});

bot.command("miid", (ctx) => {
  ctx.reply(
    `🪪 <b>Tu ID de Telegram</b>\n\n<code>${ctx.chat.id}</code>\n\n` +
    `Comparte este número con el administrador del bot para activar permisos especiales.`,
    H
  );
});

bot.command("grabar", (ctx) => {
  if (!hasCookies()) {
    return ctx.reply(
      `🍪 <b>Cookies requeridas</b>\n\n` +
      `Para grabar un YouTube Live necesitas tener las cookies configuradas.`,
      {
        ...H,
        reply_markup: {
          inline_keyboard: [[{ text: "🍪 Ver instrucciones", callback_data: "show_cookies" }]],
        },
      }
    );
  }
  const session = getSession(ctx.chat.id);
  session.step = "waiting_live_url";
  session.url = undefined;
  ctx.reply(
    `🔴 <b>Grabar YouTube Live</b>\n\n` +
    `${stepTracker(0, 2)}\n\n` +
    `🔗 <b>Paso 1 — Link del directo</b>\n` +
    `Pega el enlace del YouTube Live que está activo ahora:`,
    { ...H, ...CANCEL_KB }
  );
});

bot.on("document", async (ctx) => {
  const doc = ctx.message.document;
  const fileName = doc.file_name?.toLowerCase() ?? "";

  if (!fileName.includes("cookie") && !fileName.endsWith(".txt")) {
    return ctx.reply(
      `📄 Para subir cookies, envía un archivo <code>.txt</code> exportado desde tu navegador.\n\nUsa /cookies para ver las instrucciones.`,
      H
    );
  }

  if (!isOwner(ctx.chat.id)) {
    return ctx.reply(`⛔ <b>Sin permisos</b>\n\nSolo el administrador puede actualizar las cookies.`, H);
  }

  const statusMsg = await ctx.reply(`⏳ <b>Guardando cookies...</b>`, H);

  try {
    const fileLink = await ctx.telegram.getFileLink(doc.file_id);
    await downloadFile(fileLink.href, COOKIES_PATH);

    const stats = fs.statSync(COOKIES_PATH);
    if (stats.size < 100) {
      fs.unlinkSync(COOKIES_PATH);
      return ctx.telegram.editMessageText(
        ctx.chat.id, statusMsg.message_id, undefined,
        `❌ <b>Archivo inválido</b>\n\nEl archivo de cookies parece estar vacío o incompleto. Expórtalo de nuevo.`,
        H
      );
    }

    logger.info({ size: stats.size }, "Cookies saved");

    await ctx.telegram.editMessageText(
      ctx.chat.id, statusMsg.message_id, undefined,
      `✅ <b>Cookies guardadas</b>  ·  ${(stats.size / 1024).toFixed(1)} KB\n\n` +
      `Ya puedes descargar videos /live y contenido restringido.`,
      H
    );
  } catch (err: any) {
    logger.error({ err }, "Failed to save cookies");
    await ctx.telegram.editMessageText(
      ctx.chat.id, statusMsg.message_id, undefined,
      `❌ <b>Error al guardar</b>\n\nNo se pudo guardar el archivo. Inténtalo de nuevo.`,
      H
    );
  }
});

const VALID_QUALITIES: Quality[] = ["1080", "720", "480", "360"];

for (const q of VALID_QUALITIES) {
  bot.action(`quality_${q}`, async (ctx) => {
    const chatId = ctx.chat?.id ?? ctx.from?.id;
    if (!chatId) { await ctx.answerCbQuery(); return; }

    const session = getSession(chatId);
    if (session.step !== "waiting_quality") {
      await ctx.answerCbQuery("⚠️ Usa /clip para iniciar un nuevo clip.");
      return;
    }
    await ctx.answerCbQuery(`${QUALITY_LABELS[q]} seleccionado ✅`);

    const { url, startSec, startStr, endSec, endStr } = session;
    if (!url || startSec === undefined || !startStr || endSec === undefined || !endStr) {
      resetSession(chatId);
      return ctx.reply(`❌ <b>Contexto perdido</b>\n\nUsa /clip para empezar de nuevo.`, H);
    }

    resetSession(chatId);

    await ctx.editMessageText(
      `${QUALITY_LABELS[q]} seleccionado\n\n🔍 <b>Iniciando...</b>`,
      H
    ).catch(() => {});

    await processClip(ctx, url, startSec, startStr, endSec, endStr, q);
  });
}

bot.action("cancel_session", async (ctx) => {
  const chatId = ctx.chat?.id ?? ctx.from?.id;
  if (chatId) resetSession(chatId);
  await ctx.answerCbQuery("Cancelado ✅");
  await ctx.editMessageText(
    `✅ <b>Cancelado</b>\n\nPuedes comenzar de nuevo cuando quieras.`,
    {
      ...H,
      reply_markup: {
        inline_keyboard: [[{ text: "✂️ Nuevo clip", callback_data: "start_clip" }]],
      },
    }
  ).catch(() => {});
});

bot.action("start_clip", async (ctx) => {
  await ctx.answerCbQuery();
  const chatId = ctx.chat?.id ?? ctx.from?.id;
  if (!chatId) return;
  const session = getSession(chatId);
  session.step = "waiting_url";
  session.url = undefined;
  session.startSec = undefined;
  session.startStr = undefined;
  await ctx.reply(
    `✂️ <b>Nuevo clip</b>\n\n` +
    `${stepTracker(0, 4)}\n\n` +
    `🔗 <b>Paso 1 — Link del video</b>\n` +
    `Pega el enlace de YouTube:`,
    { ...H, ...CANCEL_KB }
  );
});

bot.action("start_grabar", async (ctx) => {
  await ctx.answerCbQuery();
  const chatId = ctx.chat?.id ?? ctx.from?.id;
  if (!chatId) return;
  if (!hasCookies()) {
    return ctx.reply(
      `🍪 <b>Cookies requeridas</b>\n\nConfigura las cookies primero con /cookies.`,
      H
    );
  }
  const session = getSession(chatId);
  session.step = "waiting_live_url";
  session.url = undefined;
  await ctx.reply(
    `🔴 <b>Grabar YouTube Live</b>\n\n` +
    `${stepTracker(0, 2)}\n\n` +
    `🔗 <b>Paso 1 — Link del directo</b>\n` +
    `Pega el enlace del YouTube Live activo:`,
    { ...H, ...CANCEL_KB }
  );
});

bot.action("show_cookies", async (ctx) => {
  await ctx.answerCbQuery();
  const ok = hasCookies();
  await ctx.reply(
    `🍪 <b>Cookies de YouTube</b>\n\n` +
    (ok
      ? `✅ <b>Cookies configuradas</b>\n\n`
      : `⚠️ <b>Sin cookies configuradas</b>\n\n`) +
    `Exporta <code>cookies.txt</code> con la extensión "Get cookies.txt LOCALLY" y envíamelo aquí.`,
    H
  );
});

bot.action("retry_clip", async (ctx) => {
  await ctx.answerCbQuery();
  const chatId = ctx.chat?.id ?? ctx.from?.id;
  if (!chatId) return;
  const session = getSession(chatId);
  session.step = "waiting_url";
  session.url = undefined;
  session.startSec = undefined;
  session.startStr = undefined;
  await ctx.reply(
    `✂️ <b>Nuevo clip</b>\n\n` +
    `${stepTracker(0, 4)}\n\n` +
    `🔗 <b>Paso 1 — Link del video</b>\n` +
    `Pega el enlace de YouTube:`,
    { ...H, ...CANCEL_KB }
  );
});

bot.on("text", async (ctx) => {
  const chatId = ctx.chat.id;
  const session = getSession(chatId);
  const text = ctx.message.text.trim();

  if (text.startsWith("/")) return;

  if (session.step === "idle") {
    return ctx.reply(
      `Usa /clip para recortar un video o /grabar para capturar un directo.`,
      {
        ...H,
        reply_markup: {
          inline_keyboard: [[{ text: "✂️ Nuevo clip", callback_data: "start_clip" }]],
        },
      }
    );
  }

  if (session.step === "waiting_url") {
    if (!text.includes("youtube.com") && !text.includes("youtu.be")) {
      return ctx.reply(
        `❌ Eso no parece un link de YouTube.\n\nPega un link como:\n<code>https://youtube.com/watch?v=...</code>`,
        { ...H, ...CANCEL_KB }
      );
    }
    session.url = text;
    session.step = "waiting_start";
    return ctx.reply(
      `✂️ <b>Nuevo clip</b>\n\n` +
      `${stepTracker(1, 4)}\n\n` +
      `⏱ <b>Paso 2 — Tiempo de inicio</b>\n` +
      `¿Desde qué momento quieres el clip?\n\n` +
      `Ejemplos: <code>1:30</code>  <code>0:45</code>  <code>1:02:15</code>`,
      { ...H, ...CANCEL_KB }
    );
  }

  if (session.step === "waiting_start") {
    let startSec: number;
    try { startSec = parseTime(text); }
    catch {
      return ctx.reply(
        `❌ Formato inválido.\n\nUsa <code>mm:ss</code> o <code>hh:mm:ss</code>\nEjemplo: <code>1:30</code>`,
        { ...H, ...CANCEL_KB }
      );
    }
    session.startSec = startSec;
    session.startStr = text;
    session.step = "waiting_end";
    return ctx.reply(
      `✂️ <b>Nuevo clip</b>\n\n` +
      `${stepTracker(2, 4)}\n\n` +
      `⏱ <b>Paso 3 — Tiempo de fin</b>\n` +
      `¿Hasta qué momento?\n\n` +
      `Inicio: <code>${esc(text)}</code>\n` +
      `Ejemplo de fin: <code>${esc(text.split(":").map((p, i, a) => i === a.length - 1 ? String(Math.min(59, parseInt(p) + 30)).padStart(2, "0") : p).join(":"))}</code>`,
      { ...H, ...CANCEL_KB }
    );
  }

  if (session.step === "waiting_end") {
    let endSec: number;
    try { endSec = parseTime(text); }
    catch {
      return ctx.reply(
        `❌ Formato inválido.\n\nUsa <code>mm:ss</code> o <code>hh:mm:ss</code>`,
        { ...H, ...CANCEL_KB }
      );
    }

    const startSec = session.startSec!;
    const startStr = session.startStr!;

    if (endSec <= startSec) {
      return ctx.reply(
        `❌ El tiempo de fin (<code>${esc(text)}</code>) debe ser mayor que el inicio (<code>${esc(startStr)}</code>).\n\nEnvía otro tiempo de fin:`,
        { ...H, ...CANCEL_KB }
      );
    }

    const duration = endSec - startSec;
    if (duration > 180) {
      return ctx.reply(
        `❌ El clip dura <b>${formatDuration(duration)}</b>, el máximo es <b>3 minutos</b>.\n\nEnvía un tiempo de fin menor:`,
        { ...H, ...CANCEL_KB }
      );
    }

    session.endSec = endSec;
    session.endStr = text;
    session.step = "waiting_quality";

    const estSize: Record<Quality, string> = {
      "1080": `~${Math.round(duration * 0.5)} MB`,
      "720":  `~${Math.round(duration * 0.25)} MB`,
      "480":  `~${Math.round(duration * 0.12)} MB`,
      "360":  `~${Math.round(duration * 0.07)} MB`,
    };

    return ctx.reply(
      `✂️ <b>Nuevo clip</b>\n\n` +
      `${stepTracker(3, 4)}\n\n` +
      `🎚 <b>Paso 4 — Calidad de video</b>\n` +
      `Clip: <code>${esc(startStr)}</code> → <code>${esc(text)}</code>  (${formatDuration(duration)})\n\n` +
      `Mayor calidad = mejor imagen pero más tiempo de carga.`,
      {
        ...H,
        reply_markup: {
          inline_keyboard: [
            [
              { text: `🔵 1080p Full HD  ${estSize["1080"]}`, callback_data: "quality_1080" },
            ],
            [
              { text: `🟢 720p HD  ${estSize["720"]}`, callback_data: "quality_720" },
            ],
            [
              { text: `🟡 480p SD  ${estSize["480"]}`, callback_data: "quality_480" },
              { text: `🔴 360p  ${estSize["360"]}`, callback_data: "quality_360" },
            ],
            [{ text: "❌ Cancelar", callback_data: "cancel_session" }],
          ],
        },
      }
    );
  }

  if (session.step === "waiting_live_url") {
    if (!text.includes("youtube.com") && !text.includes("youtu.be")) {
      return ctx.reply(
        `❌ Eso no parece un link de YouTube. Envíame un enlace válido:`,
        { ...H, ...CANCEL_KB }
      );
    }
    session.url = text;
    session.step = "waiting_record_duration";
    return ctx.reply(
      `🔴 <b>Grabar YouTube Live</b>\n\n` +
      `${stepTracker(1, 2)}\n\n` +
      `⏱ <b>Paso 2 — Duración de grabación</b>\n` +
      `¿Cuántos minutos quieres grabar? <b>(1–3 minutos)</b>`,
      {
        ...H,
        reply_markup: {
          inline_keyboard: [
            [
              { text: "1 min", callback_data: "record_1" },
              { text: "2 min", callback_data: "record_2" },
              { text: "3 min", callback_data: "record_3" },
            ],
            [{ text: "❌ Cancelar", callback_data: "cancel_session" }],
          ],
        },
      }
    );
  }

  if (session.step === "waiting_record_duration") {
    const mins = parseFloat(text.replace(",", "."));
    if (isNaN(mins) || mins <= 0 || mins > 3) {
      return ctx.reply(
        `❌ Envía un número entre <b>1</b> y <b>3</b> minutos.`,
        { ...H, ...CANCEL_KB }
      );
    }
    const durationSec = Math.round(mins * 60);
    const url = session.url!;
    resetSession(chatId);
    await processRecording(ctx, url, durationSec);
  }
});

for (const mins of [1, 2, 3]) {
  bot.action(`record_${mins}`, async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id ?? ctx.from?.id;
    if (!chatId) return;

    const session = getSession(chatId);
    if (session.step !== "waiting_record_duration" || !session.url) {
      return ctx.reply(`❌ Usa /grabar para iniciar una grabación.`, H);
    }

    const url = session.url;
    resetSession(chatId);

    await ctx.editMessageText(
      `🔴 <b>${mins} min${mins > 1 ? "s" : ""} seleccionado${mins > 1 ? "s" : ""}</b>\n\n🔍 Preparando grabación...`,
      H
    ).catch(() => {});

    await processRecording(ctx, url, mins * 60);
  });
}

export async function startBot() {
  bot.catch((err, ctx) => {
    logger.error({ err }, "Unhandled bot error");
    ctx.reply(`❌ <b>Error inesperado</b>\n\nAlgo salió mal. Usa /clip para intentar de nuevo.`, H).catch(() => {});
  });

  try {
    await bot.telegram.setMyCommands([
      { command: "clip", description: "✂️ Recortar un fragmento de video" },
      { command: "grabar", description: "🔴 Grabar un directo activo" },
      { command: "cookies", description: "🍪 Configurar cookies de YouTube" },
      { command: "cancelar", description: "❌ Cancelar la operación actual" },
      { command: "miid", description: "🪪 Ver mi ID de Telegram" },
      { command: "start", description: "🎬 Bienvenida y ayuda" },
    ]);
    await bot.launch();
    logger.info("Telegram bot started (polling)");
  } catch (err) {
    logger.error({ err }, "Failed to start Telegram bot");
    throw err;
  }
}

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
