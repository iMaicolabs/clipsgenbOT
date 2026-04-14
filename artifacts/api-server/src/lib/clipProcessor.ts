import { spawn, exec, execSync, spawnSync } from "child_process";
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

const PO_TOKEN_CLI = path.resolve(
  path.join(__dirname, "../../../node_modules/youtube-po-token-generator/bin/cli.mjs")
);

if (!fs.existsSync(CLIPS_DIR)) {
  fs.mkdirSync(CLIPS_DIR, { recursive: true });
}

// ── PO Token cache (valid 5 minutes) ────────────────────────────────────────
interface PoTokenResult { visitorData: string; poToken: string }
let _poTokenCache: { result: PoTokenResult; expiresAt: number } | null = null;
let _poTokenInFlight: Promise<PoTokenResult | null> | null = null;

async function generatePoToken(): Promise<PoTokenResult | null> {
  const now = Date.now();
  if (_poTokenCache && now < _poTokenCache.expiresAt) return _poTokenCache.result;
  if (_poTokenInFlight) return _poTokenInFlight;

  _poTokenInFlight = new Promise<PoTokenResult | null>((resolve) => {
    if (!fs.existsSync(PO_TOKEN_CLI)) {
      logger.warn({ path: PO_TOKEN_CLI }, "PO token CLI not found");
      return resolve(null);
    }
    const proc = spawnSync(NODE_BIN, [PO_TOKEN_CLI], { timeout: 15000, encoding: "utf8" });
    if (proc.error || proc.status !== 0) {
      logger.warn({ err: proc.error?.message, stderr: proc.stderr?.slice(0, 200) }, "PO token generation failed");
      return resolve(null);
    }
    try {
      const parsed = JSON.parse(proc.stdout.trim()) as PoTokenResult;
      if (parsed.visitorData && parsed.poToken) {
        _poTokenCache = { result: parsed, expiresAt: Date.now() + 5 * 60 * 1000 };
        logger.info({ visitorData: parsed.visitorData.slice(0, 20) }, "PO token generated OK");
        resolve(parsed);
      } else {
        resolve(null);
      }
    } catch {
      resolve(null);
    }
  }).finally(() => { _poTokenInFlight = null; });

  return _poTokenInFlight;
}

export function hasCookies(): boolean {
  return fs.existsSync(COOKIES_PATH) && fs.statSync(COOKIES_PATH).size > 100;
}

const OAUTH_CACHE_PATH = path.join(
  os.homedir(), ".cache", "yt-dlp", "youtube-oauth2", "token_data.json"
);

export function hasOAuthToken(): boolean {
  try {
    if (!fs.existsSync(OAUTH_CACHE_PATH)) return false;
    const d = JSON.parse(fs.readFileSync(OAUTH_CACHE_PATH, "utf8"));
    return !!(d?.refresh_token || d?.access_token);
  } catch {
    return false;
  }
}

