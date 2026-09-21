import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import TrabalheConosco from "./pages/TrabalheConosco";
import NotFound from "./pages/NotFound";
import { AuthProvider, STAFF_ROLES } from "./auth/AuthProvider";
import RequireAuth from "./auth/RequireAuth";
const Login = lazy(() => import("./pages/auth/Login"));
const ResetPassword = lazy(() => import("./pages/auth/ResetPassword"));
const AdminLayout = lazy(() => import("./pages/admin/AdminLayout"));
const Overview = lazy(() => import("./pages/admin/Overview"));
const People = lazy(() => import("./pages/admin/People"));
const Audit = lazy(() => import("./pages/admin/Audit"));

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-navy-400" role="status">Carregando…</div>}>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/trabalhe-conosco" element={<TrabalheConosco />} />
            <Route path="/login" element={<Login />} />
            <Route path="/redefinir-senha" element={<ResetPassword />} />
            <Route path="/admin" element={<RequireAuth roles={STAFF_ROLES}><AdminLayout /></RequireAuth>}>
              <Route index element={<Overview />} />
              <Route path="pessoas" element={<RequireAuth roles={["manager", "ops_admin", "unit_manager", "sales"]}><People /></RequireAuth>} />
              <Route path="auditoria" element={<RequireAuth roles={["manager"]}><Audit /></RequireAuth>} />
            </Route>
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
