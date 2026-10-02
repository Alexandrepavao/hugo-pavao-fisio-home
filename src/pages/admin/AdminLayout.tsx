import { useMemo } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { HeartPulse, Settings } from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import AppFrame from "@/components/hp/AppFrame";
import { appForPath } from "@/components/hp/apps";
import { navForApp } from "@/components/hp/appNav";

/** "Área do paciente" é o acompanhamento clínico (papel "member") — nada a ver com o Academy, que continua com "alunos".
 *  Só aparece para quem de fato tem o papel de paciente, então nunca leva a um "Sem permissão". */
const HubFoot = () => {
  const { hasRole } = useAuth();
  if (!hasRole("member")) return null;
  return (
    <div className="hp-sb-foot">
      <Link to="/paciente" className="hp-sb-link"><HeartPulse aria-hidden /><span className="hp-sb-text">Área do paciente</span></Link>
    </div>
  );
};

/** Layout da área de gestão. O aplicativo ativo vem da URL (appForPath): cada app tem sidebar exclusiva, "Voltar ao Hub" e o seletor de aplicativos;
 *  o Hub (/admin) é a entrada central. Um aplicativo nunca concede permissão: a autorização é da rota, do RLS e das funções do banco. */
const AdminLayout = () => {
  const { pathname } = useLocation();
  const { hasRole } = useAuth();
  const appId = appForPath(pathname);
  const nav = useMemo(() => navForApp(appId), [appId]);
  return (
    <AppFrame appId={appId} nav={nav} footer={appId === "hub" ? <HubFoot /> : undefined}
      profileExtra={<>
        {appId === "hub" && <DropdownMenuItem asChild><Link to="/academy">Academy (portal do aluno)</Link></DropdownMenuItem>}
        {appId === "hub" && hasRole("member") && <DropdownMenuItem asChild><Link to="/paciente">Área do paciente</Link></DropdownMenuItem>}
        {appId === "crm" && hasRole("manager", "ops_admin", "unit_manager") && <DropdownMenuItem asChild><Link to="/admin/configuracoes"><Settings className="mr-2 h-4 w-4" aria-hidden />Configurações</Link></DropdownMenuItem>}
      </>}>
      <Outlet />
    </AppFrame>
  );
};

export default AdminLayout;
