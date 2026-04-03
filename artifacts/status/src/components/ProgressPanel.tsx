import { useEffect, useRef, useState } from "react";
import { Download, CheckCircle2, XCircle, Loader2, Scissors, Clock } from "lucide-react";
import { createJobEventSource, downloadUrl, type ClipJob } from "@/lib/api";

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

export default function ProgressPanel({ jobId, startStr, endStr, quality }: Props) {
  const [job, setJob] = useState<ClipJob | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = createJobEventSource(jobId);
    esRef.current = es;
    es.onmessage = e => {
      const data: ClipJob = JSON.parse(e.data);
      setJob(data);
      if (data.status === "done" || data.status === "error") es.close();
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [jobId]);

  const sizeMB = job?.sizeBytes ? (job.sizeBytes / 1024 / 1024).toFixed(1) : null;

  return (
    <div className="rounded-2xl border overflow-hidden transition-all" style={{
      background: "rgba(18,18,28,0.9)",
      borderColor: job?.status === "done" ? "rgba(34,197,94,0.2)" : job?.status === "error" ? "rgba(239,68,68,0.2)" : "rgba(255,255,255,0.07)"
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
        {sizeMB && (
          <span className="text-[11px] text-slate-600">{sizeMB} MB</span>
        )}
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
            <div className="flex items-center gap-2 text-sm text-green-400 font-semibold">
              <CheckCircle2 className="w-4 h-4" />
              ¡Clip listo!{sizeMB && <span className="text-xs font-normal text-slate-500 ml-1">({sizeMB} MB)</span>}
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

        {job && job.status !== "done" && job.status !== "error" && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs text-slate-400">
                <Loader2 className="w-3 h-3 animate-spin text-red-400" />
                {job.progressMsg || "Procesando..."}
              </span>
              <span className="text-xs font-mono font-bold text-white">{job.progress}%</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${job.progress}%`,
                  background: "linear-gradient(90deg,#dc2626,#ef4444,#f87171)",
                  boxShadow: "0 0 10px rgba(239,68,68,0.4)"
                }}
              />
            </div>
            <p className="text-[11px] text-slate-600 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Los clips pueden tardar 1–3 minutos dependiendo de la duración
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
