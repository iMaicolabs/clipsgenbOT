import { Clock, User2, ExternalLink } from "lucide-react";
import { formatDuration, type VideoInfo } from "@/lib/api";

interface Props {
  info: VideoInfo;
  url: string;
}

export default function VideoPreview({ info, url }: Props) {
  return (
    <div className="flex gap-3 p-3 bg-[#0d1117] border border-white/10 rounded-xl">
      {info.thumbnail && (
        <img
          src={info.thumbnail}
          alt={info.title}
          className="w-28 h-16 object-cover rounded-lg shrink-0 bg-slate-800"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      )}
      <div className="flex-1 min-w-0">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-sm text-white line-clamp-2 hover:text-red-400 transition-colors flex items-start gap-1 group"
        >
          <span className="line-clamp-2">{info.title}</span>
          <ExternalLink className="w-3 h-3 shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
        </a>
        <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-500">
          {info.uploader && (
            <span className="flex items-center gap-1">
              <User2 className="w-3 h-3" /> {info.uploader}
            </span>
          )}
          {info.duration > 0 && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" /> {formatDuration(info.duration)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
