import type { AppRole } from "@/auth/AuthProvider";

export const ROLE_LABEL: Record<AppRole, string> = {
  manager: "Gestor", ops_admin: "Administrador operacional", unit_manager: "Gestor de unidade",
  sales: "Comercial", finance: "Financeiro", physio: "Fisioterapeuta", teacher: "Professor/mentor",
  partner: "Parceiro", member: "Paciente/aluno",
};
