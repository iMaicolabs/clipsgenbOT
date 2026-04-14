import { useState, useEffect, useRef } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface CookieStatus {
  hasCookies: boolean;
  hasOAuth: boolean;
  sizeBytes?: number;
  updatedAt?: string;
  oauthExpires?: string;
}

interface OAuthSession {
  deviceUrl: string;
  userCode: string;
  startedAt: number;
  done: boolean;
  error?: string;
}

export default function Admin() {
  const [cookieText, setCookieText] = useState("");
  const [status, setStatus] = useState<CookieStatus | null>(null);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"oauth" | "cookies">("oauth");

  const [oauthSession, setOauthSession] = useState<OAuthSession | null>(null);
  const [oauthLoading, setOauthLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function refreshStatus() {
    const s = await fetch(`${BASE}/api/admin/cookies/status`).then(r => r.json()).catch(() => null);
    if (s) setStatus(s);
  }

  useEffect(() => {
    refreshStatus();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  async function startOAuth() {
    setOauthLoading(true);
    setMsg(null);
    try {
      const res = await fetch(`${BASE}/api/admin/oauth2/start`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error iniciando OAuth");
      setOauthSession(data);

      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        const s = await fetch(`${BASE}/api/admin/oauth2/status`).then(r => r.json()).catch(() => null);
        if (s?.hasToken) {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setOauthSession(null);
          setMsg({ type: "ok", text: "✅ Cuenta de YouTube conectada correctamente. Los livestreams ahora funcionarán sin cookies." });
          await refreshStatus();
        } else if (s?.session?.done && s?.session?.error) {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setMsg({ type: "err", text: `❌ Error: ${s.session.error}` });
          setOauthSession(null);
        }
      }, 3000);
    } catch (e: any) {
      setMsg({ type: "err", text: `❌ ${e.message}` });
    } finally {
      setOauthLoading(false);
    }
  }

  async function revokeOAuth() {
    if (!confirm("¿Desconectar la cuenta de YouTube?")) return;
    await fetch(`${BASE}/api/admin/oauth2/token`, { method: "DELETE" });
    setMsg({ type: "ok", text: "Cuenta desconectada" });
    await refreshStatus();
  }

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
      setMsg({ type: "ok", text: `✅ Cookies actualizadas (${(data.sizeBytes / 1024).toFixed(1)} KB)` });
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

  const isAuthenticated = status?.hasCookies || status?.hasOAuth;

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-white p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Admin — Autenticación YouTube</h1>
      <p className="text-zinc-500 text-sm mb-6">Necesario para descargar livestreams y contenido con restricciones</p>

      {status && (
        <div className={`rounded-lg p-4 mb-6 text-sm ${isAuthenticated ? "bg-zinc-800 border border-zinc-700" : "bg-red-950 border border-red-800"}`}>
          {isAuthenticated ? (
            <div className="space-y-1">
              <p className="text-green-400 font-semibold">✅ Autenticación activa</p>
              {status.hasOAuth && (
                <p className="text-zinc-400">
                  OAuth2 conectado
                  {status.oauthExpires && ` · Token expira: ${new Date(status.oauthExpires).toLocaleString("es")}`}
                </p>
              )}
              {status.hasCookies && (
                <p className="text-zinc-400">
                  Cookies activas · {((status.sizeBytes ?? 0) / 1024).toFixed(1)} KB
                  {status.updatedAt && ` · ${new Date(status.updatedAt).toLocaleString("es")}`}
                </p>
              )}
            </div>
          ) : (
            <p className="text-red-400 font-semibold">⚠️ Sin autenticación — Los livestreams fallarán</p>
          )}
        </div>
      )}

      {msg && (
        <p className={`text-sm mb-4 p-3 rounded-lg ${msg.type === "ok" ? "bg-green-950 text-green-400 border border-green-800" : "bg-red-950 text-red-400 border border-red-800"}`}>
          {msg.text}
        </p>
      )}

      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setTab("oauth")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === "oauth" ? "bg-red-600 text-white" : "bg-zinc-800 text-zinc-400 hover:text-white"}`}
        >
          OAuth2 (recomendado)
        </button>
        <button
          onClick={() => setTab("cookies")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === "cookies" ? "bg-red-600 text-white" : "bg-zinc-800 text-zinc-400 hover:text-white"}`}
        >
          Cookies manuales
        </button>
      </div>

      {tab === "oauth" && (
        <div>
          <p className="text-sm text-zinc-400 mb-4">
            Conecta una cuenta de Google/YouTube directamente. No necesitas extensiones de navegador
            y el token dura meses sin expirar.
          </p>

          {oauthSession && !oauthSession.done ? (
            <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-5 mb-4">
              <p className="text-sm text-zinc-300 mb-3">Sigue estos pasos para conectar tu cuenta:</p>
              <ol className="text-sm space-y-3">
                <li className="flex gap-3">
                  <span className="text-red-500 font-bold">1.</span>
                  <span>
                    Ve a{" "}
                    <a href={oauthSession.deviceUrl} target="_blank" rel="noreferrer"
                      className="text-blue-400 underline font-mono">
                      {oauthSession.deviceUrl}
                    </a>
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="text-red-500 font-bold">2.</span>
                  <span>
                    Ingresa el código:{" "}
                    <code className="bg-zinc-700 px-3 py-1 rounded-lg text-white font-mono text-lg tracking-widest">
                      {oauthSession.userCode}
                    </code>
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="text-red-500 font-bold">3.</span>
                  <span className="text-zinc-400">
                    Esta página se actualizará automáticamente cuando se complete la autenticación.
                  </span>
                </li>
              </ol>
              <div className="mt-4 flex items-center gap-2 text-zinc-500 text-xs">
                <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />
                Esperando confirmación...
              </div>
            </div>
          ) : (
            <div className="flex gap-3">
              <button
                onClick={startOAuth}
                disabled={oauthLoading}
                className="bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white font-semibold px-6 py-2 rounded-lg transition-colors"
              >
                {oauthLoading ? "Iniciando..." : "Conectar cuenta de YouTube"}
              </button>
              {status?.hasOAuth && (
                <button
                  onClick={revokeOAuth}
                  className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2 rounded-lg text-sm transition-colors"
                >
                  Desconectar
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "cookies" && (
        <div>
          <p className="text-sm text-zinc-400 mb-4">
            Exporta las cookies de YouTube desde tu navegador con la extensión
            <strong className="text-zinc-200"> Get cookies.txt LOCALLY</strong> y pégalas aquí.
          </p>

          <div className="mb-3">
            <label className="block text-sm font-medium text-zinc-300 mb-2">
              Contenido del archivo cookies.txt (formato Netscape)
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
              {loading ? "Guardando..." : "Actualizar cookies"}
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
        </div>
      )}
    </div>
  );
}
