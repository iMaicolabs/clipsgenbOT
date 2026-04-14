import { Route, Switch } from "wouter";
import { AuthProvider } from "@/contexts/AuthContext";
import Navbar from "@/components/Navbar";
import Home from "@/pages/Home";
import MyClips from "@/pages/MyClips";
import Admin from "@/pages/Admin";
import NotFound from "@/pages/not-found";

export default function App() {
  return (
    <AuthProvider>
      <div className="min-h-screen bg-[#0d1117] text-white font-sans">
        <Navbar />
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/mis-clips" component={MyClips} />
          <Route path="/admin" component={Admin} />
          <Route component={NotFound} />
        </Switch>
      </div>
    </AuthProvider>
  );
}
