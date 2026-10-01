import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Outlet, Navigate, useLocation } from "react-router-dom";
import Index from "./pages/Index";
import TrabalheConosco from "./pages/TrabalheConosco";
import NotFound from "./pages/NotFound";
import FeatureGate from "./components/hp/FeatureGate";
import EnvBadge from "./components/hp/EnvBadge";
import { AuthProvider, STAFF_ROLES, type AppRole } from "./auth/AuthProvider";
import RequireAuth from "./auth/RequireAuth";
import { AskProvider } from "./lib/ui";
const Login = lazy(() => import("./pages/auth/Login"));
const ResetPassword = lazy(() => import("./pages/auth/ResetPassword"));
const FirstAccess = lazy(() => import("./pages/auth/FirstAccess"));
const Confirmar = lazy(() => import("./pages/auth/Confirmar"));
const AdminLayout = lazy(() => import("./pages/admin/AdminLayout"));
const AdminHome = lazy(() => import("./pages/admin/AdminHome"));
const Overview = lazy(() => import("./pages/admin/Overview"));
const People = lazy(() => import("./pages/admin/People"));
const Audit = lazy(() => import("./pages/admin/Audit"));
const Pages = lazy(() => import("./pages/admin/Pages"));
const PageEditor = lazy(() => import("./pages/admin/PageEditor"));
const CrmDashboard = lazy(() => import("./pages/admin/crm/CrmDashboard"));
const CrmLeads = lazy(() => import("./pages/admin/crm/Leads"));
const CrmContacts = lazy(() => import("./pages/admin/crm/Contacts"));
const CrmLists = lazy(() => import("./pages/admin/crm/Lists"));
const CrmPipeline = lazy(() => import("./pages/admin/crm/Pipeline"));
const CrmTasks = lazy(() => import("./pages/admin/crm/Tasks"));
const CrmMinhaMeta = lazy(() => import("./pages/admin/crm/MinhaMeta"));
const CrmRitmo = lazy(() => import("./pages/admin/crm/Ritmo"));
const CrmTeam = lazy(() => import("./pages/admin/crm/CrmTeam"));
const CrmConversas = lazy(() => import("./pages/admin/crm/Conversas"));
const CrmMensagensAgendadas = lazy(() => import("./pages/admin/crm/MensagensAgendadas"));
const CrmDisparo = lazy(() => import("./pages/admin/crm/Disparo"));
const CrmReports = lazy(() => import("./pages/admin/crm/Reports"));
const AdmDashboard = lazy(() => import("./pages/admin/adm/AdmDashboard"));
const AdmDiretorio = lazy(() => import("./pages/admin/adm/Diretorio"));
const AdmPendencias = lazy(() => import("./pages/admin/adm/AdmPendencias"));
const Agenda = lazy(() => import("./pages/admin/Agenda"));
const FinanceOverview = lazy(() => import("./pages/admin/finance/Overview"));
const FinanceSales = lazy(() => import("./pages/admin/finance/Sales"));
const FinancePayables = lazy(() => import("./pages/admin/finance/Payables"));
const FinanceCashFlow = lazy(() => import("./pages/admin/finance/CashFlow"));
const FinanceRecurrence = lazy(() => import("./pages/admin/finance/Recurrence"));
const FinanceDre = lazy(() => import("./pages/admin/finance/Dre"));
const FinanceCommissions = lazy(() => import("./pages/admin/finance/Commissions"));
const FinanceReconciliation = lazy(() => import("./pages/admin/finance/Reconciliation"));
const FinanceReports = lazy(() => import("./pages/admin/finance/Reports"));
const FinanceCards = lazy(() => import("./pages/admin/finance/Cards"));
const FinanceSettings = lazy(() => import("./pages/admin/finance/Settings"));
const AcademyAdmin = lazy(() => import("./pages/admin/AcademyAdmin"));
const Care = lazy(() => import("./pages/admin/Care"));
const Partners = lazy(() => import("./pages/admin/Partners"));
const Research = lazy(() => import("./pages/admin/Research"));
const CorporateAccounts = lazy(() => import("./pages/admin/CorporateAccounts"));
const Team = lazy(() => import("./pages/admin/Team"));
const Productivity = lazy(() => import("./pages/admin/Productivity"));
const MySummary = lazy(() => import("./pages/admin/MySummary"));
const PublicPage = lazy(() => import("./pages/PublicPage"));
const Landing = lazy(() => import("./pages/portal/Landing"));
const Patient = lazy(() => import("./pages/portal/Patient"));
const Partner = lazy(() => import("./pages/portal/Partner"));
const AcademyHome = lazy(() => import("./pages/portal/Academy").then((m) => ({ default: m.AcademyHome })));
const CourseView = lazy(() => import("./pages/portal/Academy").then((m) => ({ default: m.CourseView })));
const PortalResearch = lazy(() => import("./pages/portal/Research"));
const Avaliacao = lazy(() => import("./pages/quiz/Avaliacao"));
const SejaParceiro = lazy(() => import("./pages/quiz/SejaParceiro"));
const LeadCapture = lazy(() => import("./pages/admin/LeadCapture"));
const SettingsHub = lazy(() => import("./pages/admin/SettingsHub"));

