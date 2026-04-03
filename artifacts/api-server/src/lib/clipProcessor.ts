import { spawn, exec, execSync } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";
import { EventEmitter } from "events";
import { logger } from "./logger";
import { getPipedStreams } from "./pipedDownloader";

const execAsync = promisify(exec);

export const DATA_DIR = process.env["DATA_DIR"] ?? "/home/runner/workspace/data";
export const CLIPS_DIR = path.join(DATA_DIR, "web_clips");
const COOKIES_PATH = path.join(DATA_DIR, "yt_cookies.txt");
const YTDLP_BIN =
  process.env["YTDLP_BIN"] ??
  (fs.existsSync("/home/runner/workspace/bin/yt-dlp")
    ? "/home/runner/workspace/bin/yt-dlp"
    : "yt-dlp");
const NODE_BIN = (() => {
  try { return execSync("which node", { encoding: "utf8" }).trim(); }
  catch { return "node"; }
})();

if (!fs.existsSync(CLIPS_DIR)) {
  fs.mkdirSync(CLIPS_DIR, { recursive: true });
}

export function hasCookies(): boolean {
  return fs.existsSync(COOKIES_PATH) && fs.statSync(COOKIES_PATH).size > 100;
}

export interface ClipJob {
  id: string;
  status: "pending" | "processing" | "done" | "error";
  progress: number;
  progressMsg: string;
  filePath?: string;
  sizeBytes?: number;
  videoTitle?: string;
  error?: string;
}

export const jobEmitter = new EventEmitter();
jobEmitter.setMaxListeners(200);
export const jobs = new Map<string, ClipJob>();

export interface VideoInfo {
  title: string;
  thumbnail: string;
  duration: number;
  uploader: string;
}

export async function getVideoInfo(url: string): Promise<VideoInfo> {
  const { stdout } = await execAsync(
    `"${YTDLP_BIN}" --js-runtimes "node:${NODE_BIN}" --print-json --skip-download --no-playlist "${url}"`,
    { timeout: 30000 }
  );
  const data = JSON.parse(stdout.trim());
  return {
    title: data.title ?? "Untitled",
    thumbnail: data.thumbnail ?? data.thumbnails?.[0]?.url ?? "",
    duration: data.duration ?? 0,
    uploader: data.uploader ?? data.channel ?? "",
  };
}

function qualityFormat(q: string): string {
  return (
    `bestvideo[ext=mp4][height<=${q}]+bestaudio[ext=m4a]` +
    `/bestvideo[height<=${q}]+bestaudio` +
    `/best[height<=${q}]/best`
  );
}

function updateJob(job: ClipJob, updates: Partial<ClipJob>) {
  Object.assign(job, updates);
  jobEmitter.emit(`progress:${job.id}`, { ...job });
}

function spawnYtdlp(
  args: string[],
  onProgress: (pct: number) => void,
  timeoutMs = 180000
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP_BIN, args, { shell: false });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      reject(new Error("Tiempo de espera agotado al descargar el video"));
    }, timeoutMs);

    let stdoutBuf = "";
    let destFile = "";

    proc.stdout.on("data", (data: Buffer) => {
      const text = data.toString();
      stdoutBuf += text;
      for (const line of text.split("\n")) {
        const pct = line.match(/\[download\]\s+([\d.]+)%/);
        if (pct) onProgress(parseFloat(pct[1]));
        const dest = line.match(/\[download\] Destination: (.+)/);
        if (dest) destFile = dest[1].trim();
        const merge = line.match(/\[Merger\] Merging formats into "(.+)"/);
        if (merge) destFile = merge[1].trim();
        const already = line.match(/\[download\] (.+) has already been downloaded/);
        if (already) destFile = already[1].trim();
      }
    });

    let stderrBuf = "";
    proc.stderr.on("data", (d: Buffer) => { stderrBuf += d.toString(); });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return;
      if (code === 0) {
        resolve(destFile);
      } else {
        const err: any = new Error(`yt-dlp exit ${code}`);
        err.stderr = stderrBuf;
        err.stdout = stdoutBuf;
        reject(err);
      }
    });
    proc.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

const PLAYER_CLIENTS = ["ios", "android_creator", "tv_embedded", "default", "web", "mweb"];

