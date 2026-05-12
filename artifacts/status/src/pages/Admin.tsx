import { useState, useEffect } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface CookieStatus {
  hasCookies: boolean;
  hasOAuth: boolean;
  sizeBytes?: number;
  updatedAt?: string;
}

export default function Admin() {
  const [cookieText, setCookieText] = useState("");
  const [status, setStatus] = useState<CookieStatus | null>(null);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function refreshStatus() {
    const s = await fetch(`${BASE}/api/admin/cookies/status`).then(r => r.json()).catch(() => null);
    if (s) setStatus(s);
  }

  useEffect(() => { refreshStatus(); }, []);

  async function handleCookieUpload() {
    if (!cookieText.trim()) return;
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch(`${BASE}/api/admin/cookies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: cookieText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error desconocido");
      setMsg({ type: "ok", text: `✅ Cookies actualizadas correctamente (${(data.sizeBytes / 1024).toFixed(1)} KB). Las descargas deberían funcionar ahora.` });
      setCookieText("");
      await refreshStatus();
    } catch (e: any) {
      setMsg({ type: "err", text: `❌ ${e.message}` });
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteCookies() {
    if (!confirm("¿Eliminar las cookies del servidor?")) return;
    await fetch(`${BASE}/api/admin/cookies`, { method: "DELETE" });
    setMsg({ type: "ok", text: "Cookies eliminadas" });
    await refreshStatus();
  }

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-white p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Admin — Autenticación YouTube</h1>
      <p className="text-zinc-500 text-sm mb-6">
        Requerido para descargar videos desde este servidor
      </p>

      {/* Status banner */}
      {status && (
        <div className={`rounded-lg p-4 mb-6 text-sm ${status.hasCookies ? "bg-zinc-800 border border-zinc-700" : "bg-red-950 border border-red-800"}`}>
          {status.hasCookies ? (
            <div className="space-y-1">
              <p className="text-green-400 font-semibold">✅ Cookies activas — las descargas están habilitadas</p>
              <p className="text-zinc-400">
                {((status.sizeBytes ?? 0) / 1024).toFixed(1)} KB
                {status.updatedAt && ` · Actualizadas: ${new Date(status.updatedAt).toLocaleString("es")}`}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-red-400 font-semibold">⚠️ Sin cookies — las descargas fallarán</p>
              <p className="text-zinc-400 text-xs">YouTube bloquea descargas desde servidores en la nube sin autenticación.</p>
            </div>
          )}
        </div>
      )}

      {msg && (
        <p className={`text-sm mb-5 p-3 rounded-lg ${msg.type === "ok" ? "bg-green-950 text-green-400 border border-green-800" : "bg-red-950 text-red-400 border border-red-800"}`}>
          {msg.text}
        </p>
      )}

      {/* Instructions */}
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-5 mb-5">
        <p className="font-semibold text-zinc-200 mb-3">Cómo exportar las cookies de YouTube</p>
        <ol className="text-sm text-zinc-400 space-y-2">
          <li className="flex gap-3">
            <span className="text-red-500 font-bold shrink-0">1.</span>
            <span>
              Instala la extensión{" "}
              <a
                href="https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc"
                target="_blank"
                rel="noreferrer"
                className="text-blue-400 underline"
              >
                Get cookies.txt LOCALLY
              </a>{" "}
              en Chrome/Edge (o equivalente en Firefox).
            </span>
          </li>
          <li className="flex gap-3">
            <span className="text-red-500 font-bold shrink-0">2.</span>
            <span>
              Entra a{" "}
              <a href="https://youtube.com" target="_blank" rel="noreferrer" className="text-blue-400 underline">
                youtube.com
              </a>{" "}
              con tu cuenta de Google.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="text-red-500 font-bold shrink-0">3.</span>
            <span>Haz clic en la extensión → selecciona <strong className="text-zinc-200">youtube.com</strong> → exporta como <code className="text-xs bg-zinc-800 px-1 rounded">cookies.txt</code>.</span>
          </li>
          <li className="flex gap-3">
            <span className="text-red-500 font-bold shrink-0">4.</span>
            <span>Abre el archivo descargado, copia todo el contenido y pégalo abajo.</span>
          </li>
        </ol>
      </div>

      {/* Paste area */}
      <div className="mb-3">
        <label className="block text-sm font-medium text-zinc-300 mb-2">
          Contenido del archivo cookies.txt <span className="text-zinc-500 font-normal">(formato Netscape)</span>
        </label>
        <textarea
          value={cookieText}
          onChange={e => setCookieText(e.target.value)}
          placeholder={"# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\t...\n..."}
          className="w-full h-48 bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-xs font-mono text-zinc-300 resize-none focus:outline-none focus:border-zinc-500"
        />
      </div>

      <div className="flex gap-3">
        <button
          onClick={handleCookieUpload}
          disabled={loading || !cookieText.trim()}
          className="bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white font-semibold px-6 py-2 rounded-lg transition-colors"
        >
          {loading ? "Guardando..." : "Guardar cookies"}
        </button>
        {status?.hasCookies && (
          <button
            onClick={handleDeleteCookies}
            className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2 rounded-lg text-sm transition-colors"
          >
            Eliminar cookies
          </button>
        )}
      </div>

      <p className="text-xs text-zinc-600 mt-4">
        Las cookies se almacenan en el servidor y se usan exclusivamente para autenticar las descargas de YouTube.
        Se recomienda renovarlas cada 2–4 semanas o si las descargas vuelven a fallar.
      </p>
    </div>
  );
}
