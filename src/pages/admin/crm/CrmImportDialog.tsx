import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { download, toCsv } from "@/lib/format";
import { Badge, errText } from "@/lib/ui";
import { CRM_FIELDS, TEMPLATE_CSV, autoMap, buildRows, readCsv, type CrmFieldKey, type CrmMapping, type ParsedCsv } from "@/lib/crmImport";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LEAD_TYPE, isLeadKind, pipeLabel } from "./leadTypes";

interface Cand { id: string | null; name: string | null; reason: string; visible: boolean }
interface Diff { field: "name" | "phone" | "email"; existing: string | null; incoming: string }
interface CheckRow { idx: number; status: "new" | "existing" | "duplicate" | "conflict" | "invalid"; errors: string[]; kind?: string; diffs?: Diff[]; candidates?: Cand[]; person_id?: string | null; existing_name?: string | null; name: string }
interface Decision { action: "skip" | "use_existing" | "update_existing" | "create_new"; person_id?: string; fields?: string[] }
interface Result { idx: number; status: "created" | "linked" | "updated" | "duplicate" | "skipped" | "pending" | "invalid" | "error"; message?: string | null }
interface Summary { created: number; linked: number; updated: number; duplicate: number; skipped: number; pending: number; invalid: number; error: number }

const STATUS_LABEL: Record<CheckRow["status"], string> = { new: "Nova pessoa", existing: "Pessoa existente", duplicate: "Já importada", conflict: "Conflito", invalid: "Inválida" };
const KIND_LABEL: Record<string, string> = { dados_divergentes: "Mesma pessoa (mesmo contato), com dados diferentes", homonimo_possivel: "Possível homônimo: nome igual ou parecido, contato diferente", varias_pessoas: "O contato bate com mais de uma pessoa", cadastro_em_outra_unidade: "Já existe um cadastro que você não pode ver (outra unidade)" };
const RESULT_LABEL: Record<Result["status"], string> = { created: "Criada", linked: "Vinculada ao cadastro existente", updated: "Dados atualizados e oportunidade criada", duplicate: "Já existia (nada criado)", skipped: "Pulada por decisão", pending: "Pendente (sem decisão)", invalid: "Inválida", error: "Erro" };
const FIELD_PT: Record<string, string> = { name: "nome", phone: "telefone", email: "e-mail" };
const COMMERCIAL = ["manager", "ops_admin", "unit_manager", "sales"];

/** Importação de leads/oportunidades do CRM em 4 passos: arquivo e padrões → mapeamento de colunas → prévia com validação e decisão de conflitos → relatório.
 *  Nada é gravado antes de “Importar”; o servidor revalida e deduplica (reimportar o mesmo arquivo não duplica) e NUNCA altera um cadastro existente sem decisão explícita. */
