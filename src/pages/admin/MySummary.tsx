import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, CalendarClock, CalendarX2, ClipboardCheck, UserCheck, UserX, Users, Wallet } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { brl } from "@/lib/format";
import { PeriodFilter } from "@/lib/PeriodFilter";
import { EmptyState, KpiGrid, LevelSection, PageHead, State, StatCard, Table, Td } from "@/lib/ui";
import { presetRange, usePeriodFilterState } from "./finance/shared";
import { useSearchParams } from "react-router-dom";

interface Counts { scheduled: number; awaiting_record: number; attended: number; cancelled_by_patient: number; cancelled_by_clinic: number; rescheduled: number; patient_no_show: number; professional_no_show: number; patients_attended: number; total: number }
interface Payouts { visible: boolean; rules?: number; authorized_cents?: number; paid_cents?: number; available?: boolean; basis: string; entries?: { at: string; amount_cents: number; status: "authorized" | "paid" }[] }
interface Summary { professional_id: string; professional_name: string; is_self: boolean; from: string; to: string; counts: Counts; payouts: Payouts }
interface ProfOpt { id: string; display_name: string; is_self: boolean }

/** Resumo individual do profissional: os números saem do banco (my_professional_summary) e valem só para os atendimentos DELE. Agenda alheia só aparece para quem tem permissão
 *  (o servidor decide); repasses só para o próprio profissional e só os AUTORIZADOS/PAGOS com regra e dados reais — sem regra, o cartão diz que não há base. */
const MySummary = () => {
  const { preset, custom, onPreset, onFrom, onTo, onClear } = usePeriodFilterState();
  const { from, to } = preset === "personalizado" ? custom : presetRange(preset);
  const [sp, setSp] = useSearchParams(); const profParam = sp.get("profissional") ?? "";
  const profs = useQuery({ queryKey: ["ms-profs"], queryFn: async () => ((await supabase.rpc("my_agenda_professionals")).data ?? []) as ProfOpt[] });
  const own = profs.data?.find((p) => p.is_self);
  const effective = profParam || own?.id || profs.data?.[0]?.id || "";
  const q = useQuery({ queryKey: ["my-prof-summary", effective, from, to], enabled: !!effective, retry: false, queryFn: async () => {
    const { data, error } = await supabase.rpc("my_professional_summary", { p_from: from, p_to: to, p_professional: effective }); if (error) throw error; return data as Summary;
  } });
  const setProf = (v: string) => { const n = new URLSearchParams(sp); if (v) n.set("profissional", v); else n.delete("profissional"); setSp(n, { replace: true }); };
  const c = q.data?.counts; const per = `${new Date(from + "T12:00:00Z").toLocaleDateString("pt-BR")} – ${new Date(to + "T12:00:00Z").toLocaleDateString("pt-BR")}`;
  const pay = q.data?.payouts;

  return (
    <div>
      <PageHead eyebrow="Produtividade" title="Meu resumo" hint="Seus atendimentos no período, separados por situação. Realizado, cancelamento e falta são coisas diferentes: nada é somado como “melhora”."
        actions={<PeriodFilter preset={preset} from={custom.from} to={custom.to} onPreset={onPreset} onFrom={onFrom} onTo={onTo} onClear={onClear} />} />
      {profs.data && profs.data.length > 1 && (
        <div className="mb-4 max-w-xs"><label htmlFor="ms-prof" className="block text-xs mb-1">Profissional</label>
          <select id="ms-prof" value={effective} onChange={(e) => setProf(e.target.value)}>{profs.data.map((p) => <option key={p.id} value={p.id}>{p.display_name}{p.is_self ? " (eu)" : ""}</option>)}</select></div>)}
      <State loading={profs.isLoading || (!!effective && q.isLoading)} error={q.error && !String((q.error as { code?: string }).code).includes("P0002") ? q.error : undefined} />
      {profs.data && profs.data.length === 0 && <EmptyState icon={Users} title="Nenhum perfil profissional ligado à sua conta">O resumo individual existe para quem atende. Se você atende, peça ao gestor para ligar a sua conta ao seu cadastro de profissional (Operação ▸ Agenda ▸ Profissionais ▸ Liberar acesso).</EmptyState>}
      {c && (<>
        <p className="text-sm text-muted-foreground mb-3" aria-label="Quem e quando">{q.data!.professional_name} · {per}</p>
        <LevelSection level="summary" title="Atendimentos do período" hint="Contagem por situação do atendimento. “A registrar” = já passou do horário e ainda está agendado/confirmado (falta registrar comparecimento ou falta).">
          <KpiGrid>
            <StatCard icon={CalendarClock} label="Agendados (à frente)" value={c.scheduled} period={per} basis="agendados ou confirmados com horário futuro" />
            <StatCard icon={ClipboardCheck} label="A registrar" value={c.awaiting_record} period={per} tone={c.awaiting_record > 0 ? "warning" : undefined} basis="horário já passou e a presença ainda não foi registrada" />
            <StatCard icon={CalendarCheck} label="Realizados" value={c.attended} period={per} tone="success" basis="comparecimentos registrados" />
            <StatCard icon={Users} label="Pacientes atendidos" value={c.patients_attended} period={per} basis="pacientes diferentes com ao menos um atendimento realizado" />
            <StatCard icon={UserX} label="Faltas do paciente" value={c.patient_no_show} period={per} basis="o paciente não veio e não cancelou" />
            <StatCard icon={UserCheck} label="Faltas do profissional" value={c.professional_no_show} period={per} basis="o profissional não compareceu (não desconta sessão do paciente)" />
            <StatCard icon={CalendarX2} label="Cancelados pelo paciente" value={c.cancelled_by_patient} period={per} />
            <StatCard icon={CalendarX2} label="Cancelados pela clínica" value={c.cancelled_by_clinic} period={per} />
          </KpiGrid>
          <p className="text-xs text-muted-foreground mt-2">Remarcados: {c.rescheduled} · Total de atendimentos no período: {c.total}</p>
        </LevelSection>

        <LevelSection level="analysis" title="Repasses" hint="Só repasses AUTORIZADOS e PAGOS gerados pelas regras de comissão em seu nome.">
          {pay && !pay.visible && <p className="text-sm text-muted-foreground" role="note">{pay.basis}.</p>}
          {pay?.visible && !pay.available && <div className="hp-card p-4 flex gap-3 items-start" role="note"><Wallet aria-hidden className="mt-0.5 shrink-0 text-muted-foreground" size={18} /><p className="text-sm"><b>Indisponível.</b> {pay.basis}.</p></div>}
          {pay?.visible && pay.available && (<>
            <KpiGrid>
              <StatCard icon={Wallet} label="Repasses autorizados" value={brl(pay.authorized_cents ?? 0)} period={per} basis="autorizados e ainda não pagos" />
              <StatCard icon={Wallet} label="Repasses pagos" value={brl(pay.paid_cents ?? 0)} period={per} tone="success" basis="já pagos" />
            </KpiGrid>
            {pay.entries && pay.entries.length > 0 && <Table head={["Data", "Situação", "Valor"]} right={[2]}>{pay.entries.map((e, i) => <tr key={i}><Td>{new Date(e.at).toLocaleDateString("pt-BR")}</Td><Td>{e.status === "paid" ? "Pago" : "Autorizado"}</Td><Td num>{brl(e.amount_cents)}</Td></tr>)}</Table>}
            <p className="text-xs text-muted-foreground mt-2">{pay.basis}.</p>
          </>)}
        </LevelSection>
      </>)}
    </div>
  );
};
export default MySummary;
