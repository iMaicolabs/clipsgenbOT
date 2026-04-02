import { useEffect, useState } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function useBotStatus() {
  const [online, setOnline] = useState<boolean | null>(null);
  useEffect(() => {
    fetch(`${BASE}/api/healthz`)
      .then((r) => r.ok ? setOnline(true) : setOnline(false))
      .catch(() => setOnline(false));
  }, []);
  return online;
}

export default function App() {
  const online = useBotStatus();

  return (
    <div className="min-h-screen bg-[#0d1117] text-white flex flex-col items-center justify-center px-4 py-16 font-sans">
      <div className="flex flex-col items-center gap-6 max-w-md w-full">

        <img
          src={`${BASE}/bot_logo.png`}
          alt="ClipsGenBOT logo"
          className="w-32 h-32 rounded-2xl shadow-lg shadow-red-900/30"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />

        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">ClipsGenBOT</h1>
          <p className="text-slate-400 mt-1 text-sm">@ClipsGenBOT · YouTube Clip Bot</p>
        </div>

        <div className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border
          ${online === null
            ? "bg-slate-800 border-slate-700 text-slate-400"
            : online
              ? "bg-green-950 border-green-800 text-green-400"
              : "bg-red-950 border-red-800 text-red-400"
          }`}>
          <span className={`w-2 h-2 rounded-full ${
            online === null ? "bg-slate-500" :
            online ? "bg-green-400 animate-pulse" : "bg-red-400"
          }`} />
          {online === null ? "Verificando..." : online ? "En línea" : "Sin conexión"}
        </div>

        <div className="w-full bg-[#161b22] border border-white/5 rounded-xl p-5 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Qué puede hacer</p>
          {[
            ["✂️", "Recortar cualquier fragmento de YouTube"],
            ["🎬", "Calidad seleccionable: 360p hasta 1080p"],
            ["🔴", "Grabar YouTube Live en tiempo real"],
            ["📦", "Enviar el clip directo a Telegram (hasta 50 MB)"],
          ].map(([icon, text]) => (
            <div key={text} className="flex items-start gap-3 text-sm text-slate-300">
              <span className="text-base leading-snug">{icon}</span>
              <span>{text}</span>
            </div>
          ))}
        </div>

        <a
          href="https://t.me/ClipsGenBOT"
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 active:bg-red-700 transition-colors rounded-xl py-3 px-6 font-semibold text-white shadow-lg shadow-red-900/30"
        >
          Abrir en Telegram
        </a>

        <p className="text-xs text-slate-600">Creado por @iMaicol · <a href="https://t.me/ClipsGenBOT" className="hover:text-slate-400 transition-colors">@ClipsGenBOT</a></p>
      </div>
    </div>
  );
}
