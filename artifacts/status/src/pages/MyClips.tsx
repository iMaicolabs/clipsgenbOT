import { useState, useEffect } from "react";
import { Link } from "wouter";
import {
  Download, Trash2, Scissors, Clock, HardDrive,
  FolderOpen, AlertCircle, Loader2, Calendar, ExternalLink
} from "lucide-react";
import { getMyClips, deleteClip, downloadDbUrl, formatDuration, type SavedClip } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

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
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [user]);

  const handleDelete = async (id: number) => {
    if (!confirm("¿Eliminar este clip?")) return;
    setDeleting(id);
    try {
      await deleteClip(id);
      setClips((prev) => prev.filter((c) => c.id !== id));
    } catch (e: any) {
      alert(e.message);
    } finally {
      setDeleting(null);
    }
  };

  const formatDate = (d: string) => {
    return new Date(d).toLocaleDateString("es-ES", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  };

  const qualityLabel: Record<string, string> = {
    "360": "360p", "480": "480p", "720": "720p HD", "1080": "1080p Full HD"
  };

  const statusBadge = (clip: SavedClip) => {
    if (clip.status === "processing") return <span className="px-2 py-0.5 text-xs rounded-full bg-yellow-950 text-yellow-400 border border-yellow-800/40">Procesando</span>;
    if (clip.status === "error") return <span className="px-2 py-0.5 text-xs rounded-full bg-red-950 text-red-400 border border-red-800/40">Error</span>;
    if (clip.fileAvailable) return <span className="px-2 py-0.5 text-xs rounded-full bg-green-950 text-green-400 border border-green-800/40">Disponible</span>;
    return <span className="px-2 py-0.5 text-xs rounded-full bg-slate-800 text-slate-400 border border-slate-700">Expirado</span>;
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0d1117] pt-20 flex items-center justify-center">
        <div className="text-center p-8">
          <FolderOpen className="w-12 h-12 text-slate-700 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-white mb-2">Inicia sesión para ver tus clips</h2>
          <p className="text-slate-500 text-sm mb-6">Crea una cuenta para guardar y descargar tus clips.</p>
          <Link href="/" className="px-5 py-2.5 bg-red-600 hover:bg-red-500 transition-colors rounded-xl text-sm font-semibold text-white">
            Ir al inicio
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d1117] pt-20 pb-16">
      <div className="max-w-3xl mx-auto px-4">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Mis clips</h1>
            <p className="text-slate-500 text-sm mt-1">Los clips se guardan por 24 horas tras su creación</p>
          </div>
          <Link
            href="/"
            className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 transition-colors rounded-xl text-sm font-medium text-white"
          >
            <Scissors className="w-4 h-4" />
            Nuevo clip
          </Link>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-red-400" />
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 bg-red-950/50 border border-red-800/40 rounded-xl px-4 py-3 text-sm text-red-300">
            <AlertCircle className="w-4 h-4" />{error}
          </div>
        )}

        {!loading && !error && clips.length === 0 && (
          <div className="text-center py-20">
            <FolderOpen className="w-12 h-12 text-slate-700 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-slate-400 mb-2">Aún no tienes clips guardados</h2>
            <p className="text-slate-600 text-sm mb-6">
              Crea un clip y activa "Guardar en mi cuenta" para verlo aquí.
            </p>
            <Link href="/" className="px-5 py-2.5 bg-red-600 hover:bg-red-500 transition-colors rounded-xl text-sm font-semibold text-white">
              Crear mi primer clip
            </Link>
          </div>
        )}

        {!loading && clips.length > 0 && (
          <div className="space-y-3">
            {clips.map((clip) => {
              const dur = clip.endStr && clip.startStr
                ? null
                : null;
              return (
                <div key={clip.id} className="bg-[#161b22] border border-white/10 rounded-xl overflow-hidden hover:border-white/20 transition-colors">
                  <div className="flex gap-3 p-4">
                    {clip.videoThumbnail ? (
                      <img
                        src={clip.videoThumbnail}
                        alt=""
                        className="w-24 h-14 object-cover rounded-lg shrink-0 bg-slate-800"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    ) : (
                      <div className="w-24 h-14 bg-slate-800/50 rounded-lg shrink-0 flex items-center justify-center">
                        <Scissors className="w-6 h-6 text-slate-600" />
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <a
                            href={clip.youtubeUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-medium text-white hover:text-red-400 transition-colors line-clamp-1 flex items-center gap-1 group"
                          >
                            <span className="truncate">{clip.videoTitle ?? "Video de YouTube"}</span>
                            <ExternalLink className="w-3 h-3 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </a>
                          <div className="flex flex-wrap items-center gap-2 mt-1.5">
                            <span className="flex items-center gap-1 text-xs text-slate-500 font-mono">
                              <Clock className="w-3 h-3" />
                              {clip.startStr} → {clip.endStr}
                            </span>
                            <span className="text-xs text-slate-600">·</span>
                            <span className="text-xs text-slate-500">{qualityLabel[clip.quality] ?? clip.quality}</span>
                            {clip.sizeBytes && (
                              <>
                                <span className="text-xs text-slate-600">·</span>
                                <span className="flex items-center gap-1 text-xs text-slate-500">
                                  <HardDrive className="w-3 h-3" />
                                  {(clip.sizeBytes / 1024 / 1024).toFixed(1)} MB
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="shrink-0">{statusBadge(clip)}</div>
                      </div>

                      <div className="flex items-center gap-2 mt-2">
                        <span className="flex items-center gap-1 text-xs text-slate-600">
                          <Calendar className="w-3 h-3" />
                          {formatDate(clip.createdAt)}
                        </span>
                        {clip.expiresAt && clip.fileAvailable && (
                          <span className="text-xs text-slate-600">
                            · Expira {formatDate(clip.expiresAt)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex border-t border-white/5">
                    {clip.fileAvailable && (
                      <a
                        href={downloadDbUrl(clip.id)}
                        download
                        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium text-green-400 hover:bg-green-950/30 transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Descargar
                      </a>
                    )}
                    <button
                      onClick={() => handleDelete(clip.id)}
                      disabled={deleting === clip.id}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium text-slate-500 hover:text-red-400 hover:bg-red-950/20 transition-colors ${clip.fileAvailable ? "border-l border-white/5" : ""}`}
                    >
                      {deleting === clip.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Trash2 className="w-3.5 h-3.5" />}
                      Eliminar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
