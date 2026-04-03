import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Scissors, FolderOpen, LogOut, User, ChevronDown, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import AuthModal from "./AuthModal";

export default function Navbar() {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const [showAuth, setShowAuth] = useState(false);
  const [authTab, setAuthTab] = useState<"login" | "register">("login");
  const [showDropdown, setShowDropdown] = useState(false);

  const openAuth = (tab: "login" | "register") => {
    setAuthTab(tab);
    setShowAuth(true);
  };

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-40 border-b border-white/5" style={{ background: "rgba(10,10,15,0.85)", backdropFilter: "blur(20px)" }}>
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">

          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center shadow-lg" style={{ background: "linear-gradient(135deg, #e53e3e, #c53030)" }}>
              <Scissors className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-white text-[15px] tracking-tight">ClipsGen<span className="text-red-400">BOT</span></span>
          </Link>

          <div className="flex items-center gap-1">
            <Link
              href="/"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                location === "/" ? "bg-white/10 text-white" : "text-slate-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <Scissors className="w-3.5 h-3.5" /> Recortar
            </Link>

            {user && (
              <Link
                href="/mis-clips"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  location === "/mis-clips" ? "bg-white/10 text-white" : "text-slate-400 hover:text-white hover:bg-white/5"
                }`}
              >
                <FolderOpen className="w-3.5 h-3.5" /> Mis clips
              </Link>
            )}

            {user ? (
              <div className="relative ml-1">
                <button
                  onClick={() => setShowDropdown(v => !v)}
                  className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-xl text-sm font-medium text-slate-300 hover:text-white transition-colors border border-white/10 hover:border-white/20"
                >
                  <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center text-xs font-bold text-white">
                    {user.username[0].toUpperCase()}
                  </div>
                  <span className="max-w-[90px] truncate">{user.username}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                </button>
                {showDropdown && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowDropdown(false)} />
                    <div className="absolute right-0 top-full mt-2 border border-white/10 rounded-2xl shadow-2xl w-52 py-2 z-20 overflow-hidden" style={{ background: "rgba(20,20,28,0.98)", backdropFilter: "blur(20px)" }}>
                      <div className="px-4 py-3 border-b border-white/5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center font-bold text-white">
                            {user.username[0].toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-white">{user.username}</p>
                            <p className="text-xs text-slate-500 truncate">{user.email}</p>
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={async () => { setShowDropdown(false); await logout(); }}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        <LogOut className="w-4 h-4" /> Cerrar sesión
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 ml-1">
                <button
                  onClick={() => openAuth("login")}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium text-slate-400 hover:text-white hover:bg-white/5 transition-all"
                >
                  Entrar
                </button>
                <button
                  onClick={() => openAuth("register")}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold text-white transition-all shadow-lg"
                  style={{ background: "linear-gradient(135deg, #e53e3e, #c53030)" }}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Registrarse
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {showAuth && (
        <AuthModal defaultTab={authTab} onClose={() => setShowAuth(false)} />
      )}
    </>
  );
}
