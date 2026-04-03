import { Clock, User2, ExternalLink, CheckCircle2 } from "lucide-react";
import { formatDuration, type VideoInfo } from "@/lib/api";

interface Props {
  info: VideoInfo;
  url: string;
}

export default function VideoPreview({ info, url }: Props) {
  return (
    <div className="flex gap-3 p-3 rounded-xl border border-green-500/15 mt-1" style={{ background: "rgba(34,197,94,0.05)" }}>
      {info.thumbnail ? (
        <img
          src={info.thumbnail}
          alt={info.title}
          className="w-20 h-12 object-cover rounded-lg shrink-0 bg-slate-800"
          onError={e => {
            (e.target as HTMLImageElement).src = info.thumbnail.replace("maxresdefault", "hqdefault");
          }}
        />
      ) : (
        <div className="w-20 h-12 rounded-lg shrink-0 bg-white/5" />
      )}
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
