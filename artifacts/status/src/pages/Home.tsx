import { useState, useRef, useCallback } from "react";
import { Link2, Scissors, Play, AlertCircle, BookmarkPlus, Loader2, Clock, ChevronDown } from "lucide-react";
import { getVideoInfo, createClip, parseTime, formatDuration, type VideoInfo } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import VideoPreview from "@/components/VideoPreview";
import ProgressPanel from "@/components/ProgressPanel";

type Quality = "360" | "480" | "720" | "1080";

interface ClipResult {
  jobId: string;
  dbClipId?: number;
  startStr: string;
  endStr: string;
  quality: Quality;
}

const QUALITY_OPTIONS: { value: Quality; label: string; desc: string }[] = [
  { value: "360", label: "360p", desc: "Compacto" },
  { value: "480", label: "480p", desc: "SD" },
  { value: "720", label: "720p HD", desc: "Recomendado" },
  { value: "1080", label: "1080p", desc: "Full HD" },
];

export default function Home() {
  const { user } = useAuth();

  const [url, setUrl] = useState("");
  const [startStr, setStartStr] = useState("");
  const [endStr, setEndStr] = useState("");
  const [quality, setQuality] = useState<Quality>("720");
  const [saveToAccount, setSaveToAccount] = useState(false);

  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);
  const [infoError, setInfoError] = useState("");

  const [clipResults, setClipResults] = useState<ClipResult[]>([]);
  const [clipLoading, setClipLoading] = useState(false);
  const [clipError, setClipError] = useState("");

  const infoAbortRef = useRef<AbortController | null>(null);

  const handleUrlChange = (v: string) => {
    setUrl(v);
    setVideoInfo(null);
    setInfoError("");
    infoAbortRef.current?.abort();
  };

  const fetchVideoInfo = useCallback(async () => {
    if (!url.trim()) return;
    infoAbortRef.current?.abort();
    const ctrl = new AbortController();
    infoAbortRef.current = ctrl;
    setInfoLoading(true);
    setInfoError("");
    try {
      const info = await getVideoInfo(url.trim(), ctrl.signal);
      setVideoInfo(info);
    } catch (e: any) {
      if (e.name !== "AbortError") {
        setInfoError(e.message ?? "No se pudo obtener información del video");
      }
    } finally {
      setInfoLoading(false);
    }
  }, [url]);

  const handleCreateClip = async (e: React.FormEvent) => {
    e.preventDefault();
    setClipError("");

    let startSec: number, endSec: number;
    try {
      startSec = parseTime(startStr.trim());
      endSec = parseTime(endStr.trim());
    } catch (err: any) {
      setClipError(err.message);
      return;
    }

    if (endSec <= startSec) {
      setClipError("El tiempo de fin debe ser mayor que el de inicio");
      return;
    }
    if (endSec - startSec > 600) {
      setClipError("El clip no puede durar más de 10 minutos");
      return;
    }

    setClipLoading(true);
    try {
      const result = await createClip({
        url: url.trim(),
        startSec,
        endSec,
        startStr: startStr.trim(),
        endStr: endStr.trim(),
        quality,
        save: saveToAccount && !!user,
      });
      setClipResults((prev) => [
        { jobId: result.jobId, dbClipId: result.dbClipId, startStr: startStr.trim(), endStr: endStr.trim(), quality },
        ...prev,
      ]);
    } catch (err: any) {
      setClipError(err.message ?? "Error al crear el clip");
    } finally {
      setClipLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0d1117] pt-20 pb-16">
      <div className="max-w-2xl mx-auto px-4">

        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold text-white tracking-tight">
            Recorta cualquier video de YouTube
          </h1>
          <p className="text-slate-400 mt-3 text-lg">
            Pega el link, elige el fragmento y descárgalo en segundos.
          </p>
        </div>

        <div className="bg-[#161b22] border border-white/10 rounded-2xl p-6 shadow-xl shadow-black/30 space-y-5">

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">URL de YouTube</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="url"
                  value={url}
                  onChange={(e) => handleUrlChange(e.target.value)}
                  placeholder="https://youtube.com/watch?v=..."
                  className="w-full bg-[#0d1117] border border-white/10 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-red-600 transition-colors"
                />
              </div>
              <button
                type="button"
                onClick={fetchVideoInfo}
                disabled={!url.trim() || infoLoading}
                className="px-4 py-3 bg-white/5 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed border border-white/10 rounded-xl text-sm font-medium text-slate-300 hover:text-white transition-all flex items-center gap-2"
              >
                {infoLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                {infoLoading ? "" : "Ver"}
              </button>
            </div>
            {infoError && (
              <p className="flex items-center gap-1.5 text-xs text-red-400 mt-1">
                <AlertCircle className="w-3.5 h-3.5" />{infoError}
              </p>
            )}
          </div>

          {videoInfo && <VideoPreview info={videoInfo} url={url} />}

          <form onSubmit={handleCreateClip} className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Inicio
                </label>
                <input
                  type="text"
                  value={startStr}
                  onChange={(e) => setStartStr(e.target.value)}
                  placeholder="0:00 o 1:30:00"
                  required
                  className="w-full bg-[#0d1117] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-red-600 transition-colors font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Fin
                </label>
                <input
                  type="text"
                  value={endStr}
                  onChange={(e) => setEndStr(e.target.value)}
                  placeholder="0:30 o 1:32:00"
                  required
                  className="w-full bg-[#0d1117] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-red-600 transition-colors font-mono"
                />
              </div>
            </div>

            {startStr && endStr && (() => {
              try {
                const s = parseTime(startStr), e = parseTime(endStr);
                if (e > s) return (
                  <p className="text-xs text-slate-500 -mt-2">
                    Duración: <span className="text-slate-300 font-medium">{formatDuration(e - s)}</span>
                  </p>
                );
              } catch {}
              return null;
            })()}

            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Calidad</label>
              <div className="grid grid-cols-4 gap-2">
                {QUALITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setQuality(opt.value)}
                    className={`py-2 px-2 rounded-xl border text-center transition-all ${
                      quality === opt.value
                        ? "bg-red-600/20 border-red-500 text-red-300"
                        : "bg-[#0d1117] border-white/10 text-slate-400 hover:border-white/20 hover:text-white"
                    }`}
                  >
                    <div className="text-sm font-semibold">{opt.label}</div>
                    <div className="text-xs opacity-60">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {user && (
              <label className="flex items-center gap-3 p-3 bg-[#0d1117] border border-white/10 rounded-xl cursor-pointer group hover:border-white/20 transition-colors">
                <div
                  className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${
                    saveToAccount ? "bg-red-600" : "bg-white/5 border border-white/20"
                  }`}
                  onClick={() => setSaveToAccount((v) => !v)}
                >
                  {saveToAccount && <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                </div>
                <div>
                  <p className="text-sm text-slate-300 flex items-center gap-1.5">
                    <BookmarkPlus className="w-3.5 h-3.5 text-red-400" />
                    Guardar en mi cuenta
                  </p>
                  <p className="text-xs text-slate-500">El clip se guardará en "Mis clips" por 24 h</p>
                </div>
              </label>
            )}

            {clipError && (
              <div className="flex items-center gap-2 bg-red-950/50 border border-red-800/40 rounded-xl px-4 py-3 text-sm text-red-300">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {clipError}
              </div>
            )}

            <button
              type="submit"
              disabled={clipLoading || !url.trim() || !startStr.trim() || !endStr.trim()}
              className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors rounded-xl py-3 font-semibold text-white text-sm shadow-lg shadow-red-900/20"
            >
              {clipLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
              {clipLoading ? "Enviando..." : "Crear clip"}
            </button>
          </form>
        </div>

        {clipResults.length > 0 && (
          <div className="mt-6 space-y-3">
            <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider px-1">Cola de clips</h2>
            {clipResults.map((r) => (
              <ProgressPanel
                key={r.jobId}
                jobId={r.jobId}
                dbClipId={r.dbClipId}
                startStr={r.startStr}
                endStr={r.endStr}
                quality={r.quality}
              />
            ))}
          </div>
        )}

        <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { icon: "✂️", title: "Recorta cualquier fragmento", desc: "Segundos o hasta 10 minutos de cualquier video de YouTube." },
            { icon: "🎬", title: "Calidad a elegir", desc: "Desde 360p hasta 1080p Full HD según lo que necesites." },
            { icon: "💾", title: "Descarga directa", desc: "Descarga el clip en MP4 directamente a tu dispositivo." },
          ].map((f) => (
            <div key={f.title} className="bg-[#161b22] border border-white/5 rounded-xl p-4">
              <div className="text-2xl mb-2">{f.icon}</div>
              <p className="text-sm font-semibold text-white">{f.title}</p>
              <p className="text-xs text-slate-500 mt-1">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
