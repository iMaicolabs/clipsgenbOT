import { useEffect, useRef, useState } from "react";
import { Download, CheckCircle2, XCircle, Loader2, Scissors, Clock } from "lucide-react";
import { createJobEventSource, downloadUrl, parseTime, type ClipJob } from "@/lib/api";

interface Props {
  jobId: string;
  dbClipId?: number;
  startStr: string;
  endStr: string;
  quality: string;
}

const qualityLabel: Record<string, string> = {
  "360": "360p", "480": "480p", "720": "720p HD", "1080": "1080p Full HD"
};

function formatElapsed(sec: number): string {
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

export default function ProgressPanel({ jobId, startStr, endStr, quality }: Props) {
  const [job, setJob] = useState<ClipJob | null>(null);
  const [displayPct, setDisplayPct] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const esRef = useRef<EventSource | null>(null);
  const startedAtRef = useRef<number>(Date.now());
  const realPctRef = useRef<number>(0);
  const doneRef = useRef<boolean>(false);

  // SSE connection
  useEffect(() => {
    startedAtRef.current = Date.now();
    const es = createJobEventSource(jobId);
    esRef.current = es;

    es.onmessage = (e) => {
      const data: ClipJob = JSON.parse(e.data);
      setJob(data);
      realPctRef.current = data.progress ?? 0;

      if (data.status === "done") {
        doneRef.current = true;
        setDisplayPct(100);
        es.close();
      } else if (data.status === "error") {
        doneRef.current = true;
        es.close();
      }
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [jobId]);

  // Smooth ticker — runs every 200ms while processing
  useEffect(() => {
    if (doneRef.current) return;

    const id = setInterval(() => {
      if (doneRef.current) { clearInterval(id); return; }

      // Update elapsed
      setElapsedSec(Math.floor((Date.now() - startedAtRef.current) / 1000));

      // Trickle display progress toward real, with organic movement
      setDisplayPct((prev) => {
        const real = realPctRef.current;

        // If real progress is ahead, jump to it instantly
        if (real >= prev + 1) return real;

        // Trickle cap: stay a bit behind real to make jumps feel responsive
        // During init phase (real ≤ 5%), trickle up to 18% to show life
        // During download (real > 5%), trickle up to real+2%
        const cap = real <= 5 ? 18 : Math.min(real + 2, 92);
        if (prev >= cap) return prev;

        // Ease-out curve: faster early, slows near cap
        const remaining = cap - prev;
        const step = Math.max(remaining * 0.06, 0.08);
        return Math.min(prev + step, cap);
      });
    }, 200);

    return () => clearInterval(id);
  }, []);

  // Clip duration for ETA
  const clipDurationSec = (() => {
    try {
      const s = parseTime(startStr), e = parseTime(endStr);
      return e > s ? e - s : null;
    } catch { return null; }
  })();

  // ETA: based on real elapsed vs real progress
  const etaStr = (() => {
    const real = realPctRef.current;
    if (!job || job.status !== "processing" || real < 8 || elapsedSec < 2) return null;
    const totalEstSec = Math.round(elapsedSec * 100 / real);
    const remaining = Math.max(0, totalEstSec - elapsedSec);
    if (remaining === 0 || remaining > 120) return null;
    return `~${remaining}s restantes`;
  })();

  const sizeMB = job?.sizeBytes ? (job.sizeBytes / 1024 / 1024).toFixed(1) : null;
  const isActive = job && job.status !== "done" && job.status !== "error";

  return (
    <div className="rounded-2xl border overflow-hidden transition-all duration-500" style={{
      background: "rgba(18,18,28,0.9)",
      borderColor: job?.status === "done"
        ? "rgba(34,197,94,0.2)"
        : job?.status === "error"
        ? "rgba(239,68,68,0.2)"
        : "rgba(255,255,255,0.07)"
    }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
        <div className="flex items-center gap-2 text-xs">
          <Scissors className="w-3.5 h-3.5 text-slate-500" />
          <span className="text-slate-300 font-mono font-medium">{startStr} → {endStr}</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium" style={{ background: "rgba(255,255,255,0.07)", color: "#94a3b8" }}>
            {qualityLabel[quality] ?? quality}
          </span>
        </div>
        {sizeMB
          ? <span className="text-[11px] text-slate-500">{sizeMB} MB</span>
          : isActive && elapsedSec > 0
          ? <span className="text-[11px] text-slate-600 tabular-nums">{formatElapsed(elapsedSec)}</span>
          : null
        }
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        {!job && (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin text-red-400" />
            Conectando...
          </div>
        )}

        {job?.status === "done" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-green-400 font-semibold">
                <CheckCircle2 className="w-4 h-4" />
                ¡Clip listo!
              </div>
              {sizeMB && <span className="text-xs text-slate-500">{sizeMB} MB · {formatElapsed(elapsedSec)}</span>}
            </div>
            <a
              href={downloadUrl(jobId)}
              download
              className="flex items-center justify-center gap-2 w-full rounded-xl py-2.5 text-sm font-bold text-white shadow-lg transition-all hover:brightness-110 active:scale-[0.98]"
              style={{ background: "linear-gradient(135deg,#16a34a,#15803d)" }}
            >
              <Download className="w-4 h-4" />
              Descargar clip
            </a>
          </div>
        )}

        {job?.status === "error" && (
          <div className="flex items-start gap-2 text-sm text-red-400">
            <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{job.error ?? "Error al procesar el clip. Intenta de nuevo."}</span>
          </div>
        )}

        {isActive && (
          <div className="space-y-2">
            {/* Label row */}
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs text-slate-400">
                <Loader2 className="w-3 h-3 animate-spin text-red-400" />
                {job!.progressMsg || "Procesando..."}
              </span>
              <span className="text-xs font-mono font-bold text-white tabular-nums">
                {Math.round(displayPct)}%
              </span>
            </div>

            {/* Progress bar — CSS transition handles smooth movement */}
            <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
              <div
                style={{
                  width: `${displayPct}%`,
                  height: "100%",
                  borderRadius: "9999px",
                  background: "linear-gradient(90deg,#dc2626,#ef4444,#f87171)",
                  boxShadow: "0 0 12px rgba(239,68,68,0.5)",
                  transition: "width 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
                }}
              />
            </div>

            {/* Footer: ETA or hint */}
            <p className="text-[11px] text-slate-600 flex items-center gap-1">
              <Clock className="w-3 h-3 shrink-0" />
              {etaStr ?? (clipDurationSec
                ? `Clip de ${clipDurationSec}s · normalmente listo en 10–20s`
                : "Normalmente listo en 10–20 segundos"
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
