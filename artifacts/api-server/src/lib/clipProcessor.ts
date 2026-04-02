import { spawn, exec, execSync } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";
import { EventEmitter } from "events";
import { logger } from "./logger";

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

function spawnYtdlp(args: string[], onProgress: (pct: number) => void, timeoutMs = 180000): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP_BIN, args, { shell: false });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      reject(new Error("TIMEOUT"));
    }, timeoutMs);

    proc.stdout.on("data", (data: Buffer) => {
      for (const line of data.toString().split("\n")) {
        const m = line.match(/\[download\]\s+([\d.]+)%/);
        if (m) onProgress(parseFloat(m[1]));
      }
    });

    let stderrBuf = "";
    proc.stderr.on("data", (d: Buffer) => { stderrBuf += d.toString(); });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return;
      if (code === 0) resolve();
      else {
        const err: any = new Error(`yt-dlp exit ${code}`);
        err.stderr = stderrBuf;
        reject(err);
      }
    });
    proc.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

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
  const jsArgs = ["--js-runtimes", `node:${NODE_BIN}`];
  const fmt = qualityFormat(quality);

  const cleanup = () => { try { if (fs.existsSync(rawFile)) fs.unlinkSync(rawFile); } catch {} };

  try {
    updateJob(job, { status: "processing", progress: 5, progressMsg: "Analizando video..." });

    let downloaded = false;
    for (const client of ["default", "web"]) {
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
      try {
        await spawnYtdlp(args, (pct) => {
          updateJob(job, { progress: Math.round(5 + pct * 0.6), progressMsg: `Descargando... ${pct.toFixed(0)}%` });
        }, 120000);
        if (fs.existsSync(rawFile) && fs.statSync(rawFile).size > 0) {
          downloaded = true;
          break;
        }
      } catch (e) {
        try { fs.unlinkSync(rawFile); } catch {}
      }
    }

    if (!downloaded) {
      throw new Error("No se pudo descargar el video. Verifica la URL o intenta más tarde.");
    }

    updateJob(job, { progress: 75, progressMsg: "Recortando clip..." });

    const probeOut = await execAsync(
      `ffprobe -v quiet -print_format json -show_streams "${rawFile}"`,
      { timeout: 10000 }
    ).catch(() => ({ stdout: "{}" }));
    const probeData = JSON.parse((probeOut as any).stdout || "{}");
    const hasAudio = (probeData.streams || []).some((s: any) => s.codec_type === "audio");

    if (hasAudio) {
      await execAsync(
        `ffmpeg -y -i "${rawFile}" -ss 0 -t ${duration} -map 0:v:0 -map 0:a:0 -c:v libx264 -c:a aac -preset fast -movflags +faststart "${clipFile}"`,
        { timeout: 60000 }
      );
    } else {
      await execAsync(
        `ffmpeg -y -i "${rawFile}" -ss 0 -t ${duration} -map 0:v:0 -c:v libx264 -preset fast -an -movflags +faststart "${clipFile}"`,
        { timeout: 60000 }
      );
    }

    if (!fs.existsSync(clipFile)) throw new Error("El recorte falló");

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
  } finally {
    cleanup();
  }
}
