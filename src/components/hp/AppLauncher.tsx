import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { APPS } from "./apps";
import { AppTile } from "./HeaderBar";

/** Aplicativos que o usuário pode abrir (o papel só filtra o que aparece; a autorização real continua na rota, no RLS e nas funções do banco). */
const AppLauncher = () => {
  const { hasRole } = useAuth();
  const apps = APPS.filter((a) => a.id !== "hub" && (!a.roles || hasRole(...a.roles)));
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label="Aplicativos">
      {apps.map((a) => (
        <li key={a.id} className="list-none">
          <Link to={a.to} className="hp-card group flex items-center gap-3 p-3.5 h-full hover:shadow-md hover:border-input transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Abrir ${a.label}`}>
            <AppTile app={a} size="lg" />
            <span className="min-w-0 flex-1"><span className="block font-bold text-[13.5px] leading-5" style={{ fontFamily: "Manrope, Inter, sans-serif" }}>{a.label}</span><span className="block text-xs text-muted-foreground leading-4">{a.description}</span></span>
            <ArrowRight aria-hidden size={15} className="text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition" />
          </Link>
        </li>
      ))}
    </ul>
  );
};

export default AppLauncher;
