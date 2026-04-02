import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getMe, logout as apiLogout, type User } from "@/lib/api";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  setUser: (u: User | null) => void;
  logout: () => Promise<void>;
  refetch: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refetch = async () => {
    try {
      const u = await getMe();
      setUser(u);
    } catch {
      setUser(null);
    }
  };

  useEffect(() => {
    refetch().finally(() => setLoading(false));
  }, []);

  const logout = async () => {
    await apiLogout().catch(() => {});
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, setUser, logout, refetch }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
