import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Badge, EmptyState, State } from "@/lib/ui";
import { Formula } from "@/lib/IndicatorCharts";
import BrazilMap from "@/components/hp/BrazilMap";

interface Geo { total: number; sem_localizacao: number; by_state: { uf: string; count: number; pf: number; pj: number; pct: number | null }[]; basis: string }
interface Row { id: string; type: "pf" | "pj"; name: string; city: string | null; uf: string | null; status: string }
const STATUS: Record<string, string> = { ativo: "Ativo", pendente: "Pendente", inativo: "Inativo" };
const n = (v: number) => v.toLocaleString("pt-BR");

/** Mapa do Brasil do Administrativo: cadastro central (PF + PJ) por estado, no mesmo escopo de unidade do painel (RPC adm_geo). Clicar num estado lista os cadastros dele
 *  (mesma regra da lista do Diretório, RPC adm_directory com p_uf) e leva ao Diretório já filtrado. Sem dado fictício: estado sem cadastro fica neutro. */
const AdmMapa = ({ unit }: { unit: string }) => {
  const [uf, setUf] = useState<string | null>(null);
  const geo = useQuery({ queryKey: ["adm-geo", unit], queryFn: async () => { const { data, error } = await supabase.rpc("adm_geo", { p_unit: unit || null }); if (error) throw error; return data as Geo; } });
  const list = useQuery({ queryKey: ["adm-geo-list", unit, uf], enabled: !!uf, queryFn: async () => {
    const { data, error } = await supabase.rpc("adm_directory", { p_unit: unit || null, p_uf: uf, p_sort: "name", p_dir: "asc", p_page: 0, p_page_size: 8 });
    if (error) throw error; return data as { rows: Row[]; total: number };
  } });
  const g = geo.data;
  const sel = g?.by_state.find((s) => s.uf === uf);
  const dirLink = (q: string) => `/admin/adm/diretorio?${q}${unit ? `&unidade=${unit}` : ""}`;

  return (
    <section className="hp-card p-4 mt-4" aria-label="Cadastros por estado">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[0.9375rem] font-semibold">Cadastros por estado</h3>
        <p className="text-xs text-muted-foreground">Pessoas físicas e jurídicas pelo estado do cadastro. Clique num estado para ver os cadastros.</p>
      </div>
      <State loading={geo.isLoading} error={geo.error} />
      {g && g.total === 0 && <EmptyState title="Nenhum cadastro neste recorte ainda.">Cadastre pessoas ou empresas no Diretório para ver a distribuição.</EmptyState>}
      {g && g.total > 0 && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] mt-3">
          <div>
            {g.by_state.length > 0
              ? <BrazilMap data={g.by_state} selected={uf} onSelect={setUf} noun="cadastros" />
              : <p className="text-sm text-muted-foreground py-6">Nenhum cadastro tem estado informado ainda. Complete os cadastros para ver o mapa.</p>}
          </div>
          <div className="min-w-0">
            <p className="text-sm"><strong className="tabular">{n(g.total)}</strong> cadastros no recorte · <strong className="tabular">{n(g.sem_localizacao)}</strong> sem estado informado{g.sem_localizacao > 0 && <> — <Link className="text-accent hover:underline" to={dirLink("incompleto=1")}>completar</Link></>}</p>
            {g.by_state.length > 0 && (
              <ul className="mt-2 text-sm divide-y divide-border" aria-label="Ranking por estado">
                {g.by_state.slice(0, 6).map((s) => (
                  <li key={s.uf}><button type="button" aria-pressed={uf === s.uf} onClick={() => setUf(uf === s.uf ? null : s.uf)}
                    className={`w-full flex items-center justify-between gap-2 py-1.5 text-left hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${uf === s.uf ? "font-semibold text-accent" : ""}`}>
                    <span>{s.uf}</span><span className="tabular text-muted-foreground">{n(s.count)}{s.pct != null && ` (${String(s.pct).replace(".", ",")}%)`}</span></button></li>
                ))}
              </ul>
            )}
            {uf && (
              <div className="mt-3 rounded-md border border-border bg-muted/40 p-3" role="region" aria-label={`Cadastros de ${uf}`} aria-live="polite">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{uf}{sel ? ` · ${n(sel.count)} cadastro(s) (${sel.pf} PF, ${sel.pj} PJ)` : " · sem cadastros"}</p>
                  <button type="button" className="text-xs text-accent hover:underline" onClick={() => setUf(null)}>Limpar seleção</button>
                </div>
                <State loading={list.isLoading} error={list.error} />
                {list.data && list.data.rows.length === 0 && <p className="text-sm text-muted-foreground mt-1">Nenhum cadastro neste estado no recorte.</p>}
                {list.data && list.data.rows.length > 0 && (
                  <ul className="mt-2 text-sm divide-y divide-border">
                    {list.data.rows.map((r) => (
                      <li key={r.type + r.id} className="flex items-center justify-between gap-2 py-1.5">
                        <span className="min-w-0"><span className="block truncate font-medium">{r.name}</span><span className="block text-xs text-muted-foreground truncate">{r.city ?? "—"}</span></span>
                        <span className="flex gap-1 shrink-0"><Badge tone="info">{r.type === "pj" ? "PJ" : "PF"}</Badge><Badge>{STATUS[r.status] ?? r.status}</Badge></span>
                      </li>))}
                  </ul>
                )}
                {list.data && list.data.total > 0 && <Link className="inline-block mt-2 text-sm text-accent hover:underline" to={dirLink(`uf=${uf}`)}>Ver os {n(list.data.total)} no Diretório →</Link>}
              </div>
            )}
          </div>
        </div>
      )}
      {g && <div className="mt-2"><Formula>{g.basis}</Formula></div>}
    </section>
  );
};

export default AdmMapa;
