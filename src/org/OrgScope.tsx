import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { useOrg } from "./OrgProvider";
import { Neutral, ScopeEnter, ScopeNoAccess, ScopeNotFound } from "./ScopeParts";
import { useOrgBase } from "./useOrgBase";

const Login = lazy(() => import("@/pages/auth/Login"));
const FirstAccess = lazy(() => import("@/pages/auth/FirstAccess"));
const ResetPassword = lazy(() => import("@/pages/auth/ResetPassword"));
const Confirmar = lazy(() => import("@/pages/auth/Confirmar"));
const Avaliacao = lazy(() => import("@/pages/quiz/Avaliacao"));
const OnboardingPaciente = lazy(() => import("@/pages/onboarding/OnboardingPaciente"));
const PublicPage = lazy(() => import("@/pages/PublicPage"));

/** Raiz do endereço da organização: logado com vínculo → painel; sem vínculo → tela própria; sem login → login da organização. */
const ScopeHome = () => {
  const { session } = useAuth(); const org = useOrg(); const ob = useOrgBase();
  if (session) return <ScopeEnter to="/admin" />;
  return <Navigate to={ob.to("/login")} replace />;
};

/** Rotas públicas e de acesso de UMA organização (`/empresa/<slug>/…`). A organização é resolvida no servidor ANTES de mostrar qualquer coisa (sem marca HP provisória); o slug nunca autoriza nada. */
const OrgScope = () => {
  const org = useOrg(); const { session } = useAuth();
  if (org.scope.status === "loading") return <Neutral />;
  if (org.scope.status === "notfound") return <ScopeNotFound />;
  const guarded = (el: JSX.Element) => (session && org.scope.access === "none" ? <ScopeNoAccess /> : el);
  return (
    <Suspense fallback={<Neutral />}>
      <Routes>
        <Route index element={<ScopeHome />} />
        <Route path="login" element={guarded(<Login />)} />
        <Route path="primeiro-acesso" element={guarded(<FirstAccess />)} />
        <Route path="redefinir-senha" element={<ResetPassword />} />
        <Route path="confirmar" element={<Confirmar />} />
        <Route path="app" element={<Navigate to="/app" replace />} />
        <Route path="avaliacao" element={org.scope.capture ? <Avaliacao /> : <ScopeNotFound />} />
        <Route path="onboarding-paciente" element={org.scope.capture ? <OnboardingPaciente /> : <ScopeNotFound />} />
        <Route path=":pageSlug" element={<PublicPage />} />
        <Route path="*" element={<ScopeNotFound />} />
      </Routes>
    </Suspense>
  );
};

export default OrgScope;
