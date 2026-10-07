import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { fmtDateTime } from "@/lib/format";
import { Badge, PageHead, State, Table, Td, errText, useMsg, Msg } from "@/lib/ui";
import { PeriodFilter } from "@/lib/PeriodFilter";
import { usePeriodFilterState, useUnits, presetRange, toExclusive } from "../finance/shared";
import OpportunitySheet from "./OpportunitySheet";
import LeadTypeBadge from "./LeadTypeBadge";
import { LEAD_KINDS, LEAD_TYPE } from "./leadTypes";
import CrmImportDialog from "./CrmImportDialog";
import { cardName, isStale, type Opp, type PipelineInfo, type Stage, type StaffUser } from "./types";

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
  const [openId, setOpenId] = useState<string | null>(null); const [importOpen, setImportOpen] = useState(false); const [kindFilter, setKindFilter] = useState("");

  const users = useQuery({ queryKey: ["assignable"], queryFn: async () => ((await supabase.rpc("list_assignable_users", {})).data ?? []) as StaffUser[] });
  const pipes = useQuery({ queryKey: ["pipelines-info"], queryFn: async () => ((await supabase.from("pipelines").select("id, name, kind").eq("active", true)).data ?? []) as PipelineInfo[] });
  const stages = useQuery({ queryKey: ["stages-all"], queryFn: async () => (await supabase.from("pipeline_stages").select("*").order("position")).data as Stage[] });

  const leads = useQuery({ queryKey: ["crm-leads-queue", unit, range.from, range.to], enabled: !!stages.data, queryFn: async () => {
    // primeira etapa de cada funil = menor "position"; a fila é quem está aberta ali, criada dentro do período.
    const firstStageByPipe = new Map<string, string>();
    for (const s of stages.data ?? []) { const cur = firstStageByPipe.get(s.pipeline_id); if (!cur) firstStageByPipe.set(s.pipeline_id, s.id); }
    const firstStages = [...new Set(firstStageByPipe.values())];
    let q = supabase.from("opportunities").select("id, title, value_cents, status, stage_id, owner_user_id, unit_id, person_id, pipeline_id, legal_entity_id, next_contact_at, last_contact_at, created_at, source, campaign, person:people(id, full_name), legal_entity:legal_entities(id, legal_name, trade_name)")
      .in("stage_id", firstStages).eq("status", "open").gte("created_at", range.from).lt("created_at", range.to).order("created_at", { ascending: false }).limit(200);
    if (unit) q = q.eq("unit_id", unit);
    const { data, error } = await q; if (error) throw error; return data as unknown as Opp[];
  } });
  const kindOf = (o: Opp) => pipes.data?.find((p) => p.id === o.pipeline_id)?.kind;
  const shown = (leads.data ?? []).filter((o) => !kindFilter || kindOf(o) === kindFilter);
  const opened = leads.data?.find((o) => o.id === openId) ?? null;

  const assign = async (opp: Opp, ownerId: string) => {
    const { error } = await supabase.from("opportunities").update({ owner_user_id: ownerId || null }).eq("id", opp.id);
    if (error) return m.err(errText(error));
    m.ok("Responsável atualizado."); void qc.invalidateQueries({ queryKey: ["crm-leads-queue"] });
  };

  return (
    <div>
      <PageHead eyebrow="CRM" title="Gestão de leads" hint="Fila de leads ainda na primeira etapa (sem qualificação/distribuição concluída). Para negociações já em andamento, veja o Pipeline."
        actions={<div className="flex flex-wrap items-center justify-end gap-2"><button type="button" className="hp-btn hp-btn-outline" onClick={() => setImportOpen(true)}>Importar CSV</button><PeriodFilter preset={preset} from={custom.from} to={custom.to} unit={unit} units={units.data} onPreset={onPreset} onFrom={onFrom} onTo={onTo} onUnit={onUnit} onClear={onClear} /></div>} />
      <Msg m={msg} />
      <CrmImportDialog open={importOpen} onOpenChange={setImportOpen} onDone={() => { void qc.invalidateQueries({ queryKey: ["crm-leads-queue"] }); void qc.invalidateQueries({ queryKey: ["crm-lists"] }); void qc.invalidateQueries({ queryKey: ["opps"] }); void qc.invalidateQueries({ queryKey: ["people"] }); }} />
      <div role="group" aria-label="Filtrar por tipo de lead" className="flex flex-wrap gap-2 mb-4" data-testid="leads-tipos">
        {([["", "Todos", leads.data?.length ?? 0], ...LEAD_KINDS.map((k) => [k, LEAD_TYPE[k].label, (leads.data ?? []).filter((o) => kindOf(o) === k).length] as const)] as const).map(([k, label, n]) => (
          <button key={k} type="button" aria-pressed={kindFilter === k} onClick={() => setKindFilter(k)} className={`rounded-full border px-3 py-1 text-[13px] ${kindFilter === k ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card hover:border-primary/50"}`}>{label} <span className="opacity-70 tabular">{n}</span></button>))}
      </div>
      <State loading={leads.isLoading} error={leads.error} empty={shown.length === 0 && !leads.isLoading} emptyText="Nenhum lead na fila para este recorte." />
      {shown.length > 0 && (
        <Table head={["Lead", "Tipo", "Título", "Origem", "Criado em", "Responsável", ""]}>
          {shown.map((o) => (
            <tr key={o.id}>
              <Td><button className="font-medium text-left hover:underline" onClick={() => setOpenId(o.id)}>{cardName(o)}</button>{o.legal_entity && <span className="block text-xs text-muted-foreground">Contato: {o.person?.full_name}</span>}{isStale(o) && <span className="ml-2"><Badge tone="danger">Sem retorno</Badge></span>}</Td>
              <Td><LeadTypeBadge kind={kindOf(o)} short /></Td>
              <Td>{o.title}</Td>
              <Td>{o.source ?? "—"}</Td>
              <Td>{fmtDateTime(o.created_at)}</Td>
              <Td><select value={o.owner_user_id ?? ""} onChange={(e) => assign(o, e.target.value)} aria-label={`Responsável de ${cardName(o)}`}><option value="">Sem responsável</option>{(users.data ?? []).map((u) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}</select></Td>
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
