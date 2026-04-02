import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Scissors, FolderOpen, LogIn, LogOut, User, ChevronDown } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import AuthModal from "./AuthModal";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

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
      <nav className="fixed top-0 left-0 right-0 z-40 bg-[#0d1117]/80 backdrop-blur-md border-b border-white/5">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center shadow-lg shadow-red-900/30 group-hover:bg-red-500 transition-colors">
              <Scissors className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-white text-sm">ClipsGenBOT</span>
          </Link>

          <div className="flex items-center gap-1">
            <Link
              href="/"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                location === "/" ? "bg-white/10 text-white" : "text-slate-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <Scissors className="w-3.5 h-3.5" />
              Recortar
            </Link>

            {user && (
              <Link
                href="/mis-clips"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  location === "/mis-clips" ? "bg-white/10 text-white" : "text-slate-400 hover:text-white hover:bg-white/5"
                }`}
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Mis clips
              </Link>
            )}

            {user ? (
              <div className="relative ml-1">
                <button
                  onClick={() => setShowDropdown((v) => !v)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
                >
                  <User className="w-3.5 h-3.5 text-red-400" />
                  <span className="max-w-[100px] truncate">{user.username}</span>
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
                {showDropdown && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowDropdown(false)} />
                    <div className="absolute right-0 top-full mt-1 bg-[#161b22] border border-white/10 rounded-xl shadow-xl w-48 py-1 z-20">
                      <div className="px-3 py-2 border-b border-white/5">
                        <p className="text-xs text-slate-500">Conectado como</p>
                        <p className="text-sm font-medium text-white truncate">{user.email}</p>
                      </div>
                      <button
                        onClick={async () => { setShowDropdown(false); await logout(); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-red-400 hover:bg-red-950/30 transition-colors"
                      >
                        <LogOut className="w-4 h-4" />
                        Cerrar sesión
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1 ml-1">
                <button
                  onClick={() => openAuth("login")}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  Entrar
                </button>
                <button
                  onClick={() => openAuth("register")}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-500 text-white transition-colors"
                >
                  Registrarse
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {showAuth && (
        <AuthModal
          defaultTab={authTab}
          onClose={() => setShowAuth(false)}
        />
      )}
    </>
  );
}
