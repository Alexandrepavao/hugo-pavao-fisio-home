import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CalendarCheck, CalendarClock, CalendarX2, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { State, Badge, KpiGrid, StatCard, LevelSection, type Tone } from "@/lib/ui";
import { PortalPage } from "./AppShell";

interface Alert { kind: "plano_acabando" | "sem_retorno" | "faltou" | "dor_subindo" | "adesao_baixa" | "duvida" | "chamado"; person_id: string; patient: string; detail: string }
interface Today { id: string; starts_at: string; ends_at: string; status: string; service: string; unit: string; person_id: string; patient: string }
export interface PhysioHomeData {
  professional: { id: string; name: string; council: string | null };
  today: Today[]; alerts: Alert[]; week: { scheduled: number; attended: number; no_show: number }; patients_active: number;
}
const ST: Record<string, [string, Tone]> = { scheduled: ["Agendado", "neutral"], confirmed: ["Confirmado", "info"], attended: ["Realizado", "success"], no_show: ["Faltou", "danger"], cancelled_by_patient: ["Cancelado", "warning"], cancelled_by_clinic: ["Cancelado", "warning"], professional_no_show: ["Ausência do profissional", "warning"] };
const KIND: Record<Alert["kind"], string> = { plano_acabando: "Plano perto do fim — pensar na reavaliação", sem_retorno: "Sem retorno marcado", faltou: "Faltou recentemente", dor_subindo: "Dor subindo", adesao_baixa: "Pouca adesão aos exercícios", duvida: "Dúvida do paciente", chamado: "Chamado clínico" };
const time = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

/** Início do fisioterapeuta: atendimentos de hoje, números da semana e alertas — só de pacientes com vínculo assistencial ativo (o servidor decide). */
const PhysioHome = () => {
  const q = useQuery({ queryKey: ["prof-home"], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("prof_home"); if (error) throw error; return data as PhysioHomeData; } });
  const d = q.data;
  const toDo = d?.today.filter((a) => ["scheduled", "confirmed"].includes(a.status)).length ?? 0;
  return (
    <PortalPage title={d ? `Olá, ${d.professional.name.split(" ")[0]}` : "Portal do fisioterapeuta"} subtitle="Seu dia, sua carteira de pacientes e o que precisa de atenção.">
      <State loading={q.isLoading} error={q.error} />
      {d && (<div className="grid gap-6" data-testid="physio-home">
        <KpiGrid>
          <StatCard label="Hoje" value={d.today.length} basis={`${toDo} ainda por atender`} icon={CalendarCheck} />
          <StatCard label="Pacientes ativos" value={d.patients_active} basis="com vínculo assistencial ativo" icon={Users} />
          <StatCard label="Agendados (próx. 7 dias)" value={d.week.scheduled} basis="consultas futuras" icon={CalendarClock} />
          <StatCard label="Faltas (últimos 7 dias)" value={d.week.no_show} basis={`${d.week.attended} atendimento(s) realizados na janela`} icon={CalendarX2} tone={d.week.no_show > 0 ? "warning" : undefined} />
        </KpiGrid>
        <LevelSection level="summary" title="Atendimentos de hoje">
          {d.today.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum atendimento hoje.</p> : (
            <ul className="grid gap-2">{d.today.map((a) => { const [label, tone] = ST[a.status] ?? [a.status, "neutral" as Tone];
              return <li key={a.id} className="hp-card flex flex-wrap items-center justify-between gap-2 p-3 text-sm"><span><b className="tabular">{time(a.starts_at)}</b> — {a.patient} <span className="text-muted-foreground">· {a.service} ({a.unit})</span></span><Badge tone={tone}>{label}</Badge></li>; })}</ul>)}
        </LevelSection>
        <LevelSection level="attention" title="Atenção" hint="Somente pacientes com vínculo ativo com você.">
          {d.alerts.length === 0 ? <p className="text-sm text-muted-foreground">Nada pendente agora.</p> : (
            <ul className="grid gap-2" data-testid="physio-alerts">{d.alerts.map((a, i) => <li key={a.kind + a.person_id + i} className="hp-card flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <span><b>{a.patient}</b> <span className="text-muted-foreground">· {KIND[a.kind]} — {a.detail}</span></span><Link className="text-accent text-sm" to={`/fisio/pacientes?pessoa=${a.person_id}`}>Abrir ficha</Link></li>)}</ul>)}
        </LevelSection>
      </div>)}
    </PortalPage>
  );
};
export default PhysioHome;
