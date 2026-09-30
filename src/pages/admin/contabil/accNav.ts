import { CalendarCheck, ClipboardList, FileCheck2, FileText, LayoutDashboard, ListChecks, PackageOpen, Settings, type LucideIcon } from "lucide-react";
import type { ContextualNavSection } from "@/components/hp/ContextualAppShell";

export const ACC_ROLES = ["manager", "ops_admin", "unit_manager", "finance", "accountant"] as const;
export type { LucideIcon };

// Cada item tem tela com funcionalidade real. O que NÃO existe (apuração de tributos, emissão fiscal, escrituração
// oficial, integração com sistema contábil) não tem menu e está listado em Configurações contábeis › Escopo.
export const ACC_NAV: ContextualNavSection[] = [
  { label: "Principal", items: [
    { to: "/admin/contabil", label: "Visão geral", icon: LayoutDashboard, end: true },
    { to: "/admin/contabil/competencias", label: "Competências", icon: CalendarCheck },
  ] },
  { label: "Rotina da competência", items: [
    { to: "/admin/contabil/lancamentos", label: "Lançamentos e classificações", icon: ClipboardList },
    { to: "/admin/contabil/documentos", label: "Documentos e comprovantes", icon: FileText },
    { to: "/admin/contabil/pendencias", label: "Pendências", icon: ListChecks },
  ] },
  { label: "Encerramento", items: [
    { to: "/admin/contabil/fechamentos", label: "Fechamentos", icon: FileCheck2 },
    { to: "/admin/contabil/exportacoes", label: "Exportações", icon: PackageOpen },
  ] },
  { label: "Sistema", items: [
    { to: "/admin/contabil/configuracoes", label: "Configurações contábeis", icon: Settings },
  ] },
];