// Returns yt-dlp auth args: OAuth2 if token exists, cookies if file exists, else none
function getAuthArgs(): string[] {
  if (hasOAuthToken()) return ["--username", "oauth2", "--password", ""];
  if (hasCookies()) return ["--cookies", COOKIES_PATH];
  return [];
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
  const authArgs = getAuthArgs().map(a => `"${a}"`).join(" ");
  const authFlag = authArgs ? ` ${authArgs}` : "";
  const { stdout } = await execAsync(
    `"${YTDLP_BIN}" --js-runtimes "node:${NODE_BIN}"${authFlag} --print-json --skip-download --no-playlist "${url}"`,
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

// Builds extractor-args for a yt-dlp client, optionally injecting a PO token.
function buildClientArgs(
  client: string,
  poToken: PoTokenResult | null
): string[] {
  if (client === "default") return [];

  let extractorVal = `youtube:player_client=${client}`;
  if (poToken) {
    extractorVal += `;po_token=${client}+${poToken.poToken};visitor_data=${poToken.visitorData}`;
  }
  return ["--extractor-args", extractorVal];
}

// Runs all yt-dlp clients in PARALLEL — resolves with first successful file.
// Also generates a fresh PO token upfront and adds an extra web+PO attempt.
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

  // Generate PO token in parallel with the first client launches
  const poTokenPromise = generatePoToken();

  // Only report the highest progress seen across all parallel clients (no chaotic jumps)
  let bestPct = 0;
  const throttledProgress = (pct: number) => {
    if (pct > bestPct) {
      bestPct = pct;
      onProgress(pct);
    }
  };

  // Wait for PO token (max 15s already enforced inside generatePoToken)
  const poToken = await poTokenPromise;
  if (poToken) {
    logger.info("PO token ready for race");
  }

  // Build client list: regular clients + an extra "web" attempt with PO token
  const allClients: Array<{ client: string; usePo: boolean }> = [
    ...PLAYER_CLIENTS.map(c => ({ client: c, usePo: false })),
    ...(poToken ? [{ client: "web", usePo: true }] : []),
  ];

  const clientPromises = allClients.map(async ({ client, usePo }) => {
    const clientArgs = buildClientArgs(client, usePo ? poToken : null);
    const suffix = usePo ? `${client}_po` : client;
    const outArg = path.join(os.tmpdir(), `cgb_${timestamp}_${suffix}.mp4`);

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
    handles.push({ client: suffix, kill: handle.kill, outArg });

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
    for (let i = 0; i < allClients.length; i++) {
      const e = errs[i];
      const msg = e?.stderr ?? e?.message ?? String(e);
      errors.push(`${allClients[i].client}${allClients[i].usePo ? "(po)" : ""}: ${msg.slice(0, 200)}`);
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
// yt-dlp downloads video from the nearest keyframe BEFORE the requested start,
// while audio starts at the exact requested time. This creates a PTS gap
// (e.g. video=0.033s, audio=1.926s) that must be corrected by trimming both
// streams to the later start time (aStart) so content is aligned.
// Re-encoding is required because stream copy cannot seek to non-keyframe boundaries.
async function fixStreamSync(
  clipFile: string,
  duration: number,
  onProgress?: (msg: string) => void
): Promise<void> {
  const { vStart, aStart } = await probeStreamStarts(clipFile);
  const diff = aStart - vStart; // positive = audio starts later = video has extra early frames
  if (Math.abs(diff) < 0.05) return; // Already in sync

  // We only handle the case where video starts before audio (the common case).
  // If audio starts before video (unusual), just leave it — gap is small.
  if (diff <= 0) return;

  logger.info({ vStart, aStart, diff }, "Fixing stream desync — re-encoding");
  onProgress?.("Sincronizando audio y video...");
  const tmpFile = clipFile + ".sync.mp4";
  const adjustedDuration = Math.max(1, duration - diff);

  // Trim both streams to start from aStart (user's requested time).
  // setpts/asetpts resets timestamps to 0. Re-encode required for frame-accurate trim.
  const filterComplex =
    `[0:v]trim=start=${aStart.toFixed(6)},setpts=PTS-STARTPTS[v];` +
    `[0:a]atrim=start=${aStart.toFixed(6)},asetpts=PTS-STARTPTS[a]`;

  try {
    await execAsync(
      `ffmpeg -y -i "${clipFile}" ` +
      `-filter_complex "${filterComplex}" ` +
      `-map "[v]" -map "[a]" ` +
      `-t ${adjustedDuration.toFixed(4)} ` +
      `-c:v libx264 -preset ultrafast -crf 18 -c:a aac -b:a 128k -movflags +faststart "${tmpFile}"`,
      { timeout: 300000 }
    );
    if (fs.existsSync(tmpFile) && fs.statSync(tmpFile).size > 1000) {
      fs.renameSync(tmpFile, clipFile);
      logger.info({ diff, adjustedDuration }, "Stream desync fixed");
    }
  } catch (e: any) {
    logger.error({ err: e?.message }, "fixStreamSync failed");
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
  const cookiesArgs = getAuthArgs();
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
        const isBot = errors.some(e => /Sign in to confirm|bot|cookies/i.test(e));
        throw new Error(isPrivate
          ? "El video es privado o no está disponible en tu región."
          : isBot
          ? "YouTube está bloqueando este video por detección de bots. Por favor actualiza las cookies del servidor."
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
    await fixStreamSync(clipFile, duration, (msg) =>
      updateJob(job, { progress: 92, progressMsg: msg })
    );

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
