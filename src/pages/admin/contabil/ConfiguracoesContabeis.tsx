import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Badge, errText, Msg, PageHead, State, Table, Td, promptText, useMsg } from "@/lib/ui";
import AccScopeBar from "./AccScopeBar";
import { useAccInvalidate, useAccQuery, useAccScope } from "./accLib";

interface Cfg {
  is_admin: boolean;
  settings: { require_receipt_paid_expenses: boolean; receipt_min_cents: number; block_close_with_unclassified: boolean; reopen_min_reason_len: number };
  accounts: { id: string; code: string; name: string; kind: "income" | "expense" | "other"; active: boolean; uses: number }[];
  categories: { id: string; name: string; kind: string; account_id: string | null }[];
  units: { id: string; name: string; legal_entity_id: string | null }[];
  legal_entities: { id: string; name: string; cnpj: string | null }[];
  people: { user_id: string; name: string; email: string; roles: string[]; grants: { permission: "close" | "reopen"; unit_id: string | null }[] }[];
}
const KIND: Record<string, string> = { income: "Receita", expense: "Despesa", other: "Outra" };
const ROLE: Record<string, string> = { manager: "Gestor", ops_admin: "Adm. operacional", unit_manager: "Gestor de unidade", finance: "Financeiro", accountant: "Contador(a)" };
const NOT_BUILT = [
  ["Apuração de tributos", "Não implementada. Nenhum cálculo de impostos é feito ou sugerido."],
  ["Emissão fiscal (NF-e/NFS-e)", "Não implementada. O app apenas guarda arquivos de notas como documentos."],
  ["Escrituração contábil oficial (livros, SPED, ECD/ECF)", "Não implementada. As classificações são gerenciais, para o contador mapear ao plano dele."],
  ["Integração direta com sistema do contador", "Não implementada. A entrega é o pacote ZIP/CSV gerado pelo próprio usuário."],
  ["Envio automático do pacote por e-mail", "Não implementado. Nenhuma mensagem é disparada pelo app."],
  ["Conciliação bancária dentro do Contábil", "Continua no Financeiro › Conciliação; o Contábil lê os lançamentos já conciliados como qualquer outro."],
];

/** Configurações contábeis: regras de fechamento, classificação gerencial, mapeamento de categorias, empresa (PJ do ADM) por unidade
 *  e permissões de fechar/reabrir. Tudo é dado da organização (não código): outra organização configura o seu. */
