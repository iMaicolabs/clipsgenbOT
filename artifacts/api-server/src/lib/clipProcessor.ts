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

function cleanup(...files: string[]) {
  for (const f of files) {
    try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  }
}

// Spawns one yt-dlp process and resolves with the output file path
function spawnYtdlp(
  args: string[],
  onProgress: (pct: number) => void,
  timeoutMs = 60000
): { promise: Promise<string>; kill: () => void } {
  let proc: ReturnType<typeof spawn> | null = null;

  const promise = new Promise<string>((resolve, reject) => {
    proc = spawn(YTDLP_BIN, args, { shell: false });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc?.kill("SIGTERM");
      reject(new Error("timeout"));
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

  return {
    promise,
    kill: () => { try { proc?.kill("SIGTERM"); } catch {} },
  };
}

const PLAYER_CLIENTS = ["ios", "android_creator", "tv_embedded", "default", "web", "mweb"];

// Runs all yt-dlp clients in PARALLEL — resolves with first successful file
async function raceYtdlpClients(
  url: string,
  fmt: string,
  startSec: number,
  endSec: number,
  cookiesArgs: string[],
  timestamp: number,
  onProgress: (pct: number) => void
): Promise<{ file: string; errors: string[] }> {
  const errors: string[] = [];
  const handles: Array<{ client: string; kill: () => void; outArg: string }> = [];

  // Only report the highest progress seen across all parallel clients (no chaotic jumps)
  let bestPct = 0;
  const throttledProgress = (pct: number) => {
    if (pct > bestPct) {
      bestPct = pct;
      onProgress(pct);
    }
  };

  const clientPromises = PLAYER_CLIENTS.map(async (client) => {
    const clientArgs = client === "default"
      ? []
      : ["--extractor-args", `youtube:player_client=${client}`];

    const outArg = path.join(os.tmpdir(), `cgb_${timestamp}_${client}.mp4`);

    const args = [
      "--js-runtimes", `node:${NODE_BIN}`,
      ...clientArgs,
      ...cookiesArgs,
      "-f", fmt,
      "--merge-output-format", "mp4",
      "--download-sections", `*${startSec}-${endSec}`,
      "--newline",
      "--no-playlist",
      "--concurrent-fragments", "4",
      "-o", outArg,
      url,
    ];

    const handle = spawnYtdlp(args, throttledProgress, 60000);
    handles.push({ client, kill: handle.kill, outArg });

    const dest = await handle.promise;
    const actualFile = [dest, outArg].find(f => f && fs.existsSync(f) && fs.statSync(f).size > 1000);
    if (!actualFile) throw new Error("empty output");
    return actualFile;
  });

  // Promise.any resolves as soon as ONE succeeds
  try {
    const winner = await Promise.any(clientPromises);

    // Kill all other processes to free resources
    for (const h of handles) {
      if (h.outArg !== winner) {
        h.kill();
        cleanup(h.outArg);
      }
    }

    return { file: winner, errors };
  } catch (aggErr: any) {
    // All clients failed — collect their error messages
    const errs = (aggErr.errors ?? []) as any[];
    for (let i = 0; i < PLAYER_CLIENTS.length; i++) {
      const e = errs[i];
      const msg = e?.stderr ?? e?.message ?? String(e);
      errors.push(`${PLAYER_CLIENTS[i]}: ${msg.slice(0, 200)}`);
    }
    // Cleanup all temp files
    for (const h of handles) cleanup(h.outArg);
    return { file: "", errors };
  }
}

// Probe video and audio stream start times in a downloaded yt-dlp file.
// yt-dlp --download-sections starts video from the nearest keyframe (slightly before the
// requested time) but audio often starts at the exact requested time, causing a desync.
async function probeStreamStarts(inputFile: string): Promise<{ vStart: number; aStart: number }> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v quiet -print_format json -show_streams "${inputFile}"`,
      { timeout: 10000 }
    );
    const streams: any[] = JSON.parse(stdout).streams ?? [];
    const vStart = parseFloat(streams.find(s => s.codec_type === "video")?.start_time ?? "0");
    const aStart = parseFloat(streams.find(s => s.codec_type === "audio")?.start_time ?? "0");
    const result = {
      vStart: isFinite(vStart) ? vStart : 0,
      aStart: isFinite(aStart) ? aStart : 0,
    };
    logger.info({ vStart: result.vStart, aStart: result.aStart, diff: Math.abs(result.vStart - result.aStart) }, "probeStreamStarts");
    return result;
  } catch (e: any) {
    logger.warn({ err: e?.message }, "probeStreamStarts failed");
    return { vStart: 0, aStart: 0 };
  }
}

// Build the ffmpeg input arguments that align video and audio start times.
// Uses -itsoffset on whichever stream starts earlier so both end up at the same
// point in the output timeline. avoid_negative_ts make_zero then shifts everything to 0.
function syncedInputArgs(inputFile: string, vStart: number, aStart: number): string {
  const diff = Math.abs(vStart - aStart);
  if (diff < 0.05) {
    // Streams are already in sync — single input
    return `-i "${inputFile}"`;
  }

  const offset = diff.toFixed(4);
  if (aStart > vStart) {
    // Audio starts later → apply itsoffset to video input so video timestamps
    // advance to meet the audio start. Streams end up at the same output time.
    return `-itsoffset ${offset} -i "${inputFile}" -i "${inputFile}" -map 0:v:0 -map 1:a:0`;
  } else {
    // Video starts later → offset audio input
    return `-i "${inputFile}" -itsoffset ${offset} -i "${inputFile}" -map 0:v:0 -map 1:a:0`;
  }
}

// Fast remux without re-encoding — preserves original quality, near-instant.
async function fastMux(inputFile: string, outputFile: string, duration: number): Promise<boolean> {
  try {
    await execAsync(
      `ffmpeg -y -i "${inputFile}" -t ${duration} -c copy -avoid_negative_ts make_zero -movflags +faststart "${outputFile}"`,
      { timeout: 30000 }
    );
    const size = fs.existsSync(outputFile) ? fs.statSync(outputFile).size : 0;
    return size > 1000;
  } catch {
    return false;
  }
}

// Fallback: re-encode audio only (keep video stream, just re-encode audio to aac for compatibility).
async function muxWithAudioReencode(inputFile: string, outputFile: string, duration: number, hasAudio: boolean): Promise<void> {
  const audioArgs = hasAudio
    ? ["-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"]
    : ["-map", "0:v:0", "-c:v", "copy", "-an", "-movflags", "+faststart"];

  await execAsync(
    `ffmpeg -y -i "${inputFile}" -t ${duration} ${audioArgs.join(" ")} "${outputFile}"`,
    { timeout: 60000 }
  );
}

// Fix audio/video stream desync in the final clip.
// yt-dlp merges DASH streams preserving edit lists (so ffprobe reports 0/0),
// but -c copy exposes the raw PTS values causing video/audio to start at different times.
// This post-process step detects and corrects any such offset in the output clip.
async function fixStreamSync(clipFile: string, duration: number): Promise<void> {
  const { vStart, aStart } = await probeStreamStarts(clipFile);
  const diff = Math.abs(vStart - aStart);
  if (diff < 0.05) return; // Already in sync

  logger.info({ vStart, aStart, diff }, "Fixing stream desync in clip");
  const inputArgs = syncedInputArgs(clipFile, vStart, aStart);
  const tmpFile = clipFile + ".sync.mp4";

  try {
    await execAsync(
      `ffmpeg -y ${inputArgs} -t ${duration} -c copy -avoid_negative_ts make_zero -movflags +faststart "${tmpFile}"`,
      { timeout: 60000 }
    );
    if (fs.existsSync(tmpFile) && fs.statSync(tmpFile).size > 1000) {
      fs.renameSync(tmpFile, clipFile);
      logger.info({ diff }, "Stream desync fixed");
    }
  } catch {
    cleanup(tmpFile);
  }
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
  const clipFile = path.join(CLIPS_DIR, `clip_${jobId}.mp4`);
  const cookiesArgs = hasCookies() ? ["--cookies", COOKIES_PATH] : [];
  const fmt = qualityFormat(quality);

  try {
    updateJob(job, { status: "processing", progress: 5, progressMsg: "Descargando..." });

    // ── 1. Race all yt-dlp clients in parallel ──────────────────────────────
    const { file: downloadedFile, errors } = await raceYtdlpClients(
      url, fmt, startSec, endSec, cookiesArgs, timestamp,
      (pct) => updateJob(job, {
        progress: Math.round(5 + pct * 0.75),
        progressMsg: `Descargando... ${pct.toFixed(0)}%`,
      })
    );

    if (!downloadedFile) {
      // ── 2. Piped fallback ─────────────────────────────────────────────────
      logger.warn({ jobId, errors }, "All yt-dlp clients failed — trying Piped fallback");
      updateJob(job, { progress: 40, progressMsg: "Usando servidor alternativo..." });

      try {
        const qualityNum = parseInt(quality) || 720;
        const piped = await getPipedStreams(url, qualityNum);

        updateJob(job, { progress: 50, progressMsg: "Descargando con servidor alternativo..." });

        await execAsync(
          `ffmpeg -y -ss ${startSec} -t ${duration} -i "${piped.videoUrl}" -ss ${startSec} -t ${duration} -i "${piped.audioUrl}" ` +
          `-map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 128k -avoid_negative_ts make_zero -movflags +faststart "${clipFile}"`,
          { timeout: 120000 }
        );
        updateJob(job, { progress: 95, progressMsg: "Finalizando..." });
      } catch (pipedErr: any) {
        logger.error({ jobId, pipedErr, ytdlpErrors: errors }, "Piped fallback also failed");
        const isPrivate = errors.some(e => /private|unavailable|not available/i.test(e));
        throw new Error(isPrivate
          ? "El video es privado o no está disponible en tu región."
          : "No se pudo descargar el video. Es posible que YouTube esté bloqueando temporalmente las descargas desde este servidor. Intenta más tarde."
        );
      }
    } else {
      // ── 3. Fast remux — no re-encoding, preserves original quality ────────
      updateJob(job, { progress: 82, progressMsg: "Procesando clip..." });

      const ok = await fastMux(downloadedFile, clipFile, duration);

      if (!ok) {
        // Fallback: re-encode only audio (keep video untouched)
        const probeOut = await execAsync(
          `ffprobe -v quiet -print_format json -show_streams "${downloadedFile}"`,
          { timeout: 10000 }
        ).catch(() => ({ stdout: "{}" }));
        const probeData = JSON.parse((probeOut as any).stdout || "{}");
        const hasAudio = (probeData.streams || []).some((s: any) => s.codec_type === "audio");
        await muxWithAudioReencode(downloadedFile, clipFile, duration, hasAudio);
      }

      cleanup(downloadedFile);
    }

    // Fix audio/video stream desync that arises when -c copy exposes raw PTS
    // values from yt-dlp's edit-list-wrapped DASH segments.
    await fixStreamSync(clipFile, duration);

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
