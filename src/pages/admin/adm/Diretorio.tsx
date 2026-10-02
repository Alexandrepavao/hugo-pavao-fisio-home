import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Columns3, Download, Search, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { download, fmtDate, toCsv } from "@/lib/format";
import { Badge, errText, Msg, PageHead, State, StatCard, btnGhost, btnPrimary, useMsg } from "@/lib/ui";
import { ListFilterBar } from "@/lib/ListFilterBar";
import { useUnits } from "../finance/shared";
import ImportDialog from "../people/ImportDialog";
import PersonAdmSheet from "./PersonAdmSheet";
import LegalEntitySheet from "./LegalEntitySheet";
import NewRecordDialog from "./NewRecordDialog";
import PjImportDialog from "./PjImportDialog";
import ColumnsDialog, { type CatalogColumn } from "./ColumnsDialog";

interface Row {
  id: string; type: "pf" | "pj"; name: string; document: string | null; document_full_available: boolean;
  email: string | null; phone: string | null; city: string | null; uf: string | null; status: string;
  created_at: string; units: string[]; complete: boolean; kinds: string[];
  trade_name: string | null; origin: string | null; tax_regime: string | null; state_registration: string | null; email_finance: string | null;
}
type SortKey = "name" | "created_at" | "city";
interface View { columns: string[]; is_default: boolean }

const KIND_LABEL: Record<string, string> = { lead: "Lead", patient: "Paciente", partner: "Parceiro", student: "Aluno", staff: "Colaborador", contact: "Contato", supplier: "Fornecedor" };
const STATUS_LABEL: Record<string, string> = { ativo: "Ativo", pendente: "Pendente", inativo: "Inativo" };
const dash = (v: ReactNode) => (v === null || v === undefined || v === "" ? "—" : v);

/** Como cada coluna do catálogo (adm_columns_catalog) é exibida e, quando dá, ordenada. */
const RENDER: Record<string, { sort?: SortKey; cell: (r: Row) => ReactNode; csv: (r: Record<string, unknown>) => unknown }> = {
  name: { sort: "name", cell: (r) => r.name, csv: (r) => r.name },
  type: { cell: (r) => <Badge tone={r.type === "pj" ? "info" : undefined}>{r.type === "pf" ? "PF" : "PJ"}</Badge>, csv: (r) => (r.type === "pf" ? "PF" : "PJ") },
  document: { cell: (r) => <span className="tabular">{dash(r.document)}</span>, csv: (r) => r.document },
  email: { cell: (r) => dash(r.email), csv: (r) => r.email },
  phone: { cell: (r) => dash(r.phone), csv: (r) => r.phone },
  city: { sort: "city", cell: (r) => (r.city ? `${r.city}/${r.uf}` : "—"), csv: (r) => (r.city ? `${r.city}/${r.uf}` : "") },
  units: { cell: (r) => (r.units.length ? r.units.join(", ") : "—"), csv: (r) => (r.units as string[] | undefined)?.join(", ") },
  status: { cell: (r) => STATUS_LABEL[r.status] ?? r.status, csv: (r) => STATUS_LABEL[r.status as string] ?? r.status },
  complete: { cell: (r) => (r.complete ? <Badge tone="success">Completo</Badge> : <Badge tone="warning">Incompleto</Badge>), csv: (r) => (r.complete ? "Completo" : "Incompleto") },
  created_at: { sort: "created_at", cell: (r) => fmtDate(r.created_at), csv: (r) => fmtDate(r.created_at as string) },
  kinds: { cell: (r) => (r.kinds.length ? r.kinds.map((k) => KIND_LABEL[k] ?? k).join(", ") : "—"), csv: (r) => (r.kinds as string[] | undefined)?.map((k) => KIND_LABEL[k] ?? k).join(", ") },
  trade_name: { cell: (r) => dash(r.trade_name), csv: (r) => r.trade_name },
  origin: { cell: (r) => dash(r.origin), csv: (r) => r.origin },
  tax_regime: { cell: (r) => dash(r.tax_regime), csv: (r) => r.tax_regime },
  state_registration: { cell: (r) => dash(r.state_registration), csv: (r) => r.state_registration },
  email_finance: { cell: (r) => dash(r.email_finance), csv: (r) => r.email_finance },
};

const UFS = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"];
/** Planilha administrativa: interface sobre o cadastro central (people = PF, legal_entities = PJ) — nunca uma
 *  base paralela. Busca, filtros, ordenação, colunas e exportação passam pelo servidor; campos sensíveis e
 *  documento completo dependem da permissão, não da interface. */