const R = {
  people: ["manager", "ops_admin", "unit_manager", "sales"] as AppRole[],
  pages: ["manager", "ops_admin", "unit_manager", "sales"] as AppRole[],
  agenda: ["manager", "ops_admin", "unit_manager", "sales", "physio"] as AppRole[],
  finance: ["manager", "ops_admin", "unit_manager", "finance", "sales"] as AppRole[],
  academy: ["manager", "ops_admin", "teacher"] as AppRole[],
  care: ["manager", "ops_admin", "unit_manager", "physio"] as AppRole[],
  partners: ["manager", "ops_admin", "unit_manager", "finance", "sales"] as AppRole[],
  research: ["manager", "ops_admin"] as AppRole[],
  corporate: ["manager", "ops_admin", "unit_manager", "finance"] as AppRole[],
  leads: ["manager", "ops_admin", "unit_manager", "sales"] as AppRole[],
  team: ["manager", "ops_admin"] as AppRole[],
  crmTeam: ["manager", "ops_admin", "unit_manager"] as AppRole[],
  portal: ["member", "teacher", "manager", "ops_admin", "unit_manager", "sales", "finance", "physio", "partner"] as AppRole[],
};
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });
const g = (roles: AppRole[], el: JSX.Element) => <RequireAuth roles={roles}>{el}</RequireAuth>;

/** Endereços amigáveis por aplicativo (/admin/gestao, /admin/operacao, /admin/pages, /admin/produtividade, /admin/administrativo) levam às rotas existentes, mantendo
 *  parâmetros e âncora; as rotas antigas continuam valendo. Mapa fixo (sem laço): o destino nunca é outro alias. */
