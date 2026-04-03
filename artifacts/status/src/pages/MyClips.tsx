import { useState, useEffect } from "react";
import { Link } from "wouter";
import {
  Download, Trash2, Scissors, Clock, HardDrive,
  FolderOpen, AlertCircle, Loader2, Calendar, ExternalLink, Plus
} from "lucide-react";
import { getMyClips, deleteClip, downloadDbUrl, type SavedClip } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

const qualityLabel: Record<string, string> = {
  "360": "360p", "480": "480p", "720": "720p HD", "1080": "1080p Full HD",
};

function StatusBadge({ clip }: { clip: SavedClip }) {
  if (clip.status === "processing") {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20"><Loader2 className="w-2.5 h-2.5 animate-spin" />Procesando</span>;
  }
  if (clip.status === "error") {
    return <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-red-500/10 text-red-400 border border-red-500/20">Error</span>;
  }
  if (clip.fileAvailable) {
    return <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-green-500/10 text-green-400 border border-green-500/20">Disponible</span>;
  }
  return <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-white/5 text-slate-500 border border-white/8">Expirado</span>;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("es-ES", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function MyClips() {
  const { user } = useAuth();
  const [clips, setClips] = useState<SavedClip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;
    getMyClips()
      .then(setClips)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [user]);

  const handleDelete = async (id: number) => {
    if (!confirm("¿Eliminar este clip?")) return;
    setDeleting(id);
    try {
      await deleteClip(id);
      setClips(prev => prev.filter(c => c.id !== id));
    } catch (e: any) {
      alert(e.message);
    } finally {
      setDeleting(null);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen pt-14 flex items-center justify-center" style={{ background: "#09090f" }}>
        <div className="text-center p-8 max-w-sm">
          <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-5">
            <FolderOpen className="w-8 h-8 text-slate-600" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Inicia sesión para ver tus clips</h2>
          <p className="text-slate-500 text-sm mb-6">Crea una cuenta para guardar y volver a descargar tus clips en cualquier momento.</p>
          <Link href="/" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white shadow-lg transition-all hover:brightness-110" style={{ background: "linear-gradient(135deg,#e53e3e,#c53030)" }}>
            <Scissors className="w-4 h-4" />Ir al inicio
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pt-14 pb-16" style={{ background: "#09090f" }}>
      <div className="max-w-3xl mx-auto px-4 pt-10">

        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-extrabold text-white tracking-tight">Mis clips</h1>
            <p className="text-slate-500 text-sm mt-1">Los archivos están disponibles 24 h desde su creación</p>
          </div>
          <Link
            href="/"
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white shadow-lg transition-all hover:brightness-110"
            style={{ background: "linear-gradient(135deg,#e53e3e,#c53030)" }}
          >
            <Plus className="w-4 h-4" />Nuevo clip
          </Link>
        </div>

        {loading && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-red-400" />
            <p className="text-sm text-slate-600">Cargando tus clips...</p>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 bg-red-500/8 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400">
            <AlertCircle className="w-4 h-4 shrink-0" />{error}
          </div>
        )}

        {!loading && !error && clips.length === 0 && (
          <div className="text-center py-24">
            <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-5">
              <Scissors className="w-8 h-8 text-slate-600" />
            </div>
            <h2 className="text-lg font-semibold text-slate-300 mb-2">Aún no tienes clips guardados</h2>
            <p className="text-slate-600 text-sm mb-6 max-w-xs mx-auto">
              Crea un clip y activa "Guardar en mis clips" para que aparezca aquí.
            </p>
            <Link href="/" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white shadow-lg hover:brightness-110 transition-all" style={{ background: "linear-gradient(135deg,#e53e3e,#c53030)" }}>
              <Scissors className="w-4 h-4" />Crear mi primer clip
            </Link>
          </div>
        )}

        {!loading && clips.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs text-slate-600 mb-4">{clips.length} clip{clips.length !== 1 ? "s" : ""}</p>
            {clips.map(clip => (
              <div
                key={clip.id}
                className="rounded-2xl border overflow-hidden transition-all hover:border-white/12"
                style={{ background: "rgba(18,18,28,0.9)", borderColor: clip.fileAvailable ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.05)" }}
              >
                <div className="flex gap-3.5 p-4">
                  {clip.videoThumbnail ? (
                    <img
                      src={clip.videoThumbnail}
                      alt=""
                      className="w-24 h-14 object-cover rounded-xl shrink-0 bg-slate-800"
                      onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (
                    <div className="w-24 h-14 bg-white/5 rounded-xl shrink-0 flex items-center justify-center">
                      <Scissors className="w-5 h-5 text-slate-700" />
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <a
                        href={clip.youtubeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-semibold text-white hover:text-red-400 transition-colors line-clamp-1 group flex items-center gap-1"
                      >
                        <span className="truncate">{clip.videoTitle ?? "Video de YouTube"}</span>
                        <ExternalLink className="w-3 h-3 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
                      </a>
                      <StatusBadge clip={clip} />
                    </div>

                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-1.5">
                      <span className="flex items-center gap-1 text-[11px] text-slate-500 font-mono">
                        <Clock className="w-3 h-3" />{clip.startStr} → {clip.endStr}
                      </span>
                      <span className="text-slate-700">·</span>
                      <span className="text-[11px] text-slate-500">{qualityLabel[clip.quality] ?? clip.quality}</span>
                      {clip.sizeBytes && (
                        <>
                          <span className="text-slate-700">·</span>
                          <span className="flex items-center gap-1 text-[11px] text-slate-500">
                            <HardDrive className="w-3 h-3" />
                            {(clip.sizeBytes / 1024 / 1024).toFixed(1)} MB
                          </span>
                        </>
                      )}
                    </div>

                    <div className="flex items-center gap-1 mt-1.5 text-[11px] text-slate-600">
                      <Calendar className="w-3 h-3" />
                      {formatDate(clip.createdAt)}
                      {clip.expiresAt && clip.fileAvailable && (
                        <span className="ml-1">· expira {formatDate(clip.expiresAt)}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex border-t" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                  {clip.fileAvailable && (
                    <a
                      href={downloadDbUrl(clip.id)}
                      download
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold text-green-400 hover:bg-green-500/8 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />Descargar
                    </a>
                  )}
                  <button
                    onClick={() => handleDelete(clip.id)}
                    disabled={deleting === clip.id}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold text-slate-500 hover:text-red-400 hover:bg-red-500/8 transition-colors ${clip.fileAvailable ? "border-l" : ""}`}
                    style={clip.fileAvailable ? { borderColor: "rgba(255,255,255,0.05)" } : {}}
                  >
                    {deleting === clip.id
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Trash2 className="w-3.5 h-3.5" />}
                    Eliminar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