const Diretorio = () => {
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const [search, setSearch] = useState(sp.get("q") ?? "");
  const [type, setType] = useState(sp.get("tipo") ?? "");
  const [kind, setKind] = useState(sp.get("vinculo") ?? "");
  const [unit, setUnit] = useState(sp.get("unidade") ?? "");
  const [status, setStatus] = useState(sp.get("status") ?? "");
  const [incompleteOnly, setIncompleteOnly] = useState(sp.get("incompleto") === "1");
  const [uf, setUf] = useState((sp.get("uf") ?? "").toUpperCase());
  const [sort, setSort] = useState<SortKey>("created_at");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [openPerson, setOpenPerson] = useState<string | null>(null);
  const [openEntity, setOpenEntity] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showCols, setShowCols] = useState(false);
  const [showPj, setShowPj] = useState(false);
  const [showPf, setShowPf] = useState(false);
  const [msg, m] = useMsg();
  const pageSize = 25;

  const units = useUnits();
  const indicators = useQuery({ queryKey: ["adm-indicators"], queryFn: async () => {
    const from = new Date(); from.setDate(from.getDate() - 30);
    const { data, error } = await supabase.rpc("adm_directory_indicators", { p_from: from.toISOString(), p_to: new Date().toISOString(), p_unit: null });
    if (error) throw error; return data as Record<string, { value: number; available: boolean; basis: string }>;
  } });
  const catalog = useQuery({ queryKey: ["adm-columns-catalog"], queryFn: async () => {
    const { data, error } = await supabase.rpc("adm_columns_catalog"); if (error) throw error; return data as CatalogColumn[];
  } });
  const view = useQuery({ queryKey: ["adm-view"], queryFn: async () => {
    const { data, error } = await supabase.rpc("adm_view_get", { p_view: "diretorio" }); if (error) throw error; return data as View;
  } });
  const dir_ = useQuery({ queryKey: ["adm-directory", search, type, kind, unit, status, incompleteOnly, uf, sort, dir, page], queryFn: async () => {
    const { data, error } = await supabase.rpc("adm_directory", {
      p_search: search || null, p_type: type || null, p_kind: kind || null, p_unit: unit || null,
      p_status: status || null, p_incomplete_only: incompleteOnly, p_sort: sort, p_dir: dir, p_page: page, p_page_size: pageSize, p_uf: uf || null,
    });
    if (error) throw error; return data as { rows: Row[]; total: number; page: number; page_size: number };
  } });

  const saveView = useMutation({
    mutationFn: async (cols: string[]) => { const { data, error } = await supabase.rpc("adm_view_save", { p_columns: cols, p_view: "diretorio" }); if (error) throw error; return data as View; },
    onSuccess: (v) => { qc.setQueryData(["adm-view"], v); setShowCols(false); m.ok("Preferência de colunas salva para o seu usuário."); },
    onError: (e: { message: string; code?: string }) => m.err(errText(e)),
  });
  const resetView = useMutation({
    mutationFn: async () => { const { data, error } = await supabase.rpc("adm_view_reset", { p_view: "diretorio" }); if (error) throw error; return data as View; },
    onSuccess: (v) => { qc.setQueryData(["adm-view"], v); setShowCols(false); m.ok("Colunas restauradas para o padrão."); },
    onError: (e: { message: string; code?: string }) => m.err(errText(e)),
  });

  const exportCsv = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("adm_export", {
        p_search: search || null, p_type: type || null, p_kind: kind || null, p_unit: unit || null, p_status: status || null,
        p_incomplete_only: incompleteOnly, p_columns: cols, p_uf: uf || null,
      });
      if (error) throw error; return data as { columns: string[]; rows: Record<string, unknown>[]; total: number; truncated: boolean; masked_document: boolean };
    },
    onSuccess: (r) => {
      const label = new Map((catalog.data ?? []).map((c) => [c.key, c.label]));
      const out = r.rows.map((row) => Object.fromEntries(r.columns.map((k) => [label.get(k) ?? k, RENDER[k]?.csv(row) ?? row[k] ?? ""])));
      download(`planilha-adm-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(out.length ? out : [Object.fromEntries(r.columns.map((k) => [label.get(k) ?? k, ""]))]));
      m.ok(`${r.rows.length} linha(s) exportada(s)${r.truncated ? " (limite de 5.000 — refine os filtros para o restante)" : ""}${r.masked_document ? ". Documentos mascarados conforme a sua permissão." : "."}`);
    },
    onError: (e: { message: string; code?: string }) => m.err(errText(e)),
  });

  const cols = (view.data?.columns ?? []).filter((k) => RENDER[k]);
  const canSensitive = (catalog.data ?? []).some((c) => c.sensitive && c.allowed);
  const label = (k: string) => catalog.data?.find((c) => c.key === k)?.label ?? k;

  const toggleSort = (col: SortKey) => {
    if (sort === col) setDir(dir === "asc" ? "desc" : "asc"); else { setSort(col); setDir("asc"); }
    setPage(0);
  };
  const applyIndicatorFilter = (patch: { type?: string; incomplete?: boolean }) => {
    if (patch.type !== undefined) setType(patch.type);
    if (patch.incomplete !== undefined) setIncompleteOnly(patch.incomplete);
    setPage(0);
  };
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["adm-directory"] }); void qc.invalidateQueries({ queryKey: ["adm-indicators"] }); };
  const totalPages = dir_.data ? Math.max(1, Math.ceil(dir_.data.total / pageSize)) : 1;

  return (
    <div>
      <PageHead eyebrow="Administrativo" title="Planilha administrativa" hint="Interface sobre o cadastro central — pessoa física (people) e jurídica (legal_entities). Uma pessoa pode ter vários vínculos sem duplicar cadastro."
        actions={<>
          <button className={btnGhost} onClick={() => setShowCols(true)} disabled={!catalog.data || !view.data}><Columns3 size={15} />Colunas</button>
          <button className={btnGhost} onClick={() => exportCsv.mutate()} disabled={exportCsv.isPending || !view.data}><Download size={15} />{exportCsv.isPending ? "Exportando…" : "Exportar CSV"}</button>
          {canSensitive && <button className={btnGhost} onClick={() => setShowPj(true)}><Upload size={15} />Importar PJ (CSV)</button>}
          {canSensitive && <button className={btnGhost} onClick={() => setShowPf(true)}><Upload size={15} />Importar PF (CSV)</button>}
          <button className={btnPrimary} onClick={() => setShowNew(true)}>Novo cadastro</button>
        </>} />
      <Msg m={msg} />

      <State loading={indicators.isLoading} error={indicators.error} />
      {indicators.data && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 mb-6">
          <StatCard label="Total de cadastros" value={indicators.data.total.value.toLocaleString("pt-BR")} onClick={() => applyIndicatorFilter({ type: "" })} />
          <StatCard label="Pessoas físicas" value={indicators.data.pf.value.toLocaleString("pt-BR")} onClick={() => applyIndicatorFilter({ type: "pf" })} />
          <StatCard label="Pessoas jurídicas" value={indicators.data.pj.value.toLocaleString("pt-BR")} onClick={() => applyIndicatorFilter({ type: "pj" })} />
          <StatCard label="Novos (30 dias)" value={indicators.data.new_in_period.value.toLocaleString("pt-BR")} basis={indicators.data.new_in_period.basis} />
          <StatCard label="Cadastros incompletos" value={indicators.data.incomplete.value.toLocaleString("pt-BR")} tone={indicators.data.incomplete.value > 0 ? "danger" : undefined} onClick={() => applyIndicatorFilter({ incomplete: true })} />
        </ul>
      )}

      {/* filtro único: busca e unidade visíveis; tipo, vínculo, status, estado e “só incompletos” dentro do botão Filtros (com contador, chips e “Limpar filtros”) — mesmos parâmetros de URL e mesma consulta de antes */}
      <ListFilterBar search={{ id: "dir-q", label: "Buscar", placeholder: "Nome, razão social, e-mail, telefone ou documento", value: search, onChange: (v) => { setSearch(v); setPage(0); } }}
        unit={unit} units={units.data ?? []} onUnit={(v) => { setUnit(v); setPage(0); }}
        onClear={() => { setSearch(""); setType(""); setKind(""); setUnit(""); setStatus(""); setIncompleteOnly(false); setUf(""); setSp({}); setPage(0); }}
        extraCount={[type, kind, status, uf].filter(Boolean).length + (incompleteOnly ? 1 : 0)}
        extraSummary={[type ? `Tipo: ${type === "pf" ? "Pessoa física" : "Pessoa jurídica"}` : "", kind ? `Vínculo: ${KIND_LABEL[kind] ?? kind}` : "", status ? `Status: ${STATUS_LABEL[status] ?? status}` : "", uf ? `Estado: ${uf}` : "", incompleteOnly ? "Só incompletos" : ""].filter(Boolean).join(" · ") || undefined}
        extra={<div className="grid gap-3">
          <div><label htmlFor="dir-f-tipo" className="block text-xs mb-1">Tipo</label><select id="dir-f-tipo" value={type} onChange={(e) => { setType(e.target.value); setPage(0); }}><option value="">PF e PJ</option><option value="pf">Pessoa física</option><option value="pj">Pessoa jurídica</option></select></div>
          <div><label htmlFor="dir-f-vinculo" className="block text-xs mb-1">Vínculo</label><select id="dir-f-vinculo" value={kind} onChange={(e) => { setKind(e.target.value); setPage(0); }}><option value="">Todos os vínculos</option>{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div><label htmlFor="dir-f-status" className="block text-xs mb-1">Status</label><select id="dir-f-status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}><option value="">Todos os status</option>{Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div><label htmlFor="dir-f-uf" className="block text-xs mb-1">Estado</label><select id="dir-f-uf" value={uf} onChange={(e) => { setUf(e.target.value); setPage(0); }}><option value="">Todos os estados</option>{UFS.map((x) => <option key={x} value={x}>{x}</option>)}</select></div>
          <label className="flex items-center gap-2 text-sm !font-normal"><input type="checkbox" checked={incompleteOnly} onChange={(e) => { setIncompleteOnly(e.target.checked); setPage(0); }} />Só incompletos</label>
        </div>} />

      <State loading={dir_.isLoading || view.isLoading} error={dir_.error ?? view.error} empty={dir_.data?.rows.length === 0} emptyText="Nenhum cadastro encontrado com estes filtros." />
      {dir_.data && dir_.data.rows.length > 0 && view.data && (
        <>
          <div className="hp-card overflow-x-auto">
            <table className="w-full" data-testid="adm-table">
              <thead><tr className="text-left text-xs font-semibold text-muted-foreground bg-muted/60 border-b border-border">
                {cols.map((k) => {
                  const s = RENDER[k].sort;
                  return <th key={k} scope="col" data-col={k} className="px-3 py-2.5">
                    {s ? <button className="flex items-center gap-1 font-semibold" onClick={() => toggleSort(s)}>{label(k)} {sort === s && (dir === "asc" ? "▲" : "▼")}</button> : label(k)}
                  </th>;
                })}
              </tr></thead>
              <tbody>
                {dir_.data.rows.map((r) => (
                  <tr key={r.type + r.id}>
                    {cols.map((k) => (
                      <td key={k} className="px-3 py-2.5 border-b border-border last:border-0 align-middle">
                        {k === "name"
                          ? <button className="font-medium text-left hover:underline" onClick={() => (r.type === "pf" ? setOpenPerson(r.id) : setOpenEntity(r.id))}>{r.name}</button>
                          : RENDER[k].cell(r)}
                      </td>))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between mt-3 text-sm text-muted-foreground">
            <span>{dir_.data.total} cadastro(s) — página {page + 1} de {totalPages}</span>
            <div className="flex gap-2">
              <button className={btnGhost + " hp-btn-sm"} disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Anterior</button>
              <button className={btnGhost + " hp-btn-sm"} disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>Próxima</button>
            </div>
          </div>
        </>
      )}

      <PersonAdmSheet personId={openPerson} onClose={() => setOpenPerson(null)} onChanged={refresh} />
      <LegalEntitySheet entityId={openEntity} onClose={() => setOpenEntity(null)} onChanged={refresh} />
      <NewRecordDialog open={showNew} onOpenChange={setShowNew}
        onCreatedPerson={(id) => { setShowNew(false); setOpenPerson(id); refresh(); }}
        onCreatedEntity={(id) => { setShowNew(false); setOpenEntity(id); refresh(); }} />
      {catalog.data && view.data && (
        <ColumnsDialog open={showCols} onOpenChange={setShowCols} catalog={catalog.data} columns={view.data.columns} isDefault={view.data.is_default}
          busy={saveView.isPending || resetView.isPending} onSave={(c) => saveView.mutate(c)} onReset={() => resetView.mutate()} />
      )}
      <PjImportDialog open={showPj} onOpenChange={setShowPj} units={units.data ?? []} onDone={refresh} />
      <ImportDialog open={showPf} onOpenChange={setShowPf} units={units.data ?? []} onDone={refresh} />
    </div>
  );
};

export default Diretorio;