const CrmImportDialog = ({ open, onOpenChange, onDone, presetListId }: { open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void; presetListId?: string }) => {
  const [step, setStep] = useState<"arquivo" | "mapa" | "previa" | "resultado">("arquivo");
  const [fileName, setFileName] = useState(""); const [data, setData] = useState<ParsedCsv | null>(null); const [map, setMap] = useState<CrmMapping>({});
  const [def, setDef] = useState({ unit: "", pipeline: "", stage: "", owner: "", list: "", source: "", campaign: "" });
  const [checks, setChecks] = useState<CheckRow[]>([]); const [dec, setDec] = useState<Record<number, Decision>>({});
  const [result, setResult] = useState<{ results: Result[]; summary: Summary } | null>(null);
  const [fatal, setFatal] = useState<string | null>(null); const [busy, setBusy] = useState(false);

  const units = useQuery({ queryKey: ["crmi-units"], enabled: open, queryFn: async () => ((await supabase.from("units").select("id, name").eq("active", true).order("name")).data ?? []) as { id: string; name: string }[] });
  const pipes = useQuery({ queryKey: ["crmi-pipes"], enabled: open, queryFn: async () => ((await supabase.from("pipelines").select("id, name, kind").eq("active", true).order("name")).data ?? []) as { id: string; name: string; kind: string }[] });
  const lists = useQuery({ queryKey: ["crmi-lists"], enabled: open, queryFn: async () => ((await supabase.from("crm_lead_lists").select("id, name, kind").order("name")).data ?? []) as { id: string; name: string; kind: string | null }[] });
  // a lista com tipo decide o funil (paciente → funil de pacientes etc.): importar uma lista de fisioterapeutas num funil de pacientes não é possível
  const peopleLists = (lists.data ?? []).filter((l) => l.kind !== "companies");
  const selList = peopleLists.find((l) => l.id === def.list);
  const forcedPipe = selList?.kind ? pipes.data?.find((p) => p.kind === selList.kind) : undefined;
  const pipelineId = forcedPipe?.id ?? def.pipeline;
  useEffect(() => { if (open && presetListId) setDef((d) => (d.list === presetListId ? d : { ...d, list: presetListId })); }, [open, presetListId]);
  const stages = useQuery({ queryKey: ["crmi-stages", pipelineId], enabled: open && !!pipelineId, queryFn: async () => ((await supabase.from("pipeline_stages").select("id, name, position").eq("pipeline_id", pipelineId).eq("kind", "open").order("position")).data ?? []) as { id: string; name: string }[] });
  const users = useQuery({ queryKey: ["crmi-users", def.unit], enabled: open, queryFn: async () => ((await supabase.rpc("list_assignable_users", { p_unit: def.unit || null })).data ?? []) as { user_id: string; name: string; roles: string[] }[] });
    const owners = (users.data ?? []).filter((u) => u.roles.some((r) => COMMERCIAL.includes(r)));

  const reset = () => { setStep("arquivo"); setFileName(""); setData(null); setMap({}); setChecks([]); setDec({}); setResult(null); setFatal(null); setBusy(false); };
  const defaults = () => ({ unit_id: def.unit || null, pipeline_id: pipelineId || null, stage_id: def.stage || null, owner_user_id: def.owner || null, list_id: def.list || null, source: def.source.trim() || null, campaign: def.campaign.trim() || null });

  const onFile = async (f: File | undefined) => {
    setFatal(null); setData(null); if (!f) return; setFileName(f.name);
    if (f.size > 1_000_000) return setFatal("Arquivo muito grande (limite de 1 MB).");
    const r = readCsv(await f.text()); if (r.fatal || !r.data) return setFatal(r.fatal ?? "Não foi possível ler o arquivo.");
    setData(r.data); setMap(autoMap(r.data.headers));
  };
  const goMap = () => {
    if (!data) return setFatal("Escolha o arquivo .csv.");
    if (!def.unit) return setFatal("Escolha a unidade padrão do lote.");
    if (!pipelineId) return setFatal("Escolha o funil.");
    setFatal(null); setStep("mapa");
  };
  const mapOk = map.name !== undefined && (map.email !== undefined || map.phone !== undefined);
  const rows = useMemo(() => (data ? buildRows(data, map) : []), [data, map]);

  const preview = async () => {
    setBusy(true); setFatal(null);
    const { data: out, error } = await supabase.rpc("crm_import_check", { p_defaults: defaults(), p_rows: rows });
    setBusy(false); if (error) return setFatal(errText(error));
    setChecks(out as CheckRow[]); setDec({}); setStep("previa");
  };
  const commit = async () => {
    setBusy(true); setFatal(null);
    const { data: out, error } = await supabase.rpc("crm_import_commit", { p_defaults: defaults(), p_rows: rows, p_decisions: dec, p_filename: fileName || null });
    setBusy(false); if (error) return setFatal(errText(error));
    setResult(out as { results: Result[]; summary: Summary }); setStep("resultado"); onDone();
  };

  const count = (s: CheckRow["status"]) => checks.filter((c) => c.status === s).length;
  const decided = checks.filter((c) => c.status === "conflict" && dec[c.idx]);
  const toImport = checks.filter((c) => c.status === "new" || c.status === "existing" || c.status === "duplicate").length + decided.filter((c) => dec[c.idx].action !== "skip").length;
  const setDecision = (idx: number, d: Decision | null) => setDec((cur) => { const n = { ...cur }; if (d) n[idx] = d; else delete n[idx]; return n; });

  const report = () => {
    const out = checks.map((c) => {
      const r = result?.results.find((x) => x.idx === c.idx);
      return { linha_do_arquivo: data?.lines[c.idx] ?? "", nome: c.name, situacao_na_previa: STATUS_LABEL[c.status], resultado: r ? RESULT_LABEL[r.status] : "", detalhe: [...(c.errors ?? []), r?.message ?? "", c.kind ? KIND_LABEL[c.kind] ?? c.kind : ""].filter(Boolean).join(" | ") };
    });
    download(`relatorio-importacao-crm-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(out.length ? out : [{ linha_do_arquivo: "", nome: "", situacao_na_previa: "", resultado: "sem linhas", detalhe: "" }]));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="sm:max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Importar leads e oportunidades (CSV)</DialogTitle>
          <DialogDescription>Passo {step === "arquivo" ? 1 : step === "mapa" ? 2 : step === "previa" ? 3 : 4} de 4 · Nada é gravado antes de “Importar”. Pessoas já cadastradas são reconhecidas pelo e-mail/telefone, <b>nenhum dado existente é alterado sem a sua decisão</b> e reimportar o mesmo arquivo não duplica pessoas nem oportunidades.</DialogDescription></DialogHeader>
        {fatal && <p role="alert" className="text-sm text-destructive">{fatal}</p>}

        {step === "arquivo" && (
          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label htmlFor="crmi-file" className="block text-xs mb-1">Arquivo .csv (até 500 linhas, 1 MB; separador vírgula ou ponto e vírgula)</label><input id="crmi-file" type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} />
                {data && <p className="text-xs text-muted-foreground mt-1">{fileName}: {data.cells.length} linha(s), {data.headers.length} coluna(s).</p>}</div>
              <div className="flex items-end"><button type="button" className="hp-btn hp-btn-outline" onClick={() => download("modelo-importacao-crm.csv", TEMPLATE_CSV)}>Baixar modelo (CSV)</button></div>
            </div>
            <fieldset className="grid gap-3 sm:grid-cols-3 rounded-lg border border-border p-3"><legend className="px-1 text-xs font-semibold">Padrões do lote (a coluna da linha, quando preenchida, vale mais)</legend>
              <div><label htmlFor="crmi-unit" className="block text-xs mb-1">Unidade *</label><select id="crmi-unit" value={def.unit} onChange={(e) => setDef({ ...def, unit: e.target.value, owner: "" })}><option value="">Selecione…</option>{units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
              <div><label htmlFor="crmi-pipe" className="block text-xs mb-1">Funil *</label><select id="crmi-pipe" value={pipelineId} disabled={!!forcedPipe} onChange={(e) => setDef({ ...def, pipeline: e.target.value, stage: "" })}><option value="">Selecione…</option>{pipes.data?.map((p) => <option key={p.id} value={p.id}>{pipeLabel(p)}</option>)}</select>{forcedPipe && <p className="text-[11px] text-muted-foreground mt-1">O funil segue o tipo da lista ({isLeadKind(selList?.kind) ? LEAD_TYPE[selList.kind].label : ""}).</p>}</div>
              <div><label htmlFor="crmi-stage" className="block text-xs mb-1">Etapa inicial</label><select id="crmi-stage" value={def.stage} onChange={(e) => setDef({ ...def, stage: e.target.value })} disabled={!pipelineId}><option value="">Primeira etapa do funil</option>{stages.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div><label htmlFor="crmi-owner" className="block text-xs mb-1">Responsável</label><select id="crmi-owner" value={def.owner} onChange={(e) => setDef({ ...def, owner: e.target.value })}><option value="">Distribuição automática</option>{owners.map((u) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}</select></div>
              <div><label htmlFor="crmi-list" className="block text-xs mb-1">Lista</label><select id="crmi-list" value={def.list} onChange={(e) => setDef({ ...def, list: e.target.value, stage: "" })}><option value="">Nenhuma</option>{peopleLists.map((l) => <option key={l.id} value={l.id}>{l.name}{isLeadKind(l.kind) ? ` — ${LEAD_TYPE[l.kind].label}` : " — sem tipo"}</option>)}</select></div>
              <div><label htmlFor="crmi-source" className="block text-xs mb-1">Origem</label><input id="crmi-source" value={def.source} onChange={(e) => setDef({ ...def, source: e.target.value })} placeholder="Importação CSV" /></div>
              <div className="sm:col-span-3"><label htmlFor="crmi-campaign" className="block text-xs mb-1">Campanha</label><input id="crmi-campaign" value={def.campaign} onChange={(e) => setDef({ ...def, campaign: e.target.value })} placeholder="Ex.: Feira de saúde 2026" /></div>
            </fieldset>
          </div>)}

        {step === "mapa" && data && (
          <div className="grid gap-3">
            <p className="text-sm">Diga qual coluna do arquivo vale para cada campo. O sistema já sugeriu pelo nome do cabeçalho; confira. <b>Nome</b> e (<b>e-mail</b> ou <b>telefone</b>) são obrigatórios.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {CRM_FIELDS.map((f) => (
                <div key={f.key}><label htmlFor={`crmi-map-${f.key}`} className="block text-xs mb-1">{f.label}{"required" in f && f.required ? " *" : ""}</label>
                  <select id={`crmi-map-${f.key}`} value={map[f.key] === undefined ? "" : String(map[f.key])} onChange={(e) => setMap((m) => { const n = { ...m }; if (e.target.value === "") delete n[f.key as CrmFieldKey]; else n[f.key as CrmFieldKey] = Number(e.target.value); return n; })}>
                    <option value="">— não importar —</option>{data.headers.map((h, i) => <option key={i} value={i}>{h || `(coluna ${i + 1} sem título)`}</option>)}</select></div>))}
            </div>
            <div className="hp-card overflow-auto max-h-40"><table className="w-full text-xs"><thead><tr className="text-left bg-muted/60">{data.headers.map((h, i) => <th key={i} className="px-2 py-1">{h}</th>)}</tr></thead>
              <tbody>{data.cells.slice(0, 3).map((r, i) => <tr key={i} className="border-t border-border">{data.headers.map((_, j) => <td key={j} className="px-2 py-1">{r[j]}</td>)}</tr>)}</tbody></table></div>
            {!mapOk && <p role="alert" className="text-sm text-destructive">Mapeie o nome e ao menos e-mail ou telefone.</p>}
          </div>)}

        {step === "previa" && (
          <div className="grid gap-3">
            <p className="text-sm flex flex-wrap gap-2 items-center" aria-label="Resumo da prévia"><Badge tone="success">{count("new")} novas</Badge><Badge tone="info">{count("existing")} já cadastradas (nova oportunidade)</Badge><Badge tone="neutral">{count("duplicate")} já importadas</Badge><Badge tone="warning">{count("conflict")} conflitos</Badge><Badge tone="danger">{count("invalid")} inválidas</Badge></p>
            <div className="hp-card overflow-auto max-h-[46vh]"><table className="w-full text-sm"><thead><tr className="text-left text-xs bg-muted/60"><th className="px-3 py-2">Linha</th><th className="px-3 py-2">Nome</th><th className="px-3 py-2">Situação</th><th className="px-3 py-2">Detalhe / decisão</th></tr></thead>
              <tbody>{checks.map((c) => (
                <tr key={c.idx} className="border-t border-border align-top" data-status={c.status}>
                  <td className="px-3 py-1.5">{data?.lines[c.idx]}</td><td className="px-3 py-1.5">{c.name}</td>
                  <td className="px-3 py-1.5"><Badge tone={c.status === "new" ? "success" : c.status === "invalid" ? "danger" : c.status === "conflict" ? "warning" : c.status === "existing" ? "info" : "neutral"}>{STATUS_LABEL[c.status]}</Badge></td>
                  <td className="px-3 py-1.5 text-sm">
                    {c.status === "invalid" && <ul className="text-destructive">{c.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
                    {c.status === "existing" && <span className="text-muted-foreground">Reaproveita o cadastro de {c.existing_name}; cria a oportunidade.</span>}
                    {c.status === "duplicate" && <span className="text-muted-foreground">{c.existing_name} já tem oportunidade aberta neste funil: nada será criado.</span>}
                    {c.status === "conflict" && (
                      <div className="grid gap-2">
                        <p className="font-medium">{KIND_LABEL[c.kind ?? ""] ?? "Conflito"}</p>
                        {c.diffs && c.diffs.length > 0 && <ul className="text-xs">{c.diffs.map((d) => <li key={d.field}><b>{FIELD_PT[d.field]}</b>: cadastro “{d.existing ?? "—"}” × arquivo “{d.incoming}”</li>)}</ul>}
                        {c.candidates && c.candidates.length > 0 && <ul className="text-xs">{c.candidates.map((x, i) => <li key={i}>Candidato: {x.visible ? x.name : "cadastro que você não pode ver"} <span className="text-muted-foreground">({x.reason.replace("contato_igual", "mesmo contato").replace("nome_semelhante", "nome parecido")})</span></li>)}</ul>}
                        <label className="text-xs" htmlFor={`crmi-dec-${c.idx}`}>O que fazer com esta linha?</label>
                        <select id={`crmi-dec-${c.idx}`} aria-label={`Decisão da linha ${data?.lines[c.idx]}`} value={dec[c.idx] ? (dec[c.idx].action === "use_existing" ? `use:${dec[c.idx].person_id ?? ""}` : dec[c.idx].action) : ""}
                          onChange={(e) => { const v = e.target.value; if (!v) setDecision(c.idx, null); else if (v.startsWith("use:")) setDecision(c.idx, { action: "use_existing", person_id: v.slice(4) }); else if (v === "update_existing") setDecision(c.idx, { action: "update_existing", fields: (c.diffs ?? []).map((d) => d.field) }); else setDecision(c.idx, { action: v as Decision["action"] }); }}>
                          <option value="">Decidir depois (esta linha NÃO será importada agora)</option>
                          <option value="skip">Pular esta linha</option>
                          {(c.candidates ?? []).filter((x) => x.visible && x.id).map((x) => <option key={x.id} value={`use:${x.id}`}>Usar a pessoa existente: {x.name} (não altera o cadastro)</option>)}
                          {c.kind === "dados_divergentes" && <option value="update_existing">Usar a pessoa existente e atualizar os dados escolhidos</option>}
                          {c.kind !== "cadastro_em_outra_unidade" && <option value="create_new">Criar como nova pessoa (outra pessoa de verdade)</option>}
                        </select>
                        {dec[c.idx]?.action === "update_existing" && (c.diffs ?? []).map((d) => (
                          <label key={d.field} className="flex items-center gap-2 text-xs !font-normal"><input type="checkbox" checked={dec[c.idx].fields?.includes(d.field) ?? false}
                            onChange={(e) => setDecision(c.idx, { action: "update_existing", fields: e.target.checked ? [...(dec[c.idx].fields ?? []), d.field] : (dec[c.idx].fields ?? []).filter((x) => x !== d.field) })} />Atualizar {FIELD_PT[d.field]} para “{d.incoming}”{d.field === "name" ? " (troca o nome do cadastro)" : " (acrescenta como contato; o antigo fica)"}</label>))}
                      </div>)}
                  </td></tr>))}</tbody></table></div>
          </div>)}

        {step === "resultado" && result && (
          <div className="grid gap-3 text-sm">
            <p role="status" className="flex flex-wrap gap-2 items-center"><Badge tone="success">{result.summary.created} criadas</Badge><Badge tone="info">{result.summary.linked + result.summary.updated} vinculadas a cadastros existentes</Badge><Badge tone="neutral">{result.summary.duplicate} já existiam</Badge>
              <Badge tone="neutral">{result.summary.skipped} puladas</Badge><Badge tone="warning">{result.summary.pending} pendentes</Badge><Badge tone="danger">{result.summary.invalid + result.summary.error} com erro</Badge></p>
            {result.summary.pending > 0 && <p className="text-muted-foreground">As linhas pendentes ficam de fora: reimporte o arquivo e decida cada conflito (as que já entraram não duplicam).</p>}
            <ul className="max-h-48 overflow-auto rounded-md border border-border p-3 text-xs" aria-label="Resultado por linha">{result.results.filter((r) => r.status === "error" || r.status === "invalid" || r.status === "pending").map((r) => <li key={r.idx}>Linha {data?.lines[r.idx]}: {RESULT_LABEL[r.status]}{r.message ? ` — ${r.message}` : ""}</li>)}</ul>
            <button className="hp-btn hp-btn-outline w-fit" onClick={report}>Baixar relatório (CSV)</button>
          </div>)}

        <DialogFooter>
          {step === "arquivo" && <><button className="hp-btn hp-btn-outline" onClick={() => onOpenChange(false)}>Cancelar</button><button className="hp-btn hp-btn-primary" disabled={!data || busy} onClick={goMap}>Continuar</button></>}
          {step === "mapa" && <><button className="hp-btn hp-btn-outline" onClick={() => setStep("arquivo")}>Voltar</button><button className="hp-btn hp-btn-primary" disabled={!mapOk || busy} onClick={() => void preview()}>{busy ? "Verificando…" : "Verificar (prévia)"}</button></>}
          {step === "previa" && <><button className="hp-btn hp-btn-outline" onClick={() => setStep("mapa")}>Voltar</button><button className="hp-btn hp-btn-primary" disabled={busy || toImport === 0} onClick={() => void commit()}>{busy ? "Importando…" : `Importar ${toImport} linha(s)`}</button></>}
          {step === "resultado" && <><button className="hp-btn hp-btn-outline" onClick={reset}>Importar outro arquivo</button><button className="hp-btn hp-btn-primary" onClick={() => onOpenChange(false)}>Fechar</button></>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
export default CrmImportDialog;
