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
if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN is required");
}

export const bot = new Telegraf(token);

const COOKIES_PATH = path.join("/home/runner/workspace/data", "yt_cookies.txt");
const YTDLP_BIN = fs.existsSync("/home/runner/workspace/bin/yt-dlp")
  ? "/home/runner/workspace/bin/yt-dlp"
  : "yt-dlp";
const NODE_BIN = (() => {
  try {
    return execSync("which node", { encoding: "utf8" }).trim();
  } catch {
    return "node";
  }
})();
const OWNER_ID = process.env.TELEGRAM_OWNER_ID
  ? Number(process.env.TELEGRAM_OWNER_ID)
  : null;

function isOwner(chatId: number): boolean {
  if (!OWNER_ID) return true;
  return chatId === OWNER_ID;
}

type Step =
  | "idle"
  | "waiting_url"
  | "waiting_start"
  | "waiting_end"
  | "waiting_live_url"
  | "waiting_record_duration";

interface UserSession {
  step: Step;
  url?: string;
  startSec?: number;
  startStr?: string;
}

const sessions = new Map<number, UserSession>();

function getSession(chatId: number): UserSession {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, { step: "idle" });
  }
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
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function progressBar(pct: number, total = 10): string {
  const filled = Math.round((pct / 100) * total);
  return "▓".repeat(filled) + "░".repeat(total - filled);
}

async function cleanupFiles(files: string[]) {
  for (const f of files) {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch {}
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
    /\[download\]\s+([\d.]+)%\s+of\s+~?([\d.]+\w+)\s+at\s+([\d.]+\w+\/s)\s+ETA\s+(\S+)/
  );
  if (!match) return null;
  return {
    percent: parseFloat(match[1]),
    size: match[2],
    speed: match[3],
    eta: match[4],
  };
}

