import { CalendarDays, Dumbbell, Home, LineChart, MoreHorizontal } from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import AppShell, { type ShellItem, type ShellLink } from "./AppShell";

const ITEMS: ShellItem[] = [
  { to: "/paciente", label: "Início", icon: Home, end: true },
  { to: "/paciente/evolucao", label: "Evolução", icon: LineChart },
  { to: "/paciente/treinos", label: "Treinos", icon: Dumbbell },
  { to: "/paciente/agenda", label: "Agenda", icon: CalendarDays },
  { to: "/paciente/mais", label: "Mais", icon: MoreHorizontal },
];

/** Portal do paciente (e de quem age em nome dele, quando houver vínculo verificado). */
const PatientShell = () => {
  const { hasRole } = useAuth();
  const links: ShellLink[] = [{ to: "/academy", label: "Academy" }];
  if (hasRole("physio")) links.unshift({ to: "/fisio", label: "Portal do fisioterapeuta" });
  if (hasRole("manager", "ops_admin", "unit_manager", "sales", "finance", "teacher")) links.unshift({ to: "/admin", label: "Painel de gestão" });
  return <AppShell brand="Meu acompanhamento" items={ITEMS} links={links} />;
};
export default PatientShell;
