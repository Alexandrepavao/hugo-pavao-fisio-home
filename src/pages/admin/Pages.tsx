import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { validateSlug } from "@/lib/reserved-slugs";
import { TEMPLATES } from "@/features/pages/blocks";

interface PageRow { id: string; slug: string; title: string; status: string; publish_at: string | null; unpublish_at: string | null; updated_at: string }
interface Metric { page_id: string; visits: number; leads: number }
interface Pipeline { id: string; name: string; kind: string }
interface Unit { id: string; name: string }

const STATUS: Record<string, string> = { draft: "Rascunho", published: "Publicada", disabled: "Desativada" };
const field = "w-full border border-input bg-card px-3 py-2 text-[15px] focus:outline-none focus:ring-2 focus:ring-ring";

const Pages = () => {
  const [rows, setRows] = useState<PageRow[]>([]);
  const [metrics, setMetrics] = useState<Record<string, Metric>>({});
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    setState("loading");
    const from = new Date(Date.now() - 30 * 864e5).toISOString(), to = new Date(Date.now() + 864e5).toISOString();
    const [p, m] = await Promise.all([
      supabase.from("pages").select("id, slug, title, status, publish_at, unpublish_at, updated_at").is("deleted_at", null).order("updated_at", { ascending: false }),
      supabase.rpc("page_metrics", { p_from: from, p_to: to }),
    ]);
    if (p.error) return setState("error");
    setRows((p.data ?? []) as PageRow[]);
    setMetrics(Object.fromEntries(((m.data ?? []) as Metric[]).map((x) => [x.page_id, x])));
    setState("ok");
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div><p className="eyebrow mb-2">HP Pages</p><h1 className="text-3xl text-foreground">Páginas</h1>
          <p className="text-muted-foreground text-sm mt-1">Visitas e leads dos últimos 30 dias (por data da visita e do envio).</p></div>
        <button onClick={() => setShowNew(!showNew)} className="hp-btn hp-btn-primary">{showNew ? "Fechar" : "Nova página"}</button>
      </div>
      {showNew && <NewPage />}
      {state === "loading" && <p role="status" className="text-muted-foreground">Carregando…</p>}
      {state === "error" && <p role="alert" className="text-destructive">Sem permissão ou falha ao carregar.</p>}
      {state === "ok" && rows.length === 0 && <p className="hp-card p-6 text-muted-foreground">Nenhuma página criada ainda. Use “Nova página” e escolha um modelo.</p>}
      {state === "ok" && rows.length > 0 && (
        <div className="overflow-x-auto hp-card">
          <table className="w-full text-[15px]">
            <thead><tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
              <th className="p-3">Página</th><th className="p-3">Endereço</th><th className="p-3">Estado</th><th className="p-3 text-right">Visitas</th><th className="p-3 text-right">Leads</th><th className="p-3 text-right">Conversão</th>
            </tr></thead>
            <tbody>{rows.map((r) => {
              const m = metrics[r.id]; const v = Number(m?.visits ?? 0), l = Number(m?.leads ?? 0);
              return (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="p-3"><Link to={`/admin/paginas/${r.id}`} className="text-foreground underline-offset-2 hover:underline">{r.title}</Link></td>
                  <td className="p-3 text-muted-foreground">/{r.slug}</td>
                  <td className="p-3">{STATUS[r.status]}{r.status === "published" && r.publish_at && new Date(r.publish_at) > new Date() ? " (agendada)" : ""}</td>
                  <td className="p-3 text-right tabular">{v}</td><td className="p-3 text-right tabular">{l}</td>
                  <td className="p-3 text-right tabular">{v > 0 ? `${((l / v) * 100).toFixed(1)}%` : "indisponível"}</td>
                </tr>);
            })}</tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const NewPage = () => {
  const nav = useNavigate();
  const [tpl, setTpl] = useState(TEMPLATES[0].id);
  const [slug, setSlug] = useState(TEMPLATES[0].suggestedSlug);
  const [title, setTitle] = useState(TEMPLATES[0].name);
  const [unit, setUnit] = useState(""); const [pipe, setPipe] = useState("");
  const [units, setUnits] = useState<Unit[]>([]); const [pipes, setPipes] = useState<Pipeline[]>([]);
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from("units").select("id, name").eq("active", true).then(({ data }) => { setUnits(data ?? []); if (data?.length === 1) setUnit(data[0].id); });
    supabase.from("pipelines").select("id, name, kind").eq("active", true).then(({ data }) => setPipes((data ?? []) as Pipeline[]));
  }, []);
  // Trocar o modelo redefine título e endereço sugeridos; o carregamento dos funis NÃO pode sobrescrever o que a pessoa digitou.
  useEffect(() => { const t = TEMPLATES.find((x) => x.id === tpl)!; setSlug(t.suggestedSlug); setTitle(t.name); }, [tpl]);
  useEffect(() => { const t = TEMPLATES.find((x) => x.id === tpl)!; const p = pipes.find((x) => x.kind === t.pipelineKind); setPipe(p?.id ?? ""); }, [tpl, pipes]);

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    const se = validateSlug(slug); if (se) return setErr(se);
    if (!unit || !pipe) return setErr("Selecione a unidade e o funil de destino.");
    setBusy(true);
    const t = TEMPLATES.find((x) => x.id === tpl)!;
    const { data, error } = await supabase.rpc("page_create", { p_slug: slug, p_title: title, p_template: tpl, p_content: t.blocks, p_unit_id: unit, p_pipeline_id: pipe });
    setBusy(false);
    if (error) return setErr(error.code === "23505" ? "Já existe uma página com este endereço." : "Não foi possível criar a página. Verifique suas permissões.");
    nav(`/admin/paginas/${data as string}`);
  };

  return (
    <form onSubmit={submit} className="hp-card p-6 mb-8 grid gap-4 sm:grid-cols-2" noValidate>
      <div className="sm:col-span-2"><label htmlFor="tpl" className="block text-sm mb-1">Modelo</label>
        <select id="tpl" className={field} value={tpl} onChange={(e) => setTpl(e.target.value)}>
          {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name} — {t.purpose}</option>)}</select></div>
      <div><label htmlFor="ttl" className="block text-sm mb-1">Título</label><input id="ttl" className={field} value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      <div><label htmlFor="slg" className="block text-sm mb-1">Endereço (/…)</label><input id="slg" className={field} value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} /></div>
      <div><label htmlFor="un" className="block text-sm mb-1">Unidade</label>
        <select id="un" className={field} value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">Selecione…</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
      <div><label htmlFor="pp" className="block text-sm mb-1">Funil de destino</label>
        <select id="pp" className={field} value={pipe} onChange={(e) => setPipe(e.target.value)}><option value="">Selecione…</option>{pipes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
      {err && <p role="alert" className="sm:col-span-2 text-sm text-destructive">{err}</p>}
      <div className="sm:col-span-2"><button disabled={busy} className="hp-btn hp-btn-primary disabled:opacity-60">{busy ? "Criando…" : "Criar e editar"}</button></div>
    </form>
  );
};

export default Pages;
