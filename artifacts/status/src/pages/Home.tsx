import { useState, useRef, useEffect, useCallback } from "react";
import {
  Link2, Scissors, AlertCircle, BookmarkPlus,
  Loader2, Clock, X, ArrowRight, Zap, Download, Shield
} from "lucide-react";
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

type QualityOption = { value: Quality; label: string; badge?: string; color: string; vodKbps: number; liveKbps: number };

// VOD bitrates: typical YouTube video-on-demand (pre-encoded, higher quality)
// Live bitrates: typical YouTube livestream recordings (lower due to real-time encoding)
const QUALITY_OPTIONS: QualityOption[] = [
  { value: "360",  label: "360p",  color: "text-slate-400",  vodKbps: 300,  liveKbps: 200  },
  { value: "480",  label: "480p",  color: "text-blue-400",   vodKbps: 600,  liveKbps: 350  },
  { value: "720",  label: "720p",  badge: "HD",      color: "text-green-400",  vodKbps: 1500, liveKbps: 800  },
  { value: "1080", label: "1080p", badge: "Full HD", color: "text-purple-400", vodKbps: 3000, liveKbps: 1500 },
];

function estimateSize(kbps: number, durationSec: number): string {
  const mb = (kbps * durationSec) / 8 / 1024;
  if (mb < 1) return `≤${Math.round(mb * 1024)} KB`;
  if (mb < 10) return `≤${mb.toFixed(1)} MB`;
  return `≤${Math.round(mb)} MB`;
}

function isYouTubeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return ["youtube.com", "www.youtube.com", "youtu.be", "m.youtube.com", "music.youtube.com"].includes(u.hostname);
  } catch { return false; }
}

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

  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchInfo = useCallback(async (u: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setInfoLoading(true);
    setInfoError("");
    try {
      const info = await getVideoInfo(u, ctrl.signal);
      setVideoInfo(info);
    } catch (e: any) {
      if (e.name !== "AbortError") {
        setInfoError("No se pudo obtener el video. Verifica que el link sea válido y público.");
        setVideoInfo(null);
      }
    } finally {
      setInfoLoading(false);
    }
  }, []);

  const handleUrlChange = (v: string) => {
    setUrl(v);
    setVideoInfo(null);
    setInfoError("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (isYouTubeUrl(v.trim())) {
      debounceRef.current = setTimeout(() => fetchInfo(v.trim()), 700);
    }
  };

  const clearUrl = () => {
    setUrl("");
    setVideoInfo(null);
    setInfoError("");
    abortRef.current?.abort();
    if (debounceRef.current) clearTimeout(debounceRef.current);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setClipError("");
    let startSec: number, endSec: number;
    try {
      startSec = parseTime(startStr.trim());
      endSec = parseTime(endStr.trim());
    } catch (err: any) {
      setClipError(err.message); return;
    }
    if (endSec <= startSec) { setClipError("El tiempo de fin debe ser mayor que el de inicio"); return; }
    if (endSec - startSec > 900) { setClipError("El clip no puede durar más de 15 minutos"); return; }

    setClipLoading(true);
    try {
      const result = await createClip({
        url: url.trim(), startSec, endSec,
        startStr: startStr.trim(), endStr: endStr.trim(),
        quality, save: saveToAccount && !!user,
        videoTitle: videoInfo?.title,
        videoThumbnail: videoInfo?.thumbnail,
      });
      setClipResults(prev => [
        { jobId: result.jobId, dbClipId: result.dbClipId, startStr: startStr.trim(), endStr: endStr.trim(), quality },
        ...prev,
      ]);
    } catch (err: any) {
      setClipError(err.message ?? "Error al crear el clip");
    } finally {
      setClipLoading(false);
    }
  };

  const clipDurationSec = (() => {
    try {
      const s = parseTime(startStr), e = parseTime(endStr);
      if (e > s) return e - s;
    } catch {}
    return null;
  })();

  const duration = clipDurationSec ? formatDuration(clipDurationSec) : null;

  const canSubmit = !!url.trim() && !!startStr.trim() && !!endStr.trim() && !clipLoading;

  return (
    <div className="min-h-screen pt-14" style={{ background: "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(220,38,38,0.12) 0%, transparent 70%), #09090f" }}>

      {/* Hero */}
      <div className="text-center pt-14 pb-10 px-4">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-red-500/20 bg-red-500/5 text-xs text-red-400 font-medium mb-5">
          <Zap className="w-3 h-3" /> Rápido · Gratis · Sin marcas de agua
        </div>
        <h1 className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight leading-tight mb-3">
          Recorta cualquier video<br />
          <span style={{ background: "linear-gradient(135deg,#f87171,#dc2626)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            de YouTube en segundos
          </span>
        </h1>
        <p className="text-slate-400 text-lg max-w-md mx-auto">
          Pega el link, elige el fragmento y descarga el clip directo a tu dispositivo.
        </p>
      </div>

      <div className="max-w-xl mx-auto px-4 pb-20">

        {/* Main card */}
        <div className="rounded-2xl border border-white/8 overflow-hidden shadow-2xl" style={{ background: "rgba(18,18,28,0.9)" }}>

          {/* Step 1 – URL */}
          <div className="p-5 border-b border-white/5">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-5 h-5 rounded-full bg-red-600 text-white text-xs font-bold flex items-center justify-center shrink-0">1</span>
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Pega el link de YouTube</span>
            </div>
            <div className="relative">
              <Link2 className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
              <input
                type="url"
                value={url}
                onChange={e => handleUrlChange(e.target.value)}
                onPaste={e => {
                  const v = e.clipboardData.getData("text");
                  if (isYouTubeUrl(v.trim())) {
                    setTimeout(() => fetchInfo(v.trim()), 0);
                  }
                }}
                placeholder="https://youtube.com/watch?v=..."
                className="w-full rounded-xl pl-10 pr-10 py-3.5 text-sm text-white placeholder:text-slate-600 focus:outline-none transition-all border"
                style={{ background: "rgba(255,255,255,0.04)", borderColor: url ? "rgba(229,62,62,0.35)" : "rgba(255,255,255,0.07)" }}
              />
              {url && (
                <button onClick={clearUrl} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Info loading / error / preview */}
            <div className="mt-2.5">
              {infoLoading && (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-red-400" />
                  Obteniendo información del video...
                </div>
              )}
              {infoError && !infoLoading && (
                <div className="flex items-center gap-1.5 text-xs text-red-400">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />{infoError}
                </div>
              )}
              {videoInfo && !infoLoading && <VideoPreview info={videoInfo} url={url} />}
            </div>
          </div>

          {/* Step 2 – Times */}
          <div className="p-5 border-b border-white/5">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-5 h-5 rounded-full bg-red-600 text-white text-xs font-bold flex items-center justify-center shrink-0">2</span>
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Elige el fragmento</span>
              {duration && (
                <span className="ml-auto text-xs text-slate-500 bg-white/5 px-2 py-0.5 rounded-full">
                  ⏱ {duration}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <TimeInput
                label="Inicio"
                value={startStr}
                onChange={setStartStr}
                placeholder="0:00"
                max={videoInfo?.duration}
              />
              <TimeInput
                label="Fin"
                value={endStr}
                onChange={setEndStr}
                placeholder="0:30"
                max={videoInfo?.duration}
              />
            </div>
            <p className="text-xs text-slate-600 mt-2">Escribe solo números — los dos puntos se añaden solos</p>
          </div>

          {/* Step 3 – Quality */}
          <div className="p-5 border-b border-white/5">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-5 h-5 rounded-full bg-red-600 text-white text-xs font-bold flex items-center justify-center shrink-0">3</span>
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Calidad de video</span>
            </div>
            {(() => {
              const isLiveType = !!(videoInfo?.isLive || videoInfo?.wasLive);
              return (
                <>
                  <div className="grid grid-cols-4 gap-2">
                    {QUALITY_OPTIONS.map(opt => {
                      const kbps = isLiveType ? opt.liveKbps : opt.vodKbps;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setQuality(opt.value)}
                          className={`relative py-3 px-2 rounded-xl border text-center transition-all ${
                            quality === opt.value
                              ? "border-red-500/50 shadow-lg shadow-red-900/20"
                              : "border-white/5 hover:border-white/15"
                          }`}
                          style={quality === opt.value ? { background: "rgba(220,38,38,0.12)" } : { background: "rgba(255,255,255,0.03)" }}
                        >
                          {quality === opt.value && (
                            <div className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-red-500" />
                          )}
                          <div className={`text-sm font-bold ${quality === opt.value ? "text-white" : "text-slate-400"}`}>{opt.label}</div>
                          {opt.badge && (
                            <div className={`text-[10px] font-medium ${quality === opt.value ? opt.color : "text-slate-600"}`}>{opt.badge}</div>
                          )}
                          <div className={`text-[10px] mt-0.5 tabular-nums ${quality === opt.value ? "text-slate-400" : "text-slate-600"}`}>
                            {clipDurationSec ? estimateSize(kbps, clipDurationSec) : "—"}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {clipDurationSec && (
                    <p className="text-[10px] text-slate-600 mt-1.5 text-center">
                      {isLiveType
                        ? "Estimado para livestream · el peso real puede variar"
                        : "Estimado para video · el peso real puede variar"}
                    </p>
                  )}
                </>
              );
            })()}
          </div>

          {/* Save option + submit */}
          <div className="p-5 space-y-3">
            {user && (
              <button
                type="button"
                onClick={() => setSaveToAccount(v => !v)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                  saveToAccount ? "border-red-500/30 bg-red-500/8" : "border-white/5 bg-white/2 hover:border-white/10"
                }`}
              >
                <div className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 transition-all ${saveToAccount ? "bg-red-600" : "bg-white/10 border border-white/20"}`}>
                  {saveToAccount && (
                    <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-300 flex items-center gap-1.5">
                    <BookmarkPlus className="w-3.5 h-3.5 text-red-400" />
                    Guardar en mis clips
                  </p>
                  <p className="text-xs text-slate-600">Disponible 24 h en "Mis clips"</p>
                </div>
              </button>
            )}

            {clipError && (
              <div className="flex items-center gap-2 bg-red-500/8 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400">
                <AlertCircle className="w-4 h-4 shrink-0" />{clipError}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="w-full flex items-center justify-center gap-2 rounded-xl py-3.5 font-bold text-white text-sm transition-all shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: canSubmit ? "linear-gradient(135deg,#e53e3e,#c53030)" : "rgba(100,100,100,0.3)" }}
            >
              {clipLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
              {clipLoading ? "Enviando a procesar..." : "Crear clip"}
              {!clipLoading && <ArrowRight className="w-4 h-4 ml-auto" />}
            </button>

            {!user && (
              <p className="text-center text-xs text-slate-600">
                <Shield className="w-3 h-3 inline mr-1" />
                <button onClick={() => {}} className="text-red-400/70 hover:text-red-400 transition-colors">Crea una cuenta</button> para guardar tus clips
              </p>
            )}
          </div>
        </div>

        {/* Clip queue */}
        {clipResults.length > 0 && (
          <div className="mt-5 space-y-3">
            <div className="flex items-center gap-2 px-1">
              <div className="h-px flex-1 bg-white/5" />
              <span className="text-xs text-slate-600 font-medium uppercase tracking-wider">Cola de clips</span>
              <div className="h-px flex-1 bg-white/5" />
            </div>
            {clipResults.map(r => (
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

        {/* Feature pills */}
        <div className="mt-10 flex flex-wrap justify-center gap-2">
          {[
            { icon: "✂️", text: "Hasta 10 min por clip" },
            { icon: "🎬", text: "360p a 1080p Full HD" },
            { icon: "💾", text: "Descarga MP4 directa" },
            { icon: "🔒", text: "Sin cuenta requerida" },
            { icon: "⚡", text: "Sin marcas de agua" },
          ].map(f => (
            <div key={f.text} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/5 bg-white/2 text-xs text-slate-500">
              <span>{f.icon}</span>{f.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function autoFormatTime(digits: string): string {
  const d = digits.replace(/\D/g, "").slice(0, 6);
  if (d.length <= 2) return d;
  if (d.length === 3) return `${d[0]}:${d.slice(1)}`;
  if (d.length === 4) return `${d.slice(0, 2)}:${d.slice(2)}`;
  if (d.length === 5) return `${d[0]}:${d.slice(1, 3)}:${d.slice(3)}`;
  return `${d.slice(0, 2)}:${d.slice(2, 4)}:${d.slice(4)}`;
}

function TimeInput({ label, value, onChange, placeholder, max }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string; max?: number;
}) {
  const secs = (() => { try { return parseTime(value); } catch { return null; } })();

  const setPreset = (s: number) => {
    if (max && s > max) s = max;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    onChange(h > 0
      ? `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`
      : `${m}:${String(sec).padStart(2,"0")}`);
  };

  return (
    <div>
      <div className="relative">
        <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600 pointer-events-none" />
        <input
          type="text"
          inputMode="numeric"
          value={value}
          onChange={e => onChange(autoFormatTime(e.target.value))}
          placeholder={placeholder}
          className="w-full rounded-xl pl-8 pr-3 py-3 text-sm font-mono text-white placeholder:text-slate-700 focus:outline-none transition-all border"
          style={{ background: "rgba(255,255,255,0.04)", borderColor: value ? "rgba(229,62,62,0.3)" : "rgba(255,255,255,0.07)" }}
        />
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[11px] text-slate-600">{label}</span>
        {secs !== null && <span className="text-[11px] text-slate-500 font-mono">{formatDuration(secs)}</span>}
      </div>
    </div>
  );
}
