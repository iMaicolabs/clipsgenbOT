import { Clock, User2, ExternalLink, CheckCircle2, Radio, Video } from "lucide-react";
import { formatDuration, type VideoInfo } from "@/lib/api";

interface Props {
  info: VideoInfo;
  url: string;
}

export default function VideoPreview({ info, url }: Props) {
  const isLiveNow = info.isLive;
  const isLiveRecording = !info.isLive && info.wasLive;
  const isVod = !info.isLive && !info.wasLive;

  return (
    <div className="flex gap-3 p-3 rounded-xl border border-green-500/15 mt-1" style={{ background: "rgba(34,197,94,0.05)" }}>
      <div className="relative shrink-0">
        {info.thumbnail ? (
          <img
            src={info.thumbnail}
            alt={info.title}
            className="w-20 h-12 object-cover rounded-lg bg-slate-800"
            onError={e => {
              (e.target as HTMLImageElement).src = info.thumbnail.replace("maxresdefault", "hqdefault");
            }}
          />
        ) : (
          <div className="w-20 h-12 rounded-lg bg-white/5" />
        )}
        {isLiveNow && (
          <span className="absolute top-1 left-1 flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-bold bg-red-600 text-white leading-none">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />EN VIVO
          </span>
        )}
        {isLiveRecording && (
          <span className="absolute top-1 left-1 flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-bold bg-purple-700 text-white leading-none">
            <Radio className="w-2 h-2" />LIVE
          </span>
        )}
        {isVod && (
          <span className="absolute top-1 left-1 flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-bold bg-black/60 text-slate-300 leading-none">
            <Video className="w-2 h-2" />VIDEO
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-1">
          <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0 mt-0.5" />
          <a
            href={url} target="_blank" rel="noopener noreferrer"
            className="text-xs font-semibold text-white line-clamp-2 hover:text-red-300 transition-colors leading-snug group"
          >
            {info.title}
            <ExternalLink className="w-2.5 h-2.5 inline ml-1 opacity-0 group-hover:opacity-60 transition-opacity" />
          </a>
        </div>
        <div className="flex items-center gap-2.5 mt-1">
          {info.uploader && (
            <span className="flex items-center gap-1 text-[11px] text-slate-500">
              <User2 className="w-2.5 h-2.5" />{info.uploader}
            </span>
          )}
          {info.duration > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-slate-500">
              <Clock className="w-2.5 h-2.5" />{formatDuration(info.duration)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
