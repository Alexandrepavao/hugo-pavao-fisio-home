import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { validateSlug } from "@/lib/reserved-slugs";
import { confirmDialog, promptText } from "@/lib/ui";
import BlockEditor from "@/features/pages/BlockEditor";
import { PageRenderer, type PublicForm } from "@/features/pages/PageRenderer";
import { BLOCK_LABEL, newBlock, type Block, type BlockType } from "@/features/pages/blocks";

interface Page {
  id: string; slug: string; title: string; description: string | null; status: string; pipeline_id: string | null;
  seo: { title?: string; description?: string; image?: string }; draft_content: Block[]; publish_at: string | null; unpublish_at: string | null;
  disabled_mode: string; disabled_message: string | null; redirect_url: string | null; published_at: string | null;
}
interface FormRow { id: string; name: string; fields: PublicForm["fields"]; success_message: string }
interface Version { version_no: number; kind: string; note: string | null; created_at: string }
interface Pipeline { id: string; name: string }

const field = "w-full border border-input bg-card px-3 py-2 text-[15px] focus:outline-none focus:ring-2 focus:ring-ring";
const STATUS: Record<string, string> = { draft: "Rascunho", published: "Publicada", disabled: "Desativada" };
const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);
type Tab = "content" | "settings" | "form" | "versions";

