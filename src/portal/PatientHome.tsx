import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CalendarDays, ChevronRight, Dumbbell, LineChart, Package, Target } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fmtDateTime } from "@/lib/format";
import { State } from "@/lib/ui";
import { PortalPage } from "./AppShell";

export interface PatientHomeData {
  person: { id: string; name: string; birth_date: string | null };
  next_appointment: { id: string; starts_at: string; status: string; service: string; professional: string } | null;
  plan: { planned_sessions: number; attended: number; status: string; maintenance: boolean } | null;
  package_balance: number | null;
  pain: { first: number; last: number; count: number } | null;
  goal: { id: string; title: string; target_date: string | null } | null;
  last_decision: "continuidade" | "manutencao" | "alta" | null;
  renewal_open: boolean;
  videos_count: number;
  unread_msgs: number;
  training?: { today: { total: number; done: number } | null; streak: number; week_pct: number | null } | null;
  checkin_due?: boolean;
  offers?: { id: string; title: string; summary: string | null }[];
}

const Card = ({ to, icon: Icon, title, children, tone }: { to?: string; icon: typeof Target; title: string; children: React.ReactNode; tone?: "alert" }) => {
  const body = (
    <div className={`hp-card flex h-full flex-col gap-1 p-4 ${tone === "alert" ? "border-primary/60" : ""}`}>
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"><Icon size={14} aria-hidden />{title}{to && <ChevronRight size={14} aria-hidden className="ml-auto" />}</div>
      {children}
    </div>
  );
  return to ? <Link to={to} className="block focus-visible:outline-2">{body}</Link> : body;
};

/** Início do paciente: tudo vem de UMA chamada (my_home) — números derivados de registros reais; sem dado, o cartão diz que não há. */
const PatientHome = () => {
  const q = useQuery({ queryKey: ["my-home"], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("my_home"); if (error) throw error; return data as PatientHomeData; } });
  const d = q.data; const p = d?.plan;
  const pct = p ? Math.min(100, Math.round((100 * p.attended) / Math.max(1, p.planned_sessions))) : 0;
  const delta = d?.pain && d.pain.count > 1 ? d.pain.first - d.pain.last : null;
  return (
    <PortalPage title={d ? `Olá, ${d.person.name.split(" ")[0]}` : "Meu acompanhamento"} subtitle="Seu acompanhamento em um só lugar. Os números abaixo vêm dos registros do seu tratamento — a interpretação é do seu fisioterapeuta.">
      <State loading={q.isLoading} error={q.error} />
      {d && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="patient-home">
          <Card to="/paciente/agenda" icon={CalendarDays} title="Próxima consulta">
            {d.next_appointment ? <><p className="text-lg font-semibold">{fmtDateTime(d.next_appointment.starts_at)}</p><p className="text-sm text-muted-foreground">{d.next_appointment.service} com {d.next_appointment.professional}</p></>
              : <p className="text-sm text-muted-foreground">Nenhuma consulta marcada.</p>}
          </Card>
          <Card to="/paciente/evolucao" icon={Target} title="Meu plano">
            {p ? <><p className="text-lg font-semibold tabular">{p.attended} de {p.planned_sessions} sessões</p>
              <div className="h-2 overflow-hidden rounded bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={p.planned_sessions} aria-valuenow={Math.min(p.attended, p.planned_sessions)} aria-label="Sessões realizadas do plano"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
              <p className="text-xs text-muted-foreground">{p.status === "completed" ? "Plano encerrado (alta)." : p.maintenance ? "Plano de manutenção." : "A quantidade foi definida pelo seu fisioterapeuta."}</p></>
              : <p className="text-sm text-muted-foreground">Seu fisioterapeuta ainda não definiu o plano de sessões.</p>}
          </Card>
          <Card to="/paciente/evolucao" icon={LineChart} title="Minha dor">
            {d.pain ? <><p className="text-lg font-semibold tabular">{String(d.pain.first).replace(".", ",")} → {String(d.pain.last).replace(".", ",")}</p>
              <p className="text-xs text-muted-foreground">{delta == null ? "Primeiro registro." : delta > 0 ? `Queda de ${String(delta).replace(".", ",")} ponto(s) desde o início.` : delta < 0 ? `Aumento de ${String(-delta).replace(".", ",")} ponto(s) desde o início — conte ao seu fisioterapeuta.` : "Sem variação desde o início."} ({d.pain.count} registro{d.pain.count > 1 ? "s" : ""}, escala de 0 a 10)</p></>
              : <p className="text-sm text-muted-foreground">Sem registros de dor ainda. Registre como está hoje na aba Evolução.</p>}
          </Card>
          <Card to="/paciente/treinos" icon={Dumbbell} title="Treinos em casa">
            {d.training?.today ? <><p className="text-lg font-semibold tabular">{d.training.today.done} de {d.training.today.total} hoje</p><p className="text-xs text-muted-foreground">{d.training.streak > 0 ? `Sequência: ${d.training.streak} dia(s).` : "Comece pelo treino de hoje."}</p></>
              : <p className="text-sm text-muted-foreground">{d.videos_count > 0 ? `${d.videos_count} vídeo(s) liberado(s) para você.` : "Nenhum treino liberado no momento."}</p>}
          </Card>
          <Card to="/paciente/evolucao" icon={Target} title="Minha meta">
            {d.goal ? <><p className="text-base font-semibold">{d.goal.title}</p>{d.goal.target_date && <p className="text-xs text-muted-foreground">Meta para {new Date(d.goal.target_date + "T12:00:00Z").toLocaleDateString("pt-BR")}</p>}</>
              : <p className="text-sm text-muted-foreground">Seu fisioterapeuta ainda não registrou objetivos.</p>}
          </Card>
          <Card to="/paciente/mais" icon={Package} title="Saldo do pacote">
            <p className="text-lg font-semibold tabular">{d.package_balance ?? 0} sessão(ões)</p><p className="text-xs text-muted-foreground">Ainda disponíveis (separado do plano).</p>
          </Card>
          {d.checkin_due && <Card to="/paciente/evolucao" icon={LineChart} title="Check-in da semana" tone="alert"><p className="text-sm">Leva 20 segundos e ajuda seu fisioterapeuta a ajustar o tratamento.</p></Card>}
          {(d.last_decision === "continuidade" || d.last_decision === "manutencao") && !d.renewal_open && (
            <Card to="/paciente/evolucao" icon={Target} title="Próximo passo" tone="alert"><p className="text-sm">Seu fisioterapeuta indicou {d.last_decision === "manutencao" ? "a manutenção" : "a continuidade"} do acompanhamento. Veja como seguir.</p></Card>)}
          {d.offers?.map((o) => <Card key={o.id} to="/paciente/mais" icon={Target} title="Próximo passo para você" tone="alert"><p className="text-base font-semibold">{o.title}</p>{o.summary && <p className="text-sm text-muted-foreground">{o.summary}</p>}</Card>)}
        </div>
      )}
    </PortalPage>
  );
};
export default PatientHome;
