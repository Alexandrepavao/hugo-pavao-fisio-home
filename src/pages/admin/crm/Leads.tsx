import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { fmtDateTime } from "@/lib/format";
import { Badge, PageHead, State, Table, Td, errText, useMsg, Msg } from "@/lib/ui";
import { PeriodFilter } from "@/lib/PeriodFilter";
import { usePeriodFilterState, useUnits, presetRange, toExclusive } from "../finance/shared";
import OpportunitySheet from "./OpportunitySheet";
import { isStale, type Opp, type Stage, type StaffUser } from "./types";

/** Gestão de leads: a fila de qualificação/distribuição — oportunidades ainda na PRIMEIRA etapa do funil
 *  (quem ainda não avançou na negociação), foto de agora. Diferente do Pipeline (onde cada negócio está no
 *  funil inteiro, incluindo os que já avançaram) — os dois usam o mesmo registro (opportunities), só a lente
 *  muda. "Novos leads no período" do Dashboard é outra coisa ainda: fluxo de criação, não esta fila. */
const Leads = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg();
  const { preset, custom, unit, onPreset, onFrom, onTo, onUnit, onClear } = usePeriodFilterState();
  const { from, to } = preset === "personalizado" ? custom : presetRange(preset);
  const range = { from: `${from}T00:00:00.000Z`, to: toExclusive(to) };
  const units = useUnits();
  const [openId, setOpenId] = useState<string | null>(null);

  const users = useQuery({ queryKey: ["assignable"], queryFn: async () => ((await supabase.rpc("list_assignable_users", {})).data ?? []) as StaffUser[] });
  const stages = useQuery({ queryKey: ["stages-all"], queryFn: async () => (await supabase.from("pipeline_stages").select("*").order("position")).data as Stage[] });

  const leads = useQuery({ queryKey: ["crm-leads-queue", unit, range.from, range.to], enabled: !!stages.data, queryFn: async () => {
    // primeira etapa de cada funil = menor "position"; a fila é quem está aberta ali, criada dentro do período.
    const firstStageByPipe = new Map<string, string>();
    for (const s of stages.data ?? []) { const cur = firstStageByPipe.get(s.pipeline_id); if (!cur) firstStageByPipe.set(s.pipeline_id, s.id); }
    const firstStages = [...new Set(firstStageByPipe.values())];
    let q = supabase.from("opportunities").select("id, title, value_cents, status, stage_id, owner_user_id, unit_id, person_id, next_contact_at, last_contact_at, created_at, source, campaign, person:people(id, full_name)")
      .in("stage_id", firstStages).eq("status", "open").gte("created_at", range.from).lt("created_at", range.to).order("created_at", { ascending: false }).limit(200);
    if (unit) q = q.eq("unit_id", unit);
    const { data, error } = await q; if (error) throw error; return data as unknown as Opp[];
  } });
  const opened = leads.data?.find((o) => o.id === openId) ?? null;

  const assign = async (opp: Opp, ownerId: string) => {
    const { error } = await supabase.from("opportunities").update({ owner_user_id: ownerId || null }).eq("id", opp.id);
    if (error) return m.err(errText(error));
    m.ok("Responsável atualizado."); void qc.invalidateQueries({ queryKey: ["crm-leads-queue"] });
  };

  return (
    <div>
      <PageHead eyebrow="CRM" title="Gestão de leads" hint="Fila de leads ainda na primeira etapa (sem qualificação/distribuição concluída). Para negociações já em andamento, veja o Pipeline."
        actions={<PeriodFilter preset={preset} from={custom.from} to={custom.to} unit={unit} units={units.data} onPreset={onPreset} onFrom={onFrom} onTo={onTo} onUnit={onUnit} onClear={onClear} />} />
      <Msg m={msg} />
      <State loading={leads.isLoading} error={leads.error} empty={leads.data?.length === 0} emptyText="Nenhum lead na fila para este recorte." />
      {leads.data && leads.data.length > 0 && (
        <Table head={["Pessoa", "Título", "Origem", "Criado em", "Responsável", ""]}>
          {leads.data.map((o) => (
            <tr key={o.id}>
              <Td><button className="font-medium text-left hover:underline" onClick={() => setOpenId(o.id)}>{o.person?.full_name}</button>{isStale(o) && <span className="ml-2"><Badge tone="danger">Sem retorno</Badge></span>}</Td>
              <Td>{o.title}</Td>
              <Td>{o.source ?? "—"}</Td>
              <Td>{fmtDateTime(o.created_at)}</Td>
              <Td><select value={o.owner_user_id ?? ""} onChange={(e) => assign(o, e.target.value)} aria-label={`Responsável de ${o.person?.full_name}`}><option value="">Sem responsável</option>{(users.data ?? []).map((u) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}</select></Td>
              <Td><button className="hp-btn hp-btn-outline hp-btn-sm" onClick={() => setOpenId(o.id)}>Abrir</button></Td>
            </tr>
          ))}
        </Table>
      )}
      <OpportunitySheet opp={opened} stages={stages.data ?? []} users={users.data ?? []} onClose={() => setOpenId(null)} onChanged={() => qc.invalidateQueries({ queryKey: ["crm-leads-queue"] })} />
    </div>
  );
};

export default Leads;
