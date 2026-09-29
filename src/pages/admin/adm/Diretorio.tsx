import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fmtDate } from "@/lib/format";
import { Badge, PageHead, State, StatCard, Table, Td, btnGhost, btnPrimary } from "@/lib/ui";
import { useUnits } from "../finance/shared";
import PersonAdmSheet from "./PersonAdmSheet";
import LegalEntitySheet from "./LegalEntitySheet";
import NewRecordDialog from "./NewRecordDialog";

interface Row {
  id: string; type: "pf" | "pj"; name: string; document: string | null; document_full_available: boolean;
  email: string | null; phone: string | null; city: string | null; uf: string | null; status: string;
  created_at: string; units: string[]; complete: boolean; kinds: string[];
}

const KIND_LABEL: Record<string, string> = { lead: "Lead", patient: "Paciente", partner: "Parceiro", student: "Aluno", staff: "Colaborador", contact: "Contato", supplier: "Fornecedor" };
const STATUS_LABEL: Record<string, string> = { ativo: "Ativo", pendente: "Pendente", inativo: "Inativo" };

/** Planilha administrativa: interface sobre o cadastro central (people = PF, legal_entities = PJ) — nunca uma
 *  base paralela. Busca, filtros e ordenação no servidor (adm_directory); documento mascarado por padrão. */
