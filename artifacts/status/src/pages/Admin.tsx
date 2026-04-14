import { useState, useEffect } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function Admin() {
  const [cookieText, setCookieText] = useState("");
  const [status, setStatus] = useState<{ hasCookies: boolean; updatedAt?: string; sizeBytes?: number } | null>(null);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`${BASE}/api/admin/cookies/status`)
      .then(r => r.json())
      .then(setStatus)
      .catch(() => {});
  }, []);

  async function handleUpload() {
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
      setMsg({ type: "ok", text: `✅ Cookies actualizadas (${(data.sizeBytes / 1024).toFixed(1)} KB)` });
      setCookieText("");
      const s = await fetch(`${BASE}/api/admin/cookies/status`).then(r => r.json());
      setStatus(s);
    } catch (e: any) {
      setMsg({ type: "err", text: `❌ ${e.message}` });
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!confirm("¿Eliminar las cookies del servidor?")) return;
    await fetch(`${BASE}/api/admin/cookies`, { method: "DELETE" });
    setStatus({ hasCookies: false });
    setMsg({ type: "ok", text: "Cookies eliminadas" });
  }

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-white p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Admin — Cookies de YouTube</h1>
      <p className="text-zinc-400 text-sm mb-6">
        Las cookies se usan para autenticar las descargas con YouTube. Deben exportarse
        desde un navegador con sesión iniciada usando una extensión como{" "}
        <strong>Get cookies.txt LOCALLY</strong>.
      </p>

      {status && (
        <div className={`rounded-lg p-4 mb-6 text-sm ${status.hasCookies ? "bg-zinc-800" : "bg-red-950 border border-red-800"}`}>
          {status.hasCookies ? (
            <>
              <p className="text-green-400 font-semibold">✅ Cookies activas</p>
              <p className="text-zinc-400 mt-1">
                Tamaño: {((status.sizeBytes ?? 0) / 1024).toFixed(1)} KB ·
                Actualizado: {status.updatedAt ? new Date(status.updatedAt).toLocaleString("es") : "?"}
              </p>
              <button
                onClick={handleDelete}
                className="mt-3 text-red-400 hover:text-red-300 text-xs underline"
              >
                Eliminar cookies
              </button>
            </>
          ) : (
            <p className="text-red-400 font-semibold">⚠️ Sin cookies — YouTube bloqueará muchas descargas</p>
          )}
        </div>
      )}

      <div className="mb-3">
        <label className="block text-sm font-medium text-zinc-300 mb-2">
          Pegar contenido del archivo cookies.txt (formato Netscape)
        </label>
        <textarea
          value={cookieText}
          onChange={e => setCookieText(e.target.value)}
          placeholder={"# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\t...\n..."}
          className="w-full h-48 bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-xs font-mono text-zinc-300 resize-none focus:outline-none focus:border-zinc-500"
        />
      </div>

      {msg && (
        <p className={`text-sm mb-3 ${msg.type === "ok" ? "text-green-400" : "text-red-400"}`}>
          {msg.text}
        </p>
      )}

      <button
        onClick={handleUpload}
        disabled={loading || !cookieText.trim()}
        className="bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white font-semibold px-6 py-2 rounded-lg transition-colors"
      >
        {loading ? "Guardando..." : "Actualizar cookies"}
      </button>

      <div className="mt-10 border-t border-zinc-800 pt-6">
        <h2 className="text-base font-semibold mb-3 text-zinc-300">Instrucciones</h2>
        <ol className="text-sm text-zinc-400 space-y-2 list-decimal list-inside">
          <li>Instala la extensión <strong className="text-zinc-200">Get cookies.txt LOCALLY</strong> en Chrome o Firefox.</li>
          <li>Abre <strong className="text-zinc-200">YouTube</strong> e inicia sesión con tu cuenta.</li>
          <li>Haz clic en la extensión y exporta las cookies de <code className="bg-zinc-800 px-1 rounded">youtube.com</code>.</li>
          <li>Copia todo el contenido del archivo <code className="bg-zinc-800 px-1 rounded">.txt</code> y pégalo arriba.</li>
          <li>Haz clic en <strong className="text-zinc-200">Actualizar cookies</strong>.</li>
        </ol>
      </div>
    </div>
  );
}