const PageEditor = () => {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const [page, setPage] = useState<Page | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [title, setTitle] = useState(""); const [desc, setDesc] = useState("");
  const [seo, setSeo] = useState<Page["seo"]>({});
  const [forms, setForms] = useState<FormRow[]>([]); const [versions, setVersions] = useState<Version[]>([]);
  const [pipes, setPipes] = useState<Pipeline[]>([]);
  const [tab, setTab] = useState<Tab>("content"); const [preview, setPreview] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false); const [dirty, setDirty] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [pubAt, setPubAt] = useState(""); const [unpubAt, setUnpubAt] = useState("");
  const [slug, setSlug] = useState(""); const [pipeId, setPipeId] = useState("");
  const [mode, setMode] = useState("message"); const [closeMsg, setCloseMsg] = useState(""); const [redirect, setRedirect] = useState("");

  const load = useCallback(async () => {
    const [p, f, v, pl] = await Promise.all([
      supabase.from("pages").select("*").eq("id", id).is("deleted_at", null).maybeSingle(),
      supabase.from("forms").select("id, name, fields, success_message").eq("page_id", id).order("created_at"),
      supabase.from("page_versions").select("version_no, kind, note, created_at").eq("page_id", id).order("version_no", { ascending: false }).limit(50),
      supabase.from("pipelines").select("id, name").eq("active", true),
    ]);
    if (p.error || !p.data) return setLoadErr(true);
    const pg = p.data as Page;
    setPage(pg); setBlocks(pg.draft_content ?? []); setTitle(pg.title); setDesc(pg.description ?? ""); setSeo(pg.seo ?? {});
    setSlug(pg.slug); setPipeId(pg.pipeline_id ?? ""); setPubAt(toLocal(pg.publish_at)); setUnpubAt(toLocal(pg.unpublish_at));
    setMode(pg.disabled_mode); setCloseMsg(pg.disabled_message ?? ""); setRedirect(pg.redirect_url ?? "");
    setForms((f.data ?? []) as FormRow[]); setVersions((v.data ?? []) as Version[]); setPipes((pl.data ?? []) as Pipeline[]); setDirty(false);
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener("beforeunload", h); return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const run = async (fn: () => Promise<{ error: { message: string; code?: string } | null }>, ok: string, reload = true) => {
    setBusy(true); setMsg(null);
    const { error } = await fn();
    setBusy(false);
    if (error) { setMsg({ kind: "err", text: error.code === "23505" ? "Este endereço já está em uso." : error.message.replace(/^.*?: /, "") }); return false; }
    setMsg({ kind: "ok", text: ok }); if (reload) await load(); return true;
  };

  const save = () => run(async () => supabase.rpc("page_save_draft", { p_id: id, p_title: title, p_description: desc, p_content: blocks, p_seo: seo }), "Rascunho salvo (nova versão registrada).");
  const publish = async () => {
    if (dirty && !(await save())) return;
    await run(async () => supabase.rpc("page_publish", { p_id: id, p_publish_at: fromLocal(pubAt), p_unpublish_at: fromLocal(unpubAt) }), pubAt && new Date(pubAt) > new Date() ? "Publicação agendada." : "Página publicada.");
  };
  const disable = () => run(async () => supabase.rpc("page_disable", { p_id: id, p_mode: mode, p_message: closeMsg || null, p_redirect_url: mode === "redirect" ? redirect : null }), "Página desativada.");
  const setSlugFn = () => { const e = validateSlug(slug); if (e) return setMsg({ kind: "err", text: e }); void run(async () => supabase.rpc("page_set_slug", { p_id: id, p_slug: slug }), "Endereço atualizado."); };
  const savePipe = () => run(async () => supabase.from("pages").update({ pipeline_id: pipeId || null }).eq("id", id), "Funil atualizado.");
  const duplicate = async () => {
    const s = await promptText("Duplicar página", "Endereço da cópia (ex.: checkup-2)", { defaultValue: `${page?.slug}-2` }); if (!s) return;
    const e = validateSlug(s); if (e) return setMsg({ kind: "err", text: e });
    setBusy(true);
    const { data, error } = await supabase.rpc("page_duplicate", { p_id: id, p_new_slug: s });
    setBusy(false);
    if (error) return setMsg({ kind: "err", text: error.code === "23505" ? "Este endereço já está em uso." : "Não foi possível duplicar." });
    nav(`/admin/paginas/${data as string}`);
  };
  const archive = async () => {
    if (!(await confirmDialog("Arquivar esta página?", "Ela sai do ar e da lista. O histórico de leads é preservado.", "Arquivar", true))) return;
    if (await run(async () => supabase.rpc("page_archive", { p_id: id }), "Arquivada.", false)) nav("/admin/paginas");
  };
  const saveForm = (f: FormRow) => run(async () => supabase.from("forms").update({ fields: f.fields, success_message: f.success_message }).eq("id", f.id), "Formulário salvo.");

  const upd = (fn: (b: Block[]) => Block[]) => { setBlocks(fn); setDirty(true); };

  if (loadErr) return <p role="alert" className="text-destructive">Página não encontrada ou sem permissão.</p>;
  if (!page) return <p role="status" className="text-muted-foreground">Carregando…</p>;

  const tabs: [Tab, string][] = [["content", "Conteúdo"], ["settings", "Configurações"], ["form", "Formulário"], ["versions", "Versões"]];
  const publicUrl = `${window.location.origin}/${page.slug}`;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div>
          <p className="eyebrow mb-2">HP Pages · {STATUS[page.status]}{page.status === "published" && page.publish_at && new Date(page.publish_at) > new Date() ? " (agendada)" : ""}</p>
          <h1 className="text-3xl text-foreground">{page.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{page.status === "published" ? <a className="underline" href={publicUrl} target="_blank" rel="noreferrer">{publicUrl}</a> : `Endereço: /${page.slug}`}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setPreview(!preview)} className="hp-btn hp-btn-outline">{preview ? "Voltar à edição" : "Pré-visualizar rascunho"}</button>
          <button onClick={save} disabled={busy || !dirty} className="hp-btn hp-btn-outline">Salvar rascunho</button>
          <button onClick={publish} disabled={busy} className="hp-btn hp-btn-primary">Publicar</button>
        </div>
      </div>
      {msg && <p role={msg.kind === "err" ? "alert" : "status"} className={`mb-4 text-sm ${msg.kind === "err" ? "text-destructive" : "text-foreground"}`}>{msg.text}</p>}
      {dirty && <p className="mb-4 text-sm text-accent">Alterações não salvas.</p>}

      {preview ? (
        <div className="border border-border bg-background"><p className="bg-accent/10 text-accent text-xs uppercase tracking-wider p-2 text-center">Pré-visualização do rascunho — o envio de formulários está desativado</p>
          <PageRenderer blocks={blocks} forms={forms as PublicForm[]} preview pageSlug={slug} /></div>
      ) : (
        <>
          <div role="tablist" className="flex gap-1 border-b border-border mb-6 overflow-x-auto">
            {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`px-4 py-2 -mb-px border-b-2 whitespace-nowrap ${tab === k ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}>{l}</button>)}
          </div>

          {tab === "content" && (
            <div className="space-y-4 max-w-3xl">
              <div><label htmlFor="pt" className="block text-sm mb-1">Título da página</label><input id="pt" className={field} value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} /></div>
              {blocks.map((b, i) => (
                <BlockEditor key={i} block={b} index={i} total={blocks.length} forms={forms}
                  onChange={(nb) => upd((cur) => cur.map((x, j) => (j === i ? nb : x)))}
                  onMove={(d) => upd((cur) => { const c = [...cur]; [c[i], c[i + d]] = [c[i + d], c[i]]; return c; })}
                  onRemove={() => upd((cur) => cur.filter((_, j) => j !== i))} />
              ))}
              <div className="flex flex-wrap gap-2 items-center"><span className="text-sm text-muted-foreground">Adicionar bloco:</span>
                {(Object.keys(BLOCK_LABEL) as BlockType[]).map((t) => <button key={t} onClick={() => upd((cur) => [...cur, t === "form" ? { ...newBlock(t), form_id: forms[0]?.id ?? "" } : newBlock(t)])} className="px-3 py-1 border border-border bg-card text-sm hover:border-accent">{BLOCK_LABEL[t]}</button>)}
              </div>
            </div>
          )}

          {tab === "settings" && (
            <div className="grid gap-8 max-w-3xl">
              <section className="space-y-3"><h2 className="text-xl">Endereço e destino</h2>
                <div className="flex gap-2"><span className="self-center text-muted-foreground">/</span><input aria-label="Endereço" className={field} value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} /><button onClick={setSlugFn} disabled={busy || slug === page.slug} className="hp-btn hp-btn-outline">Alterar</button></div>
                <div className="flex gap-2"><select aria-label="Funil de destino" className={field} value={pipeId} onChange={(e) => setPipeId(e.target.value)}><option value="">Sem funil</option>{pipes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                  <button onClick={savePipe} disabled={busy || pipeId === (page.pipeline_id ?? "")} className="hp-btn hp-btn-outline">Salvar</button></div>
              </section>
              <section className="space-y-3"><h2 className="text-xl">SEO e compartilhamento</h2>
                <div><label htmlFor="st" className="block text-sm mb-1">Título para buscadores</label><input id="st" className={field} value={seo.title ?? ""} onChange={(e) => { setSeo({ ...seo, title: e.target.value }); setDirty(true); }} /></div>
                <div><label htmlFor="sd" className="block text-sm mb-1">Descrição (até 160 caracteres)</label><textarea id="sd" rows={2} maxLength={160} className={field} value={seo.description ?? ""} onChange={(e) => { setSeo({ ...seo, description: e.target.value }); setDirty(true); }} /></div>
                <div><label htmlFor="si" className="block text-sm mb-1">Imagem de compartilhamento (https://…)</label><input id="si" type="url" className={field} value={seo.image ?? ""} onChange={(e) => { setSeo({ ...seo, image: e.target.value }); setDirty(true); }} /></div>
                <p className="text-xs text-muted-foreground">Salve o rascunho para gravar. Atenção: pré-visualizações de redes sociais dependem de renderização no servidor, ainda não implementada.</p>
              </section>
              <section className="space-y-3"><h2 className="text-xl">Agendamento</h2>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div><label htmlFor="pa" className="block text-sm mb-1">Publicar em</label><input id="pa" type="datetime-local" className={field} value={pubAt} onChange={(e) => setPubAt(e.target.value)} /></div>
                  <div><label htmlFor="ua" className="block text-sm mb-1">Encerrar em</label><input id="ua" type="datetime-local" className={field} value={unpubAt} onChange={(e) => setUnpubAt(e.target.value)} /></div>
                </div><p className="text-xs text-muted-foreground">Vale ao clicar em “Publicar”. Ao encerrar, a página passa a usar o modo de desativação abaixo.</p>
              </section>
              <section className="space-y-3"><h2 className="text-xl">Desativar</h2>
                <select aria-label="Modo de desativação" className={field} value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="message">Mostrar mensagem de encerramento</option><option value="waitlist">Abrir lista de espera</option><option value="redirect">Redirecionar</option></select>
                {mode === "message" && <input aria-label="Mensagem" className={field} placeholder="Mensagem exibida" value={closeMsg} onChange={(e) => setCloseMsg(e.target.value)} />}
                {mode === "redirect" && <input aria-label="Endereço de destino" className={field} placeholder="https://… ou /caminho" value={redirect} onChange={(e) => setRedirect(e.target.value)} />}
                <button onClick={disable} disabled={busy} className="hp-btn hp-btn-danger">Desativar página</button>
              </section>
              <section className="flex gap-3"><button onClick={duplicate} className="hp-btn hp-btn-outline">Duplicar página</button><button onClick={archive} className="hp-btn hp-btn-danger">Arquivar</button></section>
            </div>
          )}

          {tab === "form" && (
            <div className="space-y-8 max-w-3xl">
              {forms.map((f) => <FormEditor key={f.id} form={f} onSave={saveForm} busy={busy} />)}
              <p className="text-xs text-muted-foreground">Todo formulário precisa do campo “Nome” e de e-mail ou telefone. Os envios criam a pessoa e a oportunidade no funil da página, com proteção contra duplicidade e abuso.</p>
            </div>
          )}

          {tab === "versions" && (
            <ul className="max-w-3xl divide-y divide-border hp-card">
              {versions.map((v) => (
                <li key={v.version_no} className="p-3 flex items-center justify-between gap-3">
                  <span><span className="tabular">v{v.version_no}</span> · {v.kind === "publish" ? "Publicação" : v.kind === "restore" ? "Restauração" : v.kind === "create" ? "Criação" : "Rascunho"} · {new Date(v.created_at).toLocaleString("pt-BR")}{v.note ? ` — ${v.note}` : ""}</span>
                  <button onClick={async () => { if (await confirmDialog(`Restaurar a versão ${v.version_no}?`, "O conteúdo dela vira o rascunho atual (uma nova versão é registrada).", "Restaurar")) void run(async () => supabase.rpc("page_restore_version", { p_id: id, p_version_no: v.version_no }), "Versão restaurada como rascunho."); }} className="text-sm text-accent hover:underline">Restaurar</button>
                </li>))}
            </ul>
          )}
        </>
      )}
    </div>
  );
};

const FormEditor = ({ form, onSave, busy }: { form: FormRow; onSave: (f: FormRow) => void; busy: boolean }) => {
  const [f, setF] = useState(form);
  const setField = (i: number, patch: Partial<FormRow["fields"][number]>) => setF({ ...f, fields: f.fields.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  return (
    <section className="hp-card p-4 space-y-3">
      <h2 className="text-xl">{form.name}</h2>
      {f.fields.map((fl, i) => (
        <div key={fl.key} className="grid grid-cols-[1fr_9rem_auto] gap-2 items-center">
          <input aria-label={`Rótulo do campo ${fl.key}`} className={field} value={fl.label} onChange={(e) => setField(i, { label: e.target.value })} />
          <span className="text-sm text-muted-foreground">{fl.type}</span>
          <label className="text-sm flex items-center gap-1"><input type="checkbox" checked={!!fl.required} disabled={fl.key === "name"} onChange={(e) => setField(i, { required: e.target.checked })} /> Obrigatório</label>
        </div>))}
      <div><label htmlFor={`sm-${f.id}`} className="block text-sm mb-1">Mensagem de sucesso</label><input id={`sm-${f.id}`} className={field} value={f.success_message} onChange={(e) => setF({ ...f, success_message: e.target.value })} /></div>
      <button onClick={() => onSave(f)} disabled={busy} className="hp-btn hp-btn-outline">Salvar formulário</button>
    </section>
  );
};

export default PageEditor;
