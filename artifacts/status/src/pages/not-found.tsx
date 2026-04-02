import { Link } from "wouter";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#0d1117] flex items-center justify-center pt-14">
      <div className="text-center px-4">
        <AlertCircle className="w-12 h-12 text-slate-700 mx-auto mb-4" />
        <h1 className="text-3xl font-bold text-white mb-2">404</h1>
        <p className="text-slate-500 mb-6">Página no encontrada</p>
        <Link href="/" className="px-5 py-2.5 bg-red-600 hover:bg-red-500 transition-colors rounded-xl text-sm font-semibold text-white">
          Ir al inicio
        </Link>
      </div>
    </div>
  );
}
