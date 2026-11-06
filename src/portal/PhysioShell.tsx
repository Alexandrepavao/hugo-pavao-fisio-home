import { CalendarDays, CalendarCheck, Home, LifeBuoy, TrendingUp, Users } from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import AppShell, { type ShellItem, type ShellLink } from "./AppShell";

const ITEMS: ShellItem[] = [
  { to: "/fisio", label: "Início", icon: Home, end: true },
  { to: "/fisio/pacientes", label: "Pacientes", icon: Users },
  { to: "/fisio/agenda", label: "Agenda", icon: CalendarDays },
  { to: "/fisio/dia", label: "Meu dia", icon: CalendarCheck },
  { to: "/fisio/desempenho", label: "Desempenho", icon: TrendingUp },
  { to: "/fisio/chamados", label: "Chamados", icon: LifeBuoy, mobile: false },
];

/** Portal do fisioterapeuta: carteira de pacientes (só os com vínculo), agenda, desempenho e repasses. */
const PhysioShell = () => {
  const { hasRole } = useAuth();
  const links: ShellLink[] = [{ to: "/admin", label: "Painel completo (gestão)" }];
  if (hasRole("member")) links.push({ to: "/paciente", label: "Meu acompanhamento (como paciente)" });
  return <AppShell brand="Portal do fisioterapeuta" items={ITEMS} links={links} />;
};
export default PhysioShell;