const ConfiguracoesContabeis = () => {
  const { link } = useAccScope(); void link; const invalidate = useAccInvalidate(); const [msg, m] = useMsg();
  const q = useAccQuery<Cfg>("acc_config", {}, ["config"]);
  const c = q.data; const admin = !!c?.is_admin;
  const [form, setForm] = useState({ req: true, min: "0", block: true, len: "10" });
  const [nw, setNw] = useState({ code: "", name: "", kind: "expense" });
  useEffect(() => { if (c) setForm({ req: c.settings.require_receipt_paid_expenses, min: String(c.settings.receipt_min_cents / 100).replace(".", ","), block: c.settings.block_close_with_unclassified, len: String(c.settings.reopen_min_reason_len) }); }, [c]);

  const act = async (fn: PromiseLike<{ error: { message: string; code?: string } | null }>, ok: string) => { const { error } = await fn; if (error) return m.err(errText(error)); m.ok(ok); await invalidate(); };
  const saveSettings = () => {
    const cents = Math.round(Number(form.min.replace(/\./g, "").replace(",", ".")) * 100);
    if (!Number.isFinite(cents) || cents < 0) return m.err("Valor mínimo de comprovante inválido.");
    return act(supabase.rpc("acc_settings_save", { p_require_receipt: form.req, p_receipt_min_cents: cents, p_block_unclassified: form.block, p_reopen_min_len: Number(form.len) }), "Parâmetros salvos.");
  };
  const addAccount = async () => { await act(supabase.rpc("acc_account_upsert", { p_id: null, p_code: nw.code, p_name: nw.name, p_kind: nw.kind, p_active: true }), "Classificação criada."); setNw({ code: "", name: "", kind: "expense" }); };
  const rename = async (a: Cfg["accounts"][number]) => { const n = await promptText("Renomear classificação", `Novo nome para ${a.code}`, { defaultValue: a.name }); if (n) await act(supabase.rpc("acc_account_upsert", { p_id: a.id, p_code: a.code, p_name: n, p_kind: a.kind, p_active: a.active }), "Classificação renomeada."); };
  const grantOn = (p: Cfg["people"][number], perm: "close" | "reopen") => p.grants.some((g) => g.permission === perm && g.unit_id === null);
  const grantScoped = (p: Cfg["people"][number], perm: "close" | "reopen") => p.grants.filter((g) => g.permission === perm && g.unit_id !== null).length;

  return (
    <div>
      <PageHead eyebrow="Contábil" title="Configurações contábeis" hint="Regras e cadastros desta organização. Só gestor e administrador operacional alteram; os demais consultam." />
      <AccScopeBar />
      <Msg m={msg} />
      <State loading={q.isLoading} error={q.error} />
      {c && (<div className="grid gap-8 grid-cols-[minmax(0,1fr)]">
        <section aria-labelledby="cfg-reg" className="hp-card p-4">
          <h3 id="cfg-reg" className="text-base font-semibold mb-3">Regras de fechamento</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-start gap-2 !font-normal"><input type="checkbox" disabled={!admin} checked={form.block} onChange={(e) => setForm({ ...form, block: e.target.checked })} /><span>Bloquear o fechamento com lançamentos sem classificação (dispensa exige justificativa)</span></label>
            <label className="flex items-start gap-2 !font-normal"><input type="checkbox" disabled={!admin} checked={form.req} onChange={(e) => setForm({ ...form, req: e.target.checked })} /><span>Exigir comprovante para despesas pagas antes de fechar</span></label>
            <div><label htmlFor="cfg-min" className="block text-xs mb-1">Exigir comprovante a partir de (R$)</label><input id="cfg-min" disabled={!admin || !form.req} value={form.min} onChange={(e) => setForm({ ...form, min: e.target.value })} inputMode="decimal" /><p className="text-xs text-muted-foreground mt-1">0 = qualquer valor.</p></div>
            <div><label htmlFor="cfg-len" className="block text-xs mb-1">Tamanho mínimo da justificativa de reabertura</label><input id="cfg-len" type="number" min={5} max={500} disabled={!admin} value={form.len} onChange={(e) => setForm({ ...form, len: e.target.value })} /></div>
          </div>
          {admin && <div className="mt-3"><button className="hp-btn hp-btn-primary" onClick={() => void saveSettings()}>Salvar regras</button></div>}
        </section>

        <section aria-labelledby="cfg-cls">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2"><h3 id="cfg-cls" className="text-base font-semibold">Classificação gerencial</h3>
            {admin && c.accounts.length === 0 && <button className="hp-btn hp-btn-outline hp-btn-sm" onClick={() => void act(supabase.rpc("acc_seed_default_accounts"), "Sugestão inicial carregada.")}>Carregar sugestão inicial</button>}</div>
          <p className="text-xs text-muted-foreground mb-3">Não é o plano de contas oficial: são as categorias que a organização usa para preparar a competência. O contador mapeia para o plano dele.</p>
          {admin && (
            <div className="flex flex-wrap items-end gap-2 mb-3">
              <div><label htmlFor="na-code" className="block text-xs mb-1">Código</label><input id="na-code" className="!w-24" value={nw.code} onChange={(e) => setNw({ ...nw, code: e.target.value })} /></div>
              <div><label htmlFor="na-name" className="block text-xs mb-1">Nome</label><input id="na-name" className="min-w-[16rem]" value={nw.name} onChange={(e) => setNw({ ...nw, name: e.target.value })} /></div>
              <div><label htmlFor="na-kind" className="block text-xs mb-1">Natureza</label><select id="na-kind" value={nw.kind} onChange={(e) => setNw({ ...nw, kind: e.target.value })}>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
              <button className="hp-btn hp-btn-primary" disabled={!nw.code.trim() || nw.name.trim().length < 2} onClick={() => void addAccount()}>Adicionar</button>
            </div>)}
          {c.accounts.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma classificação cadastrada.</p> : (
            <Table head={["Código", "Nome", "Natureza", "Em uso", "Situação", ""]} right={[3]}>
              {c.accounts.map((a) => (
                <tr key={a.id}><Td><code>{a.code}</code></Td><Td>{a.name}</Td><Td>{KIND[a.kind]}</Td><Td num>{a.uses}</Td><Td>{a.active ? <Badge tone="success">Ativa</Badge> : <Badge>Inativa</Badge>}</Td>
                  <Td>{admin && <div className="flex gap-1.5 justify-end"><button className="hp-btn hp-btn-outline hp-btn-sm" onClick={() => void rename(a)}>Renomear</button>
                    <button className="hp-btn hp-btn-ghost hp-btn-sm" onClick={() => void act(supabase.rpc("acc_account_upsert", { p_id: a.id, p_code: a.code, p_name: a.name, p_kind: a.kind, p_active: !a.active }), a.active ? "Classificação desativada." : "Classificação reativada.")}>{a.active ? "Desativar" : "Reativar"}</button></div>}</Td></tr>))}
            </Table>)}
        </section>

        <section aria-labelledby="cfg-map">
          <h3 id="cfg-map" className="text-base font-semibold mb-1">Categorias do Financeiro → classificação</h3>
          <p className="text-xs text-muted-foreground mb-3">Usado nas sugestões automáticas para contas a pagar. Categorias sem mapeamento exigem classificação manual.</p>
          {c.categories.length === 0 ? <p className="text-sm text-muted-foreground">O Financeiro ainda não tem categorias ativas.</p> : (
            <Table head={["Categoria no Financeiro", "Natureza", "Classificação sugerida"]}>
              {c.categories.map((k) => (
                <tr key={k.id}><Td>{k.name}</Td><Td>{k.kind === "income" ? "Receita" : "Despesa"}</Td>
                  <Td><label className="sr-only" htmlFor={`map-${k.id}`}>Classificação para {k.name}</label>
                    <select id={`map-${k.id}`} disabled={!admin} value={k.account_id ?? ""} onChange={(e) => void act(supabase.rpc("acc_category_map_set", { p_category: k.id, p_account: e.target.value || null }), "Mapeamento salvo.")}>
                      <option value="">— sem sugestão —</option>{c.accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select></Td></tr>))}
            </Table>)}
        </section>

        <section aria-labelledby="cfg-un">
          <h3 id="cfg-un" className="text-base font-semibold mb-1">Unidade operacional → empresa (CNPJ do ADM)</h3>
          <p className="text-xs text-muted-foreground mb-3">A unidade é operacional; a empresa é a pessoa jurídica do cadastro central (ADM) que responde por ela. Aparece no pacote do contador.</p>
          <Table head={["Unidade", "Empresa vinculada"]}>
            {c.units.map((u) => (
              <tr key={u.id}><Td>{u.name}</Td><Td>
                {admin ? (<><label className="sr-only" htmlFor={`ue-${u.id}`}>Empresa da unidade {u.name}</label>
                  <select id={`ue-${u.id}`} value={u.legal_entity_id ?? ""} onChange={(e) => void act(supabase.rpc("acc_unit_entity_set", { p_unit: u.id, p_entity: e.target.value || null }), "Vínculo salvo.")}>
                    <option value="">— não vinculada —</option>{c.legal_entities.map((e) => <option key={e.id} value={e.id}>{e.name}{e.cnpj ? ` (${e.cnpj})` : ""}</option>)}</select></>) : (u.legal_entity_id ? "Vinculada" : "—")}</Td></tr>))}
          </Table>
        </section>

        {admin && (
          <section aria-labelledby="cfg-perm">
            <h3 id="cfg-perm" className="text-base font-semibold mb-1">Permissões de fechar e reabrir competências</h3>
            <p className="text-xs text-muted-foreground mb-3">São permissões específicas, além do papel: nem gestor fecha ou reabre sem concessão. Cada concessão e revogação fica na auditoria. Vale para todas as unidades em que a pessoa tem papel contábil.</p>
            <Table head={["Pessoa", "Papéis", "Pode fechar", "Pode reabrir"]}>
              {c.people.map((p) => (
                <tr key={p.user_id}><Td><span className="font-medium">{p.name}</span><span className="block text-xs text-muted-foreground">{p.email}</span></Td><Td>{p.roles.map((r) => ROLE[r] ?? r).join(", ")}</Td>
                  {(["close", "reopen"] as const).map((perm) => (
                    <Td key={perm}><label className="flex items-center gap-2 !font-normal"><input type="checkbox" checked={grantOn(p, perm)} aria-label={`${perm === "close" ? "Fechar" : "Reabrir"} — ${p.name}`}
                      onChange={(e) => void act(supabase.rpc("acc_grant_set", { p_user: p.user_id, p_permission: perm, p_unit: null, p_on: e.target.checked }), e.target.checked ? "Permissão concedida." : "Permissão revogada.")} />
                      {grantOn(p, perm) ? "Sim" : grantScoped(p, perm) ? `Só em ${grantScoped(p, perm)} unidade(s)` : "Não"}</label></Td>))}
                </tr>))}
            </Table>
          </section>)}

        <section aria-labelledby="cfg-esc" className="hp-card p-4">
          <h3 id="cfg-esc" className="text-base font-semibold mb-2">O que o Contábil ainda não faz</h3>
          <ul className="grid gap-1.5 text-sm">{NOT_BUILT.map(([t, d]) => <li key={t}><b>{t}</b> — <span className="text-muted-foreground">{d}</span></li>)}</ul>
        </section>
      </div>)}
    </div>
  );
};
export default ConfiguracoesContabeis;
