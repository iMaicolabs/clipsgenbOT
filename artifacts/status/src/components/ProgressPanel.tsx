import { useEffect, useRef, useState } from "react";
import { Download, CheckCircle2, XCircle, Loader2, Scissors } from "lucide-react";
import { createJobEventSource, downloadUrl, type ClipJob } from "@/lib/api";

interface Props {
  jobId: string;
  dbClipId?: number;
  startStr: string;
  endStr: string;
  quality: string;
  onDone?: () => void;
}

export default function ProgressPanel({ jobId, startStr, endStr, quality, onDone }: Props) {
  const [job, setJob] = useState<ClipJob | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = createJobEventSource(jobId);
    esRef.current = es;
    es.onmessage = (e) => {
      const data: ClipJob = JSON.parse(e.data);
      setJob(data);
      if (data.status === "done" || data.status === "error") {
        es.close();
        if (data.status === "done") onDone?.();
      }
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [jobId]);

  const qualityLabel: Record<string, string> = {
    "360": "360p", "480": "480p", "720": "720p HD", "1080": "1080p Full HD"
  };

  if (!job) {
    return (
      <div className="flex items-center gap-3 p-4 bg-[#161b22] border border-white/10 rounded-xl">
        <Loader2 className="w-5 h-5 animate-spin text-red-400" />
        <span className="text-sm text-slate-400">Iniciando...</span>
      </div>
    );
  }

  return (
    <div className="p-4 bg-[#161b22] border border-white/10 rounded-xl space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <Scissors className="w-4 h-4 text-slate-500" />
          <span className="text-slate-300 font-mono">{startStr} → {endStr}</span>
          <span className="text-xs px-2 py-0.5 bg-white/5 rounded-full text-slate-400">{qualityLabel[quality] ?? quality}</span>
        </div>
        {job.sizeBytes && (
          <span className="text-xs text-slate-500">{(job.sizeBytes / 1024 / 1024).toFixed(1)} MB</span>
        )}
      </div>

      {job.status === "done" ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
            <CheckCircle2 className="w-4 h-4" />
            ¡Clip listo!
          </div>
          <a
            href={downloadUrl(jobId)}
            download
            className="flex items-center justify-center gap-2 w-full bg-green-600 hover:bg-green-500 transition-colors rounded-xl py-2.5 text-sm font-semibold text-white"
          >
            <Download className="w-4 h-4" />
            Descargar clip
          </a>
        </div>
      ) : job.status === "error" ? (
        <div className="flex items-start gap-2 text-red-400 text-sm">
          <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{job.error ?? "Error al procesar el clip"}</span>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" />
              {job.progressMsg || "Procesando..."}
            </span>
            <span>{job.progress}%</span>
          </div>
          <div className="h-2 bg-[#0d1117] rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-red-600 to-red-400 rounded-full transition-all duration-500"
              style={{ width: `${job.progress}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
