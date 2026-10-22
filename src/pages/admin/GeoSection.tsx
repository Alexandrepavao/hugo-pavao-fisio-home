import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import BrazilMap from "@/components/hp/BrazilMap";
import { supabase } from "@/lib/supabase";
import { EmptyState, LevelSection, State, Table, Tabs, Td } from "@/lib/ui";

export interface Geo { total: number; sem_localizacao: number; by_state: { uf: string; count: number; pct: number }[]; by_city: { city: string; uf: string; count: number }[]; by_country_other: { country: string; count: number }[] }

const SEG_LABEL: Record<string, string> = { patient: "Pacientes", partner: "Parceiros/fisioterapeutas", student: "Alunos do Academy" };
const SEG: [string, string][] = [["patient", SEG_LABEL.patient], ["partner", SEG_LABEL.partner], ["student", SEG_LABEL.student]];
const SEG_ROUTE: Record<string, string> = { patient: "/admin/pessoas?tipo=patient", partner: "/admin/parceiros", student: "/admin/academy" };

/** Mapa + estados + cidades de uma distribuição (usado aqui, no Hub, e no CRM). `route` = para onde mandar quem quer completar o cadastro/ver a lista. */
export const GeoView = ({ geo, loading, error, selectedUf, onSelectUf, emptyTitle, route, routeLabel, noun = "pessoa(s)", countLabel = "Pessoas", missing, completeRoute }: {
  geo: Geo | undefined; loading: boolean; error: unknown; selectedUf: string | null; onSelectUf: (uf: string | null) => void;
  emptyTitle: string; route: string; routeLabel: string; noun?: string; countLabel?: string; missing?: string; completeRoute?: string;
}) => {
  const chart = (geo?.by_state ?? []).slice(0, 10).map((s) => ({ uf: s.uf, [countLabel]: s.count }));
  const cityRows = useMemo(() => selectedUf ? (geo?.by_city ?? []).filter((c) => c.uf === selectedUf) : (geo?.by_city ?? []), [geo, selectedUf]);
  return (
    <>
      <State loading={loading} error={error} />
      {geo && geo.total === 0 && <EmptyState title={emptyTitle}>
        <Link to={route} className="text-accent hover:underline">{routeLabel}</Link>
      </EmptyState>}
      {geo && geo.total > 0 && (
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]" data-testid="geo-view">
          <div>
            {geo.by_state.length > 0 ? (
              <div className="hp-card p-4 mb-3"><BrazilMap data={geo.by_state} selected={selectedUf} onSelect={onSelectUf} noun={noun} /></div>
            ) : <p className="text-sm text-muted-foreground hp-card p-4 mb-3">Ninguém com estado cadastrado ainda neste segmento.</p>}
            {chart.length > 0 && (
              <div className="hp-card p-4 mb-3" style={{ height: 220 }}><ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" /><XAxis type="number" fontSize={12} allowDecimals={false} /><YAxis type="category" dataKey="uf" fontSize={12} width={36} />
                  <Tooltip /><Bar dataKey={countLabel} fill="hsl(var(--chart-1))" radius={[0, 3, 3, 0]} /></BarChart></ResponsiveContainer></div>
            )}
            <h3 className="text-sm font-medium mb-2">{selectedUf ? `Cidades em ${selectedUf}` : "Cidades (todas as UFs)"}</h3>
            {cityRows.length > 0 ? <Table head={["Cidade", "UF", countLabel]} right={[2]}>
              {cityRows.map((c) => <tr key={c.city + c.uf}><Td>{c.city}</Td><Td>{c.uf}</Td><Td num>{c.count}</Td></tr>)}</Table>
              : <p className="text-sm text-muted-foreground hp-card p-3">{selectedUf ? "Nenhuma cidade cadastrada para este estado." : "Nenhuma cidade cadastrada ainda."}</p>}
          </div>
          <div className="hp-card p-4 self-start">
            <p className="text-sm"><strong className="tabular">{geo.total}</strong> no total</p>
            <p className="text-sm text-muted-foreground mt-1"><strong className="tabular">{geo.sem_localizacao}</strong> {missing ?? "sem cidade/UF/país cadastrado"}{geo.sem_localizacao > 0 && <> — <Link to={completeRoute ?? route} className="text-accent hover:underline">completar cadastro</Link></>}</p>
            {geo.by_state.length > 0 && (
              <ul className="mt-3 text-sm space-y-1">
                {geo.by_state.slice(0, 6).map((s) => <li key={s.uf}><button className={`flex justify-between w-full text-left ${selectedUf === s.uf ? "font-semibold text-accent" : ""}`} onClick={() => onSelectUf(selectedUf === s.uf ? null : s.uf)}><span>{s.uf}</span><span className="tabular text-muted-foreground">{s.count} ({s.pct}%)</span></button></li>)}
              </ul>
            )}
            {geo.by_country_other.length > 0 && (
              <div className="mt-4 pt-3 border-t border-border">
                <p className="text-xs text-muted-foreground mb-1">Fora do Brasil</p>
                <ul className="text-sm space-y-1">{geo.by_country_other.map((c) => <li key={c.country} className="flex justify-between"><span>{c.country}</span><span className="tabular text-muted-foreground">{c.count}</span></li>)}</ul>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

/** Distribuição geográfica: mesma pessoa pode estar em mais de um segmento (é contada uma vez dentro de cada um).
 *  Localização = cidade/UF/país cadastrados em people (sem IP, sem geolocalização do navegador, nunca enviado a
 *  serviço externo — o mapa usa geometria estática embutida no pacote). */
const GeoSection = ({ unit }: { unit: string }) => {
  const [seg, setSeg] = useState<"patient" | "partner" | "student">("patient");
  const [selectedUf, setSelectedUf] = useState<string | null>(null);
  const geo = useQuery({ queryKey: ["geo", seg, unit], queryFn: async () => { const { data, error } = await supabase.rpc("geo_distribution", { p_kind: seg, p_unit: unit || null }); if (error) throw error; return data as Geo; } });

  return (
    <LevelSection level="analysis" title="Distribuição geográfica" hint="Por cidade/UF/país cadastrados. Uma pessoa pode aparecer em mais de um segmento (ex.: paciente que também é aluno) — dentro de cada segmento, é contada uma única vez.">
      <Tabs tabs={SEG} value={seg} onChange={(v) => { setSeg(v as typeof seg); setSelectedUf(null); }} />
      <GeoView geo={geo.data} loading={geo.isLoading} error={geo.error} selectedUf={selectedUf} onSelectUf={setSelectedUf}
        emptyTitle={`Nenhum(a) ${SEG_LABEL[seg].toLowerCase()} cadastrado(a) ainda`} route={SEG_ROUTE[seg]} routeLabel="Ir para o cadastro" />
    </LevelSection>
  );
};

export default GeoSection;
