import { ClipboardList, LayoutDashboard, Table2, type LucideIcon } from "lucide-react";

export interface AdmNavItem { to: string; label: string; icon: LucideIcon; end?: boolean }
export interface AdmNavSection { label: string; items: AdmNavItem[] }

// ADM consolida a área de Gestão existente (Pessoas) numa planilha PF/PJ — não duplica Pessoas, substitui a
// necessidade de abri-la separadamente para o trabalho administrativo do dia a dia.
export const ADM_NAV: AdmNavSection[] = [
  { label: "Principal", items: [
    { to: "/admin/adm", label: "Dashboard", icon: LayoutDashboard, end: true },
    { to: "/admin/adm/pendencias", label: "Pendências", icon: ClipboardList },
  ] },
  { label: "Cadastro", items: [
    { to: "/admin/adm/diretorio", label: "Planilha administrativa", icon: Table2 },
  ] },
];