const Diretorio = () => {
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const [search, setSearch] = useState(sp.get("q") ?? "");
  const [type, setType] = useState(sp.get("tipo") ?? "");
  const [kind, setKind] = useState("");
  const [unit, setUnit] = useState("");
  const [status, setStatus] = useState("");
  const [incompleteOnly, setIncompleteOnly] = useState(sp.get("incompleto") === "1");
  const [sort, setSort] = useState<"name" | "created_at" | "city">("created_at");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [openPerson, setOpenPerson] = useState<string | null>(null);
  const [openEntity, setOpenEntity] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const pageSize = 25;

  const units = useUnits();
  const indicators = useQuery({ queryKey: ["adm-indicators"], queryFn: async () => {
    const from = new Date(); from.setDate(from.getDate() - 30);
    const { data, error } = await supabase.rpc("adm_directory_indicators", { p_from: from.toISOString(), p_to: new Date().toISOString(), p_unit: null });
    if (error) throw error; return data as Record<string, { value: number; available: boolean; basis: string }>;
  } });
  const dir_ = useQuery({ queryKey: ["adm-directory", search, type, kind, unit, status, incompleteOnly, sort, dir, page], queryFn: async () => {
    const { data, error } = await supabase.rpc("adm_directory", {
      p_search: search || null, p_type: type || null, p_kind: kind || null, p_unit: unit || null,
      p_status: status || null, p_incomplete_only: incompleteOnly, p_sort: sort, p_dir: dir, p_page: page, p_page_size: pageSize,
    });
    if (error) throw error; return data as { rows: Row[]; total: number; page: number; page_size: number };
  } });

  const toggleSort = (col: "name" | "created_at" | "city") => {
    if (sort === col) setDir(dir === "asc" ? "desc" : "asc"); else { setSort(col); setDir("asc"); }
    setPage(0);
  };
  const applyIndicatorFilter = (patch: { type?: string; incomplete?: boolean }) => {
    if (patch.type !== undefined) setType(patch.type);
    if (patch.incomplete !== undefined) setIncompleteOnly(patch.incomplete);
    setPage(0);
  };

  const totalPages = dir_.data ? Math.max(1, Math.ceil(dir_.data.total / pageSize)) : 1;

  return (
    <div>
      <PageHead eyebrow="ADM" title="Planilha administrativa" hint="Interface sobre o cadastro central — pessoa física (people) e jurídica (legal_entities). Uma pessoa pode ter vários vínculos sem duplicar cadastro."
        actions={<button className={btnPrimary} onClick={() => setShowNew(true)}>Novo cadastro</button>} />

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

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative">
          <Search size={14} aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <label htmlFor="dir-q" className="sr-only">Buscar</label>
          <input id="dir-q" placeholder="Nome, razão social, e-mail, telefone ou documento" style={{ paddingLeft: "2rem" }} value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }} className="!h-9 rounded-full !py-0 text-[13px] min-w-[18rem]" />
        </div>
        <select value={type} onChange={(e) => { setType(e.target.value); setPage(0); }} className="!h-9 rounded-full !py-0 text-[13px]" aria-label="Tipo">
          <option value="">PF e PJ</option><option value="pf">Pessoa física</option><option value="pj">Pessoa jurídica</option>
        </select>
        <select value={kind} onChange={(e) => { setKind(e.target.value); setPage(0); }} className="!h-9 rounded-full !py-0 text-[13px]" aria-label="Vínculo">
          <option value="">Todos os vínculos</option>{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select value={unit} onChange={(e) => { setUnit(e.target.value); setPage(0); }} className="!h-9 rounded-full !py-0 text-[13px]" aria-label="Unidade">
          <option value="">Todas as unidades</option>{units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} className="!h-9 rounded-full !py-0 text-[13px]" aria-label="Status">
          <option value="">Todos os status</option>{Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked={incompleteOnly} onChange={(e) => { setIncompleteOnly(e.target.checked); setPage(0); }} />Só incompletos</label>
        {(search || type || kind || unit || status || incompleteOnly) && (
          <button className={btnGhost + " hp-btn-sm"} onClick={() => { setSearch(""); setType(""); setKind(""); setUnit(""); setStatus(""); setIncompleteOnly(false); setSp({}); setPage(0); }}>Limpar</button>
        )}
      </div>

      <State loading={dir_.isLoading} error={dir_.error} empty={dir_.data?.rows.length === 0} emptyText="Nenhum cadastro encontrado com estes filtros." />
      {dir_.data && dir_.data.rows.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <Table head={[
              <button key="name" className="flex items-center gap-1 font-medium" onClick={() => toggleSort("name")}>Nome {sort === "name" && (dir === "asc" ? "▲" : "▼")}</button> as unknown as string,
              "Tipo", "Documento", <button key="city" className="flex items-center gap-1 font-medium" onClick={() => toggleSort("city")}>Cidade/UF {sort === "city" && (dir === "asc" ? "▲" : "▼")}</button> as unknown as string,
              "Unidade(s)", "Status", "Completo", <button key="created" className="flex items-center gap-1 font-medium" onClick={() => toggleSort("created_at")}>Criado em {sort === "created_at" && (dir === "asc" ? "▲" : "▼")}</button> as unknown as string,
            ]}>
              {dir_.data.rows.map((r) => (
                <tr key={r.type + r.id}>
                  <Td><button className="font-medium text-left hover:underline" onClick={() => (r.type === "pf" ? setOpenPerson(r.id) : setOpenEntity(r.id))}>{r.name}</button></Td>
                  <Td><Badge tone={r.type === "pj" ? "info" : undefined}>{r.type === "pf" ? "PF" : "PJ"}</Badge></Td>
                  <Td className="tabular">{r.document ?? "—"}</Td>
                  <Td>{r.city ? `${r.city}/${r.uf}` : "—"}</Td>
                  <Td>{r.units.length ? r.units.join(", ") : "—"}</Td>
                  <Td>{STATUS_LABEL[r.status] ?? r.status}</Td>
                  <Td>{r.complete ? <Badge tone="success">Completo</Badge> : <Badge tone="warning">Incompleto</Badge>}</Td>
                  <Td>{fmtDate(r.created_at)}</Td>
                </tr>
              ))}
            </Table>
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

      <PersonAdmSheet personId={openPerson} onClose={() => setOpenPerson(null)} onChanged={() => { void qc.invalidateQueries({ queryKey: ["adm-directory"] }); void qc.invalidateQueries({ queryKey: ["adm-indicators"] }); }} />
      <LegalEntitySheet entityId={openEntity} onClose={() => setOpenEntity(null)} onChanged={() => { void qc.invalidateQueries({ queryKey: ["adm-directory"] }); void qc.invalidateQueries({ queryKey: ["adm-indicators"] }); }} />
      <NewRecordDialog open={showNew} onOpenChange={setShowNew}
        onCreatedPerson={(id) => { setShowNew(false); setOpenPerson(id); void qc.invalidateQueries({ queryKey: ["adm-directory"] }); void qc.invalidateQueries({ queryKey: ["adm-indicators"] }); }}
        onCreatedEntity={(id) => { setShowNew(false); setOpenEntity(id); void qc.invalidateQueries({ queryKey: ["adm-directory"] }); void qc.invalidateQueries({ queryKey: ["adm-indicators"] }); }} />
    </div>
  );
};

export default Diretorio;
