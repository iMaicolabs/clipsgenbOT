import { Telegraf, Context } from "telegraf";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";
import { logger } from "./lib/logger";

const execAsync = promisify(exec);

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN is required");
}

export const bot = new Telegraf(token);

function parseTime(t: string): number {
  const parts = t.split(":").map(Number);
  if (parts.some(isNaN)) throw new Error(`Tiempo inválido: ${t}`);
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

bot.command("start", (ctx) => {
  ctx.reply(
    `👋 *Bot de clips de YouTube*\n\n` +
      `Envíame un comando así:\n\n` +
      `\`/clip URL inicio fin\`\n\n` +
      `*Ejemplos:*\n` +
      `\`/clip https://youtu.be/dQw4w9WgXcQ 0:30 1:00\`\n` +
      `\`/clip https://youtu.be/dQw4w9WgXcQ 1:30 2:15\`\n\n` +
      `⏱ Tiempo en formato \`mm:ss\` o \`hh:mm:ss\`\n` +
      `📦 Máximo 50MB por clip`,
    { parse_mode: "Markdown" }
  );
});

bot.command("clip", async (ctx) => {
  const text = ctx.message.text;
  const parts = text.trim().split(/\s+/);

  if (parts.length < 4) {
    return ctx.reply(
      "❌ Formato incorrecto.\n\nUsa: `/clip URL inicio fin`\n\nEjemplo: `/clip https://youtu.be/dQw4w9WgXcQ 0:30 1:00`",
      { parse_mode: "Markdown" }
    );
  }

  const url = parts[1];
  const startStr = parts[2];
  const endStr = parts[3];

  let startSec: number;
  let endSec: number;

  try {
    startSec = parseTime(startStr);
    endSec = parseTime(endStr);
  } catch (e: any) {
    return ctx.reply(`❌ ${e.message}\n\nUsa formato mm:ss (ej: 1:30)`);
  }

  if (endSec <= startSec) {
    return ctx.reply("❌ El tiempo de fin debe ser mayor que el de inicio.");
  }

  const duration = endSec - startSec;
  if (duration > 180) {
    return ctx.reply(
      `❌ El clip es demasiado largo (${formatDuration(duration)}). Máximo 3 minutos.`
    );
  }

  if (!url.includes("youtube.com") && !url.includes("youtu.be")) {
    return ctx.reply("❌ Solo se aceptan links de YouTube.");
  }

  const statusMsg = await ctx.reply(
    `⏳ Procesando clip...\n\n🔗 ${url}\n⏱ ${startStr} → ${endStr} (${formatDuration(duration)})`
  );

  const tmpDir = os.tmpdir();
  const timestamp = Date.now();
  const rawFile = path.join(tmpDir, `yt_raw_${timestamp}.mp4`);
  const clipFile = path.join(tmpDir, `yt_clip_${timestamp}.mp4`);

  try {
    logger.info({ url, startSec, endSec }, "Downloading YouTube video");

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      undefined,
      `⬇️ Descargando video...\n\n⏱ ${startStr} → ${endStr}`
    );

    const ytdlpClients = ["ios", "android", "web_embedded"];
    let downloadError: Error | null = null;

    for (const client of ytdlpClients) {
      try {
        await execAsync(
          `yt-dlp --extractor-args "youtube:player_client=${client}" ` +
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
    const friendly = msg.includes("Sign in") || msg.includes("bot")
      ? "YouTube está bloqueando la descarga. Intenta con otro video o espera unos minutos."
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
        `❌ Error: ${friendly}`
      );
    } catch {
      await ctx.reply(`❌ Error: ${friendly}`);
    }
  } finally {
    await cleanupFiles([rawFile, clipFile]);
  }
});

bot.on("message", (ctx) => {
  ctx.reply(
    '💡 Usa el comando /clip para crear un clip.\n\nEjemplo:\n`/clip https://youtu.be/dQw4w9WgXcQ 0:30 1:00`',
    { parse_mode: "Markdown" }
  );
});

export async function startBot() {
  try {
    await bot.launch();
    logger.info("Telegram bot started (polling)");
  } catch (err) {
    logger.error({ err }, "Failed to start Telegram bot");
    throw err;
  }
}

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