export async function processClipJob(
  jobId: string,
  url: string,
  startSec: number,
  endSec: number,
  quality: string
): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;

  const duration = endSec - startSec;
  const timestamp = Date.now();
  const rawFile = path.join(os.tmpdir(), `cgb_raw_${timestamp}.mp4`);
  const clipFile = path.join(CLIPS_DIR, `clip_${jobId}.mp4`);
  const cookiesArgs = hasCookies() ? ["--cookies", COOKIES_PATH] : [];
  const fmt = qualityFormat(quality);

  const cleanup = (file: string) => {
    try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
  };

  try {
    updateJob(job, { status: "processing", progress: 5, progressMsg: "Analizando video..." });

    let downloadedFile: string | null = null;
    const errors: string[] = [];

    for (const client of PLAYER_CLIENTS) {
      const clientArgs = client === "default"
        ? []
        : ["--extractor-args", `youtube:player_client=${client}`];

      const outArg = rawFile.replace(/\.mp4$/, `.${client}.mp4`);

      const args = [
        "--js-runtimes", `node:${NODE_BIN}`,
        ...clientArgs,
        ...cookiesArgs,
        "-f", fmt,
        "--merge-output-format", "mp4",
        "--download-sections", `*${startSec}-${endSec}`,
        "--newline",
        "--no-playlist",
        "-o", outArg,
        url,
      ];

      try {
        updateJob(job, { progressMsg: `Descargando (intento ${PLAYER_CLIENTS.indexOf(client) + 1}/${PLAYER_CLIENTS.length})...` });
        const dest = await spawnYtdlp(args, (pct) => {
          updateJob(job, {
            progress: Math.round(5 + pct * 0.7),
            progressMsg: `Descargando... ${pct.toFixed(0)}%`,
          });
        }, 120000);

        const actualFile = [dest, outArg].find(f => f && fs.existsSync(f) && fs.statSync(f).size > 0);
        if (actualFile) {
          downloadedFile = actualFile;
          break;
        }
        errors.push(`${client}: archivo no encontrado tras descarga`);
        cleanup(outArg);
      } catch (e: any) {
        const detail = (e.stderr ?? e.message ?? "").slice(0, 200);
        logger.warn({ client, jobId, detail }, "yt-dlp client attempt failed");
        errors.push(`${client}: ${detail}`);
        cleanup(outArg);
      }
    }

    if (!downloadedFile) {
      logger.warn({ jobId, errors }, "All yt-dlp clients failed — trying Piped fallback");
      updateJob(job, { progress: 40, progressMsg: "Usando servidor alternativo..." });

      try {
        const qualityNum = parseInt(quality) || 720;
        const piped = await getPipedStreams(url, qualityNum);
        logger.info({ jobId, instance: "piped" }, "Piped streams obtained");

        updateJob(job, { progress: 50, progressMsg: "Descargando con servidor alternativo..." });

        // Use ffmpeg to download both streams simultaneously and cut to section
        await execAsync(
          `ffmpeg -y -ss ${startSec} -t ${duration} -i "${piped.videoUrl}" -ss ${startSec} -t ${duration} -i "${piped.audioUrl}" ` +
          `-map 0:v:0 -map 1:a:0 -c:v libx264 -c:a aac -preset fast -movflags +faststart "${clipFile}"`,
          { timeout: 180000 }
        );
        updateJob(job, { progress: 95, progressMsg: "Finalizando..." });
      } catch (pipedErr: any) {
        logger.error({ jobId, pipedErr, ytdlpErrors: errors }, "Piped fallback also failed");
        const isPrivate = errors.some(e => /private|unavailable|not available/i.test(e));
        const hint = isPrivate
          ? "El video es privado o no está disponible en tu región."
          : "No se pudo descargar el video. Es posible que YouTube esté bloqueando temporalmente las descargas desde este servidor. Intenta más tarde.";
        throw new Error(hint);
      }
    } else {
      updateJob(job, { progress: 78, progressMsg: "Recortando clip..." });

      const probeOut = await execAsync(
        `ffprobe -v quiet -print_format json -show_streams "${downloadedFile}"`,
        { timeout: 10000 }
      ).catch(() => ({ stdout: "{}" }));
      const probeData = JSON.parse((probeOut as any).stdout || "{}");
      const hasAudio = (probeData.streams || []).some((s: any) => s.codec_type === "audio");

      const ffmpegAudioArgs = hasAudio
        ? ["-map", "0:v:0", "-map", "0:a:0", "-c:v", "libx264", "-c:a", "aac", "-preset", "fast", "-movflags", "+faststart"]
        : ["-map", "0:v:0", "-c:v", "libx264", "-preset", "fast", "-an", "-movflags", "+faststart"];

      await execAsync(
        `ffmpeg -y -i "${downloadedFile}" -ss 0 -t ${duration} ${ffmpegAudioArgs.join(" ")} "${clipFile}"`,
        { timeout: 120000 }
      );

      cleanup(downloadedFile);
    }

    if (!fs.existsSync(clipFile) || fs.statSync(clipFile).size === 0) {
      throw new Error("El recorte falló — el archivo de salida está vacío");
    }

    const stats = fs.statSync(clipFile);
    updateJob(job, {
      status: "done",
      progress: 100,
      progressMsg: "¡Listo!",
      filePath: clipFile,
      sizeBytes: stats.size,
    });
    logger.info({ jobId, sizeMB: (stats.size / 1024 / 1024).toFixed(1) }, "Clip job done");

  } catch (err: any) {
    logger.error({ err, jobId }, "Clip job error");
    updateJob(job, {
      status: "error",
      progress: 0,
      progressMsg: "",
      error: err.message ?? "Error desconocido",
    });
  }
}