function spawnYtdlp(
  args: string[],
  onProgress: (info: ProgressInfo) => void,
  timeoutMs = 180000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP_BIN, args, { shell: false });
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      reject(new Error("TIMEOUT"));
    }, timeoutMs);

    proc.stdout.on("data", (data: Buffer) => {
      const lines = data.toString().split("\n");
      for (const line of lines) {
        const info = parseYtdlpProgress(line);
        if (info) onProgress(info);
      }
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return;
      if (code === 0) {
        resolve();
      } else {
        const err: any = new Error(`yt-dlp exited with code ${code}`);
        err.stderr = stderr;
        reject(err);
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function tryYtdlpDownload(
  args: string[],
  outputFile: string,
  onProgress: (info: ProgressInfo) => void,
  timeoutMs = 180000
): Promise<boolean> {
  try {
    await spawnYtdlp(args, onProgress, timeoutMs);
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
  lastUpdateRef: { pct: number; time: number }
) {
  const now = Date.now();
  const pctDiff = Math.abs(info.percent - lastUpdateRef.pct);
  if (pctDiff < 10 && now - lastUpdateRef.time < 5000) return;

  lastUpdateRef.pct = info.percent;
  lastUpdateRef.time = now;

  const bar = progressBar(info.percent);
  const text =
    `⬇️ Descargando...\n` +
    `${bar} ${info.percent.toFixed(0)}%\n` +
    `📦 ${info.size} • ${info.speed} • ETA ${info.eta}\n` +
    `⏱ ${startStr} → ${endStr}`;

  try {
    await ctx.telegram.editMessageText(chatId, msgId, undefined, text);
  } catch {}
}

async function processClip(
  ctx: any,
  url: string,
  startSec: number,
  startStr: string,
  endSec: number,
  endStr: string
) {
  const duration = endSec - startSec;
  const tmpDir = os.tmpdir();
  const timestamp = Date.now();
  const rawFile = path.join(tmpDir, `yt_raw_${timestamp}.mp4`);
  const clipFile = path.join(tmpDir, `yt_clip_${timestamp}.mp4`);

  const cookiesArgs = hasCookies() ? ["--cookies", COOKIES_PATH] : [];
  const jsArgs = ["--js-runtimes", `node:${NODE_BIN}`];

  const statusMsg = await ctx.reply(
    `⏳ Procesando clip...\n⏱ ${startStr} → ${endStr} (${formatDuration(duration)})` +
    (hasCookies() ? "\n🍪 Usando cookies de YouTube" : "")
  );
  const chatId = ctx.chat.id;
  const msgId = statusMsg.message_id;

  const lastUpdate = { pct: -20, time: 0 };

  const makeProgressHandler = () => (info: ProgressInfo) => {
    updateProgress(ctx, chatId, msgId, info, startStr, endStr, lastUpdate).catch(() => {});
  };

  try {
    logger.info({ url, startSec, endSec, hasCookies: hasCookies() }, "Downloading YouTube video");

    await ctx.telegram.editMessageText(chatId, msgId, undefined,
      `⬇️ Descargando...\n░░░░░░░░░░ 0%\n⏱ ${startStr} → ${endStr}`
    );

    let downloaded = false;

    // Intento 1: sección directa sin HLS (rápido para videos normales)
    const clients = ["default", "web"];
    for (const client of clients) {
      const clientArgs = client === "default" ? [] : ["--extractor-args", `youtube:player_client=${client}`];
      const args = [
        ...jsArgs,
        ...clientArgs,
        ...cookiesArgs,
        "-f", "bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=720]/best",
        "--merge-output-format", "mp4",
        "--download-sections", `*${startSec}-${endSec}`,
        "--force-keyframes-at-cuts",
        "--newline",
        "-o", rawFile,
        url,
      ];
      const ok = await tryYtdlpDownload(args, rawFile, makeProgressHandler(), 120000);
      if (ok) {
        downloaded = true;
        logger.info({ client, method: "sections" }, "Download succeeded");
        break;
      }
      logger.warn({ client, method: "sections" }, "failed, trying next");
    }

    // Intento 2: sección sin force-keyframes (para HLS nativos)
    if (!downloaded) {
      for (const client of clients) {
        const clientArgs = client === "default" ? [] : ["--extractor-args", `youtube:player_client=${client}`];
        const args = [
          ...jsArgs,
          ...clientArgs,
          ...cookiesArgs,
          "-f", "best[height<=720]/best",
          "--merge-output-format", "mp4",
          "--download-sections", `*${startSec}-${endSec}`,
          "--newline",
          "-o", rawFile,
          url,
        ];
        const ok = await tryYtdlpDownload(args, rawFile, makeProgressHandler(), 120000);
        if (ok) {
          downloaded = true;
          logger.info({ client, method: "sections-nofkac" }, "Download succeeded");
          break;
        }
        logger.warn({ client, method: "sections-nofkac" }, "failed, trying next");
      }
    }

    // Intento 3: descarga completa + recorte local con ffmpeg
    if (!downloaded) {
      logger.info("Falling back to full download + local trim");
      await ctx.telegram.editMessageText(chatId, msgId, undefined,
        `⬇️ Descargando stream...\n░░░░░░░░░░ 0%\n⏱ ${startStr} → ${endStr}\n_(Stream live — esto puede tardar más)_`
      );
      lastUpdate.pct = -20;
      lastUpdate.time = 0;

      const fullFile = path.join(tmpDir, `yt_full_${timestamp}.mp4`);
      try {
        for (const client of clients) {
          const clientArgs = client === "default" ? [] : ["--extractor-args", `youtube:player_client=${client}`];
          const args = [
            ...jsArgs,
            ...clientArgs,
            ...cookiesArgs,
            "-f", "best[height<=480]/best",
            "--merge-output-format", "mp4",
            "--max-filesize", "400M",
            "--newline",
            "-o", fullFile,
            url,
          ];
          const ok = await tryYtdlpDownload(args, fullFile, makeProgressHandler(), 300000);
          if (ok) {
            downloaded = true;
            logger.info({ client, method: "full-download" }, "Full download succeeded");
            break;
          }
          logger.warn({ client, method: "full-download" }, "failed, trying next");
        }

        if (downloaded && fs.existsSync(fullFile)) {
          await ctx.telegram.editMessageText(chatId, msgId, undefined, `✂️ Recortando clip del stream...`);
          await execAsync(
            `ffmpeg -y -i "${fullFile}" -ss ${startSec} -t ${duration} -c:v libx264 -c:a aac -preset fast "${rawFile}"`,
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
      throw new Error(
        "LIVE_NOT_READY: El stream de YouTube Live todavía no está archivado o los segmentos no están disponibles. " +
        "Espera unos minutos después de que termine el directo e intenta de nuevo."
      );
    }

    await ctx.telegram.editMessageText(chatId, msgId, undefined, `✂️ Recortando clip...`);
    logger.info({ rawFile, clipFile, duration }, "Trimming video");

    await execAsync(
      `ffmpeg -y -i "${rawFile}" -ss 0 -t ${duration} -c:v libx264 -c:a aac -preset fast "${clipFile}"`,
      { timeout: 60000 }
    );

    if (!fs.existsSync(clipFile)) {
      throw new Error("No se pudo recortar el clip");
    }

    const stats = fs.statSync(clipFile);
    const sizeMB = stats.size / (1024 * 1024);

    if (sizeMB > 50) {
      await cleanupFiles([rawFile, clipFile]);
      return ctx.telegram.editMessageText(chatId, msgId, undefined,
        `❌ El clip pesa ${sizeMB.toFixed(1)}MB, excede el límite de 50MB de Telegram. Prueba con un clip más corto.`
      );
    }

    await ctx.telegram.editMessageText(chatId, msgId, undefined,
      `📤 Enviando clip (${sizeMB.toFixed(1)}MB)...`
    );

    logger.info({ clipFile, sizeMB }, "Sending clip to Telegram");

    await ctx.replyWithVideo(
      { source: clipFile },
      { caption: `🎬 Clip: ${startStr} → ${endStr}` }
    );

    await ctx.telegram.deleteMessage(chatId, msgId).catch(() => {});
  } catch (err: any) {
    logger.error({ err, url }, "Error processing clip");
    const msg = err.stderr || err.message || "Error desconocido";

    let friendly: string;
    if (msg.includes("LIVE_NOT_READY") || msg.includes("LIVE_NOT_READY:")) {
      friendly =
        "⏳ *El stream de YouTube Live todavía no está disponible para descargar.*\n\n" +
        "YouTube tarda unos minutos (a veces horas) en archivar el video después de que termina el directo.\n\n" +
        "Espera un momento e intenta de nuevo con /clip.";
    } else if (msg.includes("Sign in") || msg.includes("bot") || msg.includes("cookies")) {
      friendly =
        "🔒 YouTube requiere autenticación para este video.\n\n" +
        "Usa /cookies para configurar las cookies de YouTube.";
    } else if (msg.includes("unavailable") || msg.includes("Private")) {
      friendly = "❌ El video no está disponible o es privado.";
    } else if (msg.includes("age")) {
      friendly = "🔞 El video tiene restricción de edad.";
    } else if (msg.includes("TIMEOUT") || msg.includes("timeout")) {
      friendly = "⏱ El proceso tardó demasiado. Intenta con un clip más corto o espera un momento.";
    } else {
      friendly = "❌ No se pudo procesar el clip. Verifica el link e intenta de nuevo.";
    }

    try {
      await ctx.telegram.editMessageText(chatId, msgId, undefined, friendly, { parse_mode: "Markdown" });
    } catch {
      await ctx.reply(friendly, { parse_mode: "Markdown" });
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
    `🔴 *Preparando grabación...*\n⏱ Duración: ${formatDuration(durationSec)}`,
    { parse_mode: "Markdown" }
  );
  const msgId = statusMsg.message_id;

  try {
    // Obtener la URL del stream HLS con yt-dlp
    await ctx.telegram.editMessageText(chatId, msgId, undefined,
      `🔍 Obteniendo URL del stream...`
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

    // Mostrar cuenta regresiva mientras graba
    await ctx.telegram.editMessageText(chatId, msgId, undefined,
      `🔴 *Grabando en vivo...*\n⏳ ${formatDuration(durationSec)} restantes\n\n_No cierres el chat, te envío el clip al terminar._`,
      { parse_mode: "Markdown" }
    );

    // Actualizar contador cada 15 segundos
    let elapsed = 0;
    const countdownInterval = setInterval(async () => {
      elapsed += 15;
      const remaining = Math.max(0, durationSec - elapsed);
      try {
        await ctx.telegram.editMessageText(chatId, msgId, undefined,
          `🔴 *Grabando en vivo...*\n⏳ ${formatDuration(remaining)} restantes\n\n_No cierres el chat, te envío el clip al terminar._`,
          { parse_mode: "Markdown" }
        );
      } catch {}
    }, 15000);

    // Grabar con ffmpeg directamente de la URL HLS
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
        `❌ La grabación pesa ${sizeMB.toFixed(1)}MB, excede el límite de 50MB de Telegram. Prueba con menos tiempo.`
      );
    }

    await ctx.telegram.editMessageText(chatId, msgId, undefined,
      `📤 Enviando grabación (${sizeMB.toFixed(1)}MB)...`
    );

    logger.info({ outFile, sizeMB }, "Sending live recording");

    await ctx.replyWithVideo(
      { source: outFile },
      { caption: `🔴 Grabación en vivo — ${formatDuration(durationSec)}` }
    );

    await ctx.telegram.deleteMessage(chatId, msgId).catch(() => {});
  } catch (err: any) {
    logger.error({ err, url }, "Error recording live stream");
    const msg = err.stderr || err.message || "";

    let friendly: string;
    if (msg.includes("403") || msg.includes("Forbidden")) {
      friendly =
        "❌ No se pudo acceder al stream. YouTube bloqueó la solicitud.\n\n" +
        "Asegúrate de tener las cookies configuradas con /cookies y que el video sea público.";
    } else if (msg.includes("live") || msg.includes("not available")) {
      friendly = "❌ Este link no parece ser un directo activo en este momento.";
    } else if (msg.includes("timeout") || msg.includes("TIMEOUT")) {
      friendly = "⏱ La grabación tardó demasiado. Intenta de nuevo.";
    } else {
      friendly = "❌ No se pudo grabar el stream. Verifica que el link sea de un YouTube Live activo.";
    }

    try {
      await ctx.telegram.editMessageText(chatId, msgId, undefined, friendly);
    } catch {
      await ctx.reply(friendly);
    }
  } finally {
    await cleanupFiles([outFile]);
  }
}

bot.command("start", (ctx) => {
  resetSession(ctx.chat.id);
  ctx.reply(
    `👋 *Bot de clips de YouTube*\n\n` +
    `Este bot te permite recortar fragmentos de cualquier video de YouTube y recibirlos directamente aquí en Telegram.\n\n` +
    `Solo indícame el link del video y los tiempos de inicio y fin, y te envío el clip listo.\n\n` +
    `📌 *Comandos:*\n` +
    `/clip — Recortar un fragmento de un video\n` +
    `/grabar — Grabar los próximos minutos de un directo\n` +
    `/cookies — Configurar cookies (para videos /live)\n` +
    `/cancelar — Cancelar la operación actual\n\n` +
    `_Creado por @iMaicol_`,
    { parse_mode: "Markdown" }
  );
});

bot.command("cookies", (ctx) => {
  const estado = hasCookies()
    ? "✅ *Cookies configuradas* — las descargas de YouTube Live están habilitadas."
    : "⚠️ *Sin cookies* — los videos /live y algunos restringidos no funcionarán.";

  ctx.reply(
    `🍪 *Configurar cookies de YouTube*\n\n${estado}\n\n` +
    `Para descargar videos \`/live\` y otros con restricciones necesitas exportar tus cookies de YouTube.\n\n` +
    `*Pasos:*\n` +
    `1. Instala la extensión *"Get cookies.txt LOCALLY"* en Chrome/Edge\n` +
    `2. Entra a [youtube.com](https://youtube.com) con tu cuenta\n` +
    `3. Haz clic en la extensión y exporta el archivo \`cookies.txt\`\n` +
    `4. Envíame ese archivo aquí como documento\n\n` +
    `🔒 Las cookies se guardan solo en este servidor y se usan únicamente para descargar videos.`,
    { parse_mode: "Markdown", link_preview_options: { is_disabled: true } }
  );
});

bot.command("cancelar", (ctx) => {
  resetSession(ctx.chat.id);
  ctx.reply("❌ Cancelado. Envía /clip cuando quieras empezar de nuevo.");
});

bot.command("clip", (ctx) => {
  const session = getSession(ctx.chat.id);
  session.step = "waiting_url";
  session.url = undefined;
  session.startSec = undefined;
  session.startStr = undefined;
  ctx.reply("🔗 Paso 1/3 — Envíame el link de YouTube:");
});

bot.command("miid", (ctx) => {
  ctx.reply(
    `🪪 Tu ID de Telegram es:\n\n\`${ctx.chat.id}\`\n\nCopia este número y dáselo al administrador del bot para activar permisos especiales.`,
    { parse_mode: "Markdown" }
  );
});

bot.command("grabar", (ctx) => {
  if (!hasCookies()) {
    return ctx.reply(
      "⚠️ Para grabar un YouTube Live necesitas tener las cookies configuradas.\n\nUsa /cookies para ver las instrucciones."
    );
  }
  const session = getSession(ctx.chat.id);
  session.step = "waiting_live_url";
  session.url = undefined;
  ctx.reply(
    `🔴 *Grabar YouTube Live*\n\n` +
    `Este comando graba los próximos minutos de un directo en tiempo real.\n\n` +
    `📌 Paso 1/2 — Envíame el link del YouTube Live activo:`,
    { parse_mode: "Markdown" }
  );
});

bot.on("document", async (ctx) => {
  const doc = ctx.message.document;
  const fileName = doc.file_name?.toLowerCase() ?? "";

  if (!fileName.includes("cookie") && !fileName.endsWith(".txt")) {
    return ctx.reply('Para subir cookies, envía un archivo .txt exportado desde tu navegador.\n\nUsa /cookies para ver las instrucciones.');
  }

  if (!isOwner(ctx.chat.id)) {
    return ctx.reply("⛔ Solo el administrador del bot puede actualizar las cookies.");
  }

  const statusMsg = await ctx.reply("⏳ Guardando cookies...");

  try {
    const fileLink = await ctx.telegram.getFileLink(doc.file_id);
    await downloadFile(fileLink.href, COOKIES_PATH);

    const stats = fs.statSync(COOKIES_PATH);
    if (stats.size < 100) {
      fs.unlinkSync(COOKIES_PATH);
      return ctx.telegram.editMessageText(
        ctx.chat.id, statusMsg.message_id, undefined,
        "❌ El archivo de cookies parece estar vacío o incompleto. Exporta de nuevo."
      );
    }

    logger.info({ size: stats.size }, "Cookies saved");

    await ctx.telegram.editMessageText(
      ctx.chat.id, statusMsg.message_id, undefined,
      `✅ *Cookies guardadas correctamente* (${(stats.size / 1024).toFixed(1)} KB)\n\nAhora puedes descargar videos /live y otros restringidos. Usa /clip para continuar.`,
      { parse_mode: "Markdown" }
    );
  } catch (err: any) {
    logger.error({ err }, "Failed to save cookies");
    await ctx.telegram.editMessageText(
      ctx.chat.id, statusMsg.message_id, undefined,
      "❌ No se pudo guardar el archivo. Intenta de nuevo."
    );
  }
});

bot.on("text", async (ctx) => {
  const chatId = ctx.chat.id;
  const session = getSession(chatId);
  const text = ctx.message.text.trim();

  if (text.startsWith("/")) return;

  if (session.step === "idle") {
    return ctx.reply("Envía /clip para crear un clip de YouTube.");
  }

  if (session.step === "waiting_url") {
    if (!text.includes("youtube.com") && !text.includes("youtu.be")) {
      return ctx.reply("❌ Eso no parece un link de YouTube. Envíame un link válido:");
    }
    session.url = text;
    session.step = "waiting_start";
    return ctx.reply(
      "⏱ Paso 2/3 — ¿Desde qué momento? Envía el tiempo de inicio:\n\n_Ejemplo: `1:30` (minuto 1, segundo 30)_",
      { parse_mode: "Markdown" }
    );
  }

  if (session.step === "waiting_start") {
    let startSec: number;
    try {
      startSec = parseTime(text);
    } catch {
      return ctx.reply(
        "❌ Formato inválido. Usa `mm:ss` o `hh:mm:ss`\n_Ejemplo: `1:30` o `0:45`_",
        { parse_mode: "Markdown" }
      );
    }
    session.startSec = startSec;
    session.startStr = text;
    session.step = "waiting_end";
    return ctx.reply(
      `⏱ Paso 3/3 — ¿Hasta qué momento? Envía el tiempo de fin:\n\n_Inicio: \`${text}\`_`,
      { parse_mode: "Markdown" }
    );
  }

  if (session.step === "waiting_end") {
    let endSec: number;
    try {
      endSec = parseTime(text);
    } catch {
      return ctx.reply(
        "❌ Formato inválido. Usa `mm:ss` o `hh:mm:ss`\n_Ejemplo: `2:00` o `1:15`_",
        { parse_mode: "Markdown" }
      );
    }

    const startSec = session.startSec!;
    const startStr = session.startStr!;
    const url = session.url!;

    if (endSec <= startSec) {
      return ctx.reply(
        `❌ El tiempo de fin (\`${text}\`) debe ser mayor que el inicio (\`${startStr}\`). Envía otro tiempo de fin:`,
        { parse_mode: "Markdown" }
      );
    }

    const duration = endSec - startSec;
    if (duration > 180) {
      return ctx.reply(
        `❌ El clip dura ${formatDuration(duration)}, máximo permitido es 3 minutos. Envía un tiempo de fin menor:`
      );
    }

    resetSession(chatId);
    await processClip(ctx, url, startSec, startStr, endSec, text);
  }

  if (session.step === "waiting_live_url") {
    if (!text.includes("youtube.com") && !text.includes("youtu.be")) {
      return ctx.reply("❌ Eso no parece un link de YouTube. Envíame un link válido:");
    }
    session.url = text;
    session.step = "waiting_record_duration";
    return ctx.reply(
      `⏱ Paso 2/2 — ¿Cuántos minutos quieres grabar?\n\n` +
      `Envía un número entre 1 y 3:\n_Ejemplo: \`2\` (graba los próximos 2 minutos)_`,
      { parse_mode: "Markdown" }
    );
  }

  if (session.step === "waiting_record_duration") {
    const mins = parseFloat(text.replace(",", "."));
    if (isNaN(mins) || mins <= 0 || mins > 3) {
      return ctx.reply(
        "❌ Envía un número válido entre 1 y 3 minutos.\n_Ejemplo: `1`, `2` o `3`_",
        { parse_mode: "Markdown" }
      );
    }
    const durationSec = Math.round(mins * 60);
    const url = session.url!;
    resetSession(chatId);
    await processRecording(ctx, url, durationSec);
  }
});

export async function startBot() {
  bot.catch((err, ctx) => {
    logger.error({ err }, "Unhandled bot error");
    ctx.reply("❌ Ocurrió un error inesperado. Intenta de nuevo con /clip.").catch(() => {});
  });

  try {
    await bot.telegram.setMyCommands([
      { command: "clip", description: "🎬 Recortar un fragmento de un video" },
      { command: "grabar", description: "🔴 Grabar los próximos minutos de un directo" },
      { command: "cookies", description: "🍪 Configurar cookies (para videos /live)" },
      { command: "cancelar", description: "❌ Cancelar la operación actual" },
      { command: "miid", description: "🪪 Ver mi ID de Telegram" },
      { command: "start", description: "👋 Ver bienvenida y ayuda" },
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
