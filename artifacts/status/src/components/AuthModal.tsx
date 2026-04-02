import { useState } from "react";
import { X, Mail, Lock, User as UserIcon, Loader2, AlertCircle } from "lucide-react";
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

  const [form, setForm] = useState({
    email: "",
    username: "",
    password: "",
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
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
        if (!form.username.trim()) { setError("El nombre de usuario es requerido"); return; }
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[#161b22] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <div className="flex gap-1 bg-[#0d1117] rounded-lg p-1">
            <button
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${tab === "login" ? "bg-red-600 text-white" : "text-slate-400 hover:text-white"}`}
              onClick={() => { setTab("login"); setError(""); }}
            >Iniciar sesión</button>
            <button
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${tab === "register" ? "bg-red-600 text-white" : "text-slate-400 hover:text-white"}`}
              onClick={() => { setTab("register"); setError(""); }}
            >Registrarse</button>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 bg-red-950/60 border border-red-800/50 rounded-lg px-3 py-2 text-sm text-red-300">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Correo electrónico</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="email"
                required
                value={form.email}
                onChange={set("email")}
                placeholder="tu@email.com"
                className="w-full bg-[#0d1117] border border-white/10 rounded-lg pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-red-600 transition-colors"
              />
            </div>
          </div>

          {tab === "register" && (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Nombre de usuario</label>
              <div className="relative">
                <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  value={form.username}
                  onChange={set("username")}
                  placeholder="tu_usuario"
                  minLength={2}
                  maxLength={30}
                  className="w-full bg-[#0d1117] border border-white/10 rounded-lg pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-red-600 transition-colors"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Contraseña</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="password"
                required
                value={form.password}
                onChange={set("password")}
                placeholder={tab === "register" ? "Mínimo 6 caracteres" : "Tu contraseña"}
                minLength={tab === "register" ? 6 : 1}
                className="w-full bg-[#0d1117] border border-white/10 rounded-lg pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-red-600 transition-colors"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-60 disabled:cursor-not-allowed transition-colors rounded-xl py-2.5 font-semibold text-white"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {loading ? "Procesando..." : tab === "login" ? "Iniciar sesión" : "Crear cuenta"}
          </button>
        </form>
      </div>
    </div>
  );
}
