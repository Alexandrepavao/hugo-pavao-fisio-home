import { useEffect, useState } from "react";
import { Eye, LogOut } from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { VIEW_AS_KIND_LABEL } from "@/lib/viewAs";

const H = "2.75rem";

/** Faixa fixa no topo enquanto o gestor está em “ver como”: diz quem está sendo visto, que é somente leitura e quanto tempo falta; “Sair” volta ao painel do gestor. */
export const ViewAsBanner = () => {
  const { viewAs, exitViewAs } = useAuth();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!viewAs) return; const h = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(h); }, [viewAs]);
  const left = viewAs ? new Date(viewAs.expires_at).getTime() - now : 0;
  useEffect(() => { if (viewAs && left <= 0) void exitViewAs(); }, [viewAs, left, exitViewAs]);
  useEffect(() => {
    const el = document.documentElement;
    if (viewAs) { el.dataset.viewAs = "1"; el.style.setProperty("--view-as-h", H); } else { delete el.dataset.viewAs; el.style.removeProperty("--view-as-h"); }
    return () => { delete el.dataset.viewAs; el.style.removeProperty("--view-as-h"); };
  }, [viewAs]);
  if (!viewAs) return null;
  const mins = Math.max(0, Math.round(left / 60_000)); const rest = mins >= 60 ? `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, "0")} min` : `${mins} min`;
  return (
    <div role="status" data-testid="view-as-banner" className="fixed inset-x-0 top-0 z-[400] flex items-center gap-3 px-3 sm:px-4 text-[13px]"
      style={{ height: H, background: "hsl(40 95% 52%)", color: "hsl(30 90% 12%)", boxShadow: "0 1px 0 rgba(0,0,0,.25)" }}>
      <Eye size={16} aria-hidden className="shrink-0" />
      <p className="min-w-0 flex-1 truncate leading-tight">
        <b>Ver como {VIEW_AS_KIND_LABEL[viewAs.kind]}: {viewAs.name ?? "—"}</b>
        <span className="hidden sm:inline"> · somente leitura: nada do que você fizer aqui é gravado · expira em {rest}</span>
        <span className="sm:hidden"> · somente leitura</span>
      </p>
      <button type="button" onClick={() => void exitViewAs()} data-testid="view-as-exit" className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 font-semibold"
        style={{ background: "hsl(30 90% 12%)", color: "hsl(40 95% 90%)" }}>
        <LogOut size={14} aria-hidden />Sair do ver como
      </button>
    </div>
  );
};
export default ViewAsBanner;