const ALIASES: Record<string, Record<string, string>> = {
  administrativo: { "": "/admin/adm", diretorio: "/admin/adm/diretorio", pendencias: "/admin/adm/pendencias" },
  gestao: { "": "/admin/adm", pessoas: "/admin/pessoas", equipe: "/admin/equipe", configuracoes: "/admin/configuracoes", auditoria: "/admin/auditoria", diretorio: "/admin/adm/diretorio", pendencias: "/admin/adm/pendencias" },
  operacao: { "": "/admin/agenda", agenda: "/admin/agenda", acompanhamento: "/admin/acompanhamento" },
  pages: { "": "/admin/paginas", paginas: "/admin/paginas", captacao: "/admin/captacao-leads", pesquisas: "/admin/pesquisas" },
  produtividade: { "": "/admin/meu-dia" },
};
const AppAlias = ({ app }: { app: keyof typeof ALIASES }) => {
  const l = useLocation();
  const rest = l.pathname.replace(new RegExp(`^/admin/${app}/?`), "").split("/")[0];
  const to = ALIASES[app][rest] ?? ALIASES[app][""];
  return <Navigate to={`${to}${l.search}${l.hash}`} replace />;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <EnvBadge />
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <AskProvider>
          <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-navy-400" role="status">Carregando…</div>}>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/trabalhe-conosco" element={<TrabalheConosco />} />
              <Route path="/avaliacao" element={<Avaliacao />} />
              <Route path="/seja-parceiro" element={<SejaParceiro />} />
              <Route path="/login" element={<Login />} />
              <Route path="/primeiro-acesso" element={<FirstAccess />} />
              <Route path="/redefinir-senha" element={<ResetPassword />} />
              <Route path="/confirmar" element={<Confirmar />} />
              <Route path="/app" element={<Landing />} />
              <Route path="/admin" element={<RequireAuth roles={STAFF_ROLES}><AdminLayout /></RequireAuth>}>
                <Route index element={<AdminHome />} />
                <Route path="administrativo/*" element={<AppAlias app="administrativo" />} />
                <Route path="gestao/*" element={<AppAlias app="gestao" />} />
                <Route path="operacao/*" element={<AppAlias app="operacao" />} />
                <Route path="pages/*" element={<AppAlias app="pages" />} />
                <Route path="produtividade/*" element={<AppAlias app="produtividade" />} />
                <Route path="meu-dia" element={<Productivity />} />
                <Route path="meu-resumo" element={<RequireAuth roles={["physio", "manager", "ops_admin", "unit_manager"]}><MySummary /></RequireAuth>} />
                <Route path="status" element={<FeatureGate feature="system_status"><Overview /></FeatureGate>} />
                <Route path="pessoas" element={g(R.people, <People />)} />
                <Route path="paginas" element={g(R.pages, <Pages />)} />
                <Route path="paginas/:id" element={g(R.pages, <PageEditor />)} />
                <Route path="crm" element={g(R.people, <Outlet />)}>
                  <Route index element={<CrmDashboard />} />
                  <Route path="leads" element={<CrmLeads />} />
                  <Route path="contatos" element={<CrmContacts />} />
                  <Route path="listas" element={<CrmLists />} />
                  <Route path="oportunidades" element={<CrmPipeline />} />
                  <Route path="tarefas" element={<CrmTasks />} />
                  <Route path="metas" element={<CrmMinhaMeta />} />
                  <Route path="metas/ritmo" element={<CrmRitmo />} />
                  <Route path="metas/time" element={g(R.crmTeam, <CrmTeam />)} />
                  <Route path="conversas" element={<CrmConversas />} />
                  <Route path="mensagens-agendadas" element={<FeatureGate feature="crm_scheduled_messages"><CrmMensagensAgendadas /></FeatureGate>} />
                  <Route path="disparo" element={<FeatureGate feature="crm_broadcast"><CrmDisparo /></FeatureGate>} />
                  <Route path="relatorios" element={<CrmReports />} />
                  <Route path="relatorios/desempenho" element={<CrmReports />} />
                  <Route path="configuracoes" element={<Navigate to="/admin/configuracoes" replace />} />
                </Route>
                <Route path="adm" element={g(R.people, <Outlet />)}>
                  <Route index element={<AdmDashboard />} />
                  <Route path="diretorio" element={<AdmDiretorio />} />
                  <Route path="pendencias" element={<AdmPendencias />} />
                </Route>
                <Route path="agenda" element={g(R.agenda, <Agenda />)} />
                <Route path="financeiro" element={g(R.finance, <Outlet />)}>
                  <Route index element={<FinanceOverview />} />
                  <Route path="vendas" element={<FinanceSales />} />
                  <Route path="pagar" element={<FinancePayables />} />
                  <Route path="fluxo-caixa" element={<FinanceCashFlow />} />
                  <Route path="recorrencia" element={<FinanceRecurrence />} />
                  <Route path="dre" element={<FinanceDre />} />
                  <Route path="comissoes" element={<FinanceCommissions />} />
                  <Route path="conciliacao" element={<FinanceReconciliation />} />
                  <Route path="relatorios" element={<FinanceReports />} />
                  <Route path="cartoes" element={<FinanceCards />} />
                  <Route path="config" element={<FinanceSettings />} />
                </Route>
                <Route path="academy" element={g(R.academy, <AcademyAdmin />)} />
                <Route path="acompanhamento" element={g(R.care, <Care />)} />
                <Route path="parceiros" element={g(R.partners, <Partners />)} />
                <Route path="pesquisas" element={g(R.research, <Research />)} />
                <Route path="contas-corporativas" element={g(R.corporate, <CorporateAccounts />)} />
                <Route path="captacao-leads" element={g(R.leads, <LeadCapture />)} />
                <Route path="equipe" element={g(R.team, <Team />)} />
                <Route path="configuracoes" element={g(["manager", "ops_admin"], <SettingsHub />)} />
                <Route path="auditoria" element={g(["manager"], <Audit />)} />
              </Route>
              <Route path="/academy" element={g(R.portal, <AcademyHome />)} />
              <Route path="/academy/:slug" element={g(R.portal, <CourseView />)} />
              <Route path="/paciente" element={g(["member"], <Patient />)} />
              <Route path="/parceiro" element={g(["partner"], <Partner />)} />
              <Route path="/pesquisas" element={g(R.portal, <PortalResearch />)} />
              {/* Páginas do HP Pages: /:slug (slugs reservados são impedidos no editor e no banco). Manter APÓS as rotas fixas. */}
              <Route path="/:slug" element={<PublicPage />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
          </AskProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
