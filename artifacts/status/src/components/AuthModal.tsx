import { useState } from "react";
import { X, Mail, Lock, User as UserIcon, Loader2, AlertCircle, Sparkles } from "lucide-react";
import { login, register, type User } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

interface Props {
  onClose: () => void;
  defaultTab?: "login" | "register";
}

export default function AuthModal({ onClose, defaultTab = "login" }: Props) {
  const { setUser } = useAuth();
  const [tab, setTab] = useState<"login" | "register">(defaultTab);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ email: "", username: "", password: "" });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm(f => ({ ...f, [k]: e.target.value }));
    setError("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      let user: User;
      if (tab === "login") {
        user = await login(form.email, form.password);
      } else {
        if (!form.username.trim()) { setError("El nombre de usuario es requerido"); setLoading(false); return; }
        user = await register(form.email, form.username, form.password);
      }
      setUser(user);
      onClose();
    } catch (err: any) {
      setError(err.message ?? "Error desconocido");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-white/10 shadow-2xl overflow-hidden"
        style={{ background: "rgba(14,14,20,0.98)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative px-6 pt-6 pb-5">
          <div className="absolute top-4 right-4">
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-white hover:bg-white/10 transition-all">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg" style={{ background: "linear-gradient(135deg,#e53e3e,#c53030)" }}>
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">{tab === "login" ? "Bienvenido de vuelta" : "Crear cuenta"}</h2>
              <p className="text-xs text-slate-500">{tab === "login" ? "Accede a tus clips guardados" : "Guarda y descarga tus clips"}</p>
            </div>
          </div>

          {/* Tab switcher */}
          <div className="flex gap-1 bg-white/5 rounded-xl p-1">
            <button
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${tab === "login" ? "bg-white/10 text-white shadow-sm" : "text-slate-500 hover:text-slate-300"}`}
              onClick={() => { setTab("login"); setError(""); }}
            >Iniciar sesión</button>
            <button
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${tab === "register" ? "bg-white/10 text-white shadow-sm" : "text-slate-500 hover:text-slate-300"}`}
              onClick={() => { setTab("register"); setError(""); }}
            >Registrarse</button>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 pb-6 space-y-3">
          {error && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5 text-sm text-red-400">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <div>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="email"
                required
                value={form.email}
                onChange={set("email")}
                placeholder="Correo electrónico"
                className="w-full rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder:text-slate-600 focus:outline-none transition-colors border"
                style={{ background: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.08)" }}
                onFocus={e => e.target.style.borderColor = "rgba(229,62,62,0.5)"}
                onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.08)"}
              />
            </div>
          </div>

          {tab === "register" && (
            <div className="relative">
              <UserIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={form.username}
                onChange={set("username")}
                placeholder="Nombre de usuario"
                minLength={2}
                maxLength={30}
                className="w-full rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder:text-slate-600 focus:outline-none transition-colors border"
                style={{ background: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.08)" }}
                onFocus={e => e.target.style.borderColor = "rgba(229,62,62,0.5)"}
                onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.08)"}
              />
            </div>
          )}

          <div className="relative">
            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="password"
              required
              value={form.password}
              onChange={set("password")}
              placeholder={tab === "register" ? "Contraseña (mín. 6 caracteres)" : "Contraseña"}
              minLength={tab === "register" ? 6 : 1}
              className="w-full rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder:text-slate-600 focus:outline-none transition-colors border"
              style={{ background: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.08)" }}
              onFocus={e => e.target.style.borderColor = "rgba(229,62,62,0.5)"}
              onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.08)"}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 rounded-xl py-3 font-bold text-white text-sm transition-all mt-1 shadow-lg disabled:opacity-60"
            style={{ background: loading ? "rgba(229,62,62,0.7)" : "linear-gradient(135deg,#e53e3e,#c53030)" }}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {loading ? "Procesando..." : tab === "login" ? "Iniciar sesión" : "Crear cuenta gratis"}
          </button>

          <p className="text-center text-xs text-slate-600 pt-1">
            {tab === "login" ? "¿No tienes cuenta? " : "¿Ya tienes cuenta? "}
            <button type="button" onClick={() => { setTab(tab === "login" ? "register" : "login"); setError(""); }} className="text-red-400 hover:text-red-300 transition-colors font-medium">
              {tab === "login" ? "Regístrate gratis" : "Inicia sesión"}
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}
