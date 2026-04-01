import { Telegraf } from "telegraf";
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

type Step = "idle" | "waiting_url" | "waiting_start" | "waiting_end";

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

  const cookiesFlag = hasCookies() ? `--cookies "${COOKIES_PATH}"` : "";

  const statusMsg = await ctx.reply(
    `⏳ Procesando clip...\n⏱ ${startStr} → ${endStr} (${formatDuration(duration)})` +
    (hasCookies() ? "\n🍪 Usando cookies de YouTube" : "")
  );

  try {
    logger.info({ url, startSec, endSec, hasCookies: hasCookies() }, "Downloading YouTube video");

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      undefined,
      `⬇️ Descargando video...\n⏱ ${startStr} → ${endStr}`
    );

    const ytdlpClients = ["ios", "android", "web_embedded", "web"];
    let downloadError: Error | null = null;

    for (const client of ytdlpClients) {
      try {
        await execAsync(
          `yt-dlp --extractor-args "youtube:player_client=${client}" ${cookiesFlag} ` +
            `-f "bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[ext=mp4][height<=720]/best[ext=mp4]/best" ` +
            `--merge-output-format mp4 ` +
            `--download-sections "*${startSec}-${endSec}" ` +
            `--force-keyframes-at-cuts ` +
            `-o "${rawFile}" "${url}"`,
          { timeout: 120000 }
        );
        downloadError = null;
        break;
      } catch (e: any) {
        logger.warn({ client, err: e.message }, "yt-dlp client failed, trying next");
        downloadError = e;
        await cleanupFiles([rawFile]);
      }
    }

    if (downloadError) throw downloadError;

    if (!fs.existsSync(rawFile)) {
      throw new Error("No se pudo descargar el video");
    }

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      undefined,
      `✂️ Recortando clip...`
    );

    logger.info({ rawFile, clipFile, startSec, duration }, "Trimming video");

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
      return ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        undefined,
        `❌ El clip pesa ${sizeMB.toFixed(1)}MB, excede el límite de 50MB de Telegram. Prueba con un clip más corto.`
      );
    }

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      undefined,
      `📤 Enviando clip (${sizeMB.toFixed(1)}MB)...`
    );

    logger.info({ clipFile, sizeMB }, "Sending clip to Telegram");

    await ctx.replyWithVideo(
      { source: clipFile },
      { caption: `🎬 Clip: ${startStr} → ${endStr}` }
    );

    await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
  } catch (err: any) {
    logger.error({ err, url }, "Error processing clip");
    const msg = err.stderr || err.message || "Error desconocido";
    const needsCookies = msg.includes("Sign in") || msg.includes("bot");
    const friendly = needsCookies
      ? `YouTube requiere autenticación para este video.\n\nEnvía /cookies para ver cómo configurar las cookies de YouTube y desbloquear la descarga de videos /live y otros restringidos.`
      : msg.includes("unavailable") || msg.includes("Private")
        ? "El video no está disponible o es privado."
        : msg.includes("age")
          ? "El video tiene restricción de edad."
          : msg.includes("timeout")
            ? "El proceso tardó demasiado. Intenta con un clip más corto."
            : "No se pudo procesar el clip. Verifica el link e intenta de nuevo.";

    try {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        undefined,
        `❌ ${friendly}`
      );
    } catch {
      await ctx.reply(`❌ ${friendly}`);
    }
  } finally {
    await cleanupFiles([rawFile, clipFile]);
  }
}

bot.command("start", (ctx) => {
  resetSession(ctx.chat.id);
  ctx.reply(
    `👋 *Bot de clips de YouTube*\n\n` +
    `Este bot te permite recortar fragmentos de cualquier video de YouTube y recibirlos directamente aquí en Telegram.\n\n` +
    `Solo indícame el link del video y los tiempos de inicio y fin, y te envío el clip listo.\n\n` +
    `📌 *Comandos:*\n` +
    `/clip — Crear un nuevo clip\n` +
    `/cookies — Configurar cookies (necesario para videos /live)\n` +
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

bot.on("document", async (ctx) => {
  const doc = ctx.message.document;
  const fileName = doc.file_name?.toLowerCase() ?? "";

  if (!fileName.includes("cookie") && !fileName.endsWith(".txt")) {
    return ctx.reply('Para subir cookies, envía un archivo .txt exportado desde tu navegador.\n\nUsa /cookies para ver las instrucciones.');
  }

  const statusMsg = await ctx.reply("⏳ Guardando cookies...");

  try {
    const fileLink = await ctx.telegram.getFileLink(doc.file_id);
    await downloadFile(fileLink.href, COOKIES_PATH);

    const stats = fs.statSync(COOKIES_PATH);
    if (stats.size < 100) {
      fs.unlinkSync(COOKIES_PATH);
      return ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        undefined,
        "❌ El archivo de cookies parece estar vacío o incompleto. Exporta de nuevo."
      );
    }

    logger.info({ size: stats.size }, "Cookies saved");

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      undefined,
      `✅ *Cookies guardadas correctamente* (${(stats.size / 1024).toFixed(1)} KB)\n\nAhora puedes descargar videos /live y otros restringidos. Usa /clip para continuar.`
    );
  } catch (err: any) {
    logger.error({ err }, "Failed to save cookies");
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      undefined,
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
});

export async function startBot() {
  try {
    await bot.telegram.setMyCommands([
      { command: "clip", description: "🎬 Crear un clip de YouTube" },
      { command: "cookies", description: "🍪 Configurar cookies (para videos /live)" },
      { command: "cancelar", description: "❌ Cancelar la operación actual" },
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
