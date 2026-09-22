import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/lib/supabase";
import { EmptyState, State, Table, Tabs, Td } from "@/lib/ui";

interface Geo { total: number; sem_localizacao: number; by_state: { uf: string; count: number; pct: number }[]; by_city: { city: string; uf: string; count: number }[] }

const SEG_LABEL: Record<string, string> = { patient: "Pacientes", partner: "Parceiros/fisioterapeutas", student: "Alunos do Academy" };
const SEG: [string, string][] = [["patient", SEG_LABEL.patient], ["partner", SEG_LABEL.partner], ["student", SEG_LABEL.student]];
const SEG_ROUTE: Record<string, string> = { patient: "/admin/pessoas?tipo=patient", partner: "/admin/parceiros", student: "/admin/academy" };

/** Distribuição geográfica: mesma pessoa pode estar em mais de um segmento (é contada uma vez dentro de cada um).
 *  Localização = cidade/UF cadastrados em people (sem IP, sem geolocalização do navegador). Sem lib de mapa instalada nesta
 *  sessão — a tabela/ranking já é a alternativa acessível pedida; um mapa visual fica como próximo passo (pediria aprovação
 *  para adicionar uma dependência de mapa antes de instalar). */
const GeoSection = ({ unit }: { unit: string }) => {
  const [seg, setSeg] = useState<"patient" | "partner" | "student">("patient");
  const geo = useQuery({ queryKey: ["geo", seg, unit], queryFn: async () => { const { data, error } = await supabase.rpc("geo_distribution", { p_kind: seg, p_unit: unit || null }); if (error) throw error; return data as Geo; } });
  const chart = (geo.data?.by_state ?? []).slice(0, 10).map((s) => ({ uf: s.uf, Pessoas: s.count }));

  return (
    <section className="mb-8">
      <h2 className="text-xl mb-1">Distribuição geográfica</h2>
      <p className="text-sm text-muted-foreground mb-3">Por cidade/UF cadastrados. Uma pessoa pode aparecer em mais de um segmento (ex.: paciente que também é aluno) — dentro de cada segmento, é contada uma única vez.</p>
      <Tabs tabs={SEG} value={seg} onChange={(v) => setSeg(v as typeof seg)} />
      <State loading={geo.isLoading} error={geo.error} />
      {geo.data && geo.data.total === 0 && <EmptyState title={`Nenhum(a) ${SEG_LABEL[seg].toLowerCase()} cadastrado(a) ainda`}>
        <Link to={SEG_ROUTE[seg]} className="text-accent hover:underline">Ir para o cadastro</Link>
      </EmptyState>}
      {geo.data && geo.data.total > 0 && (
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div>
            {chart.length > 0 ? (
              <div className="hp-card p-4 mb-3" style={{ height: 220 }}><ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis type="number" fontSize={12} allowDecimals={false} /><YAxis type="category" dataKey="uf" fontSize={12} width={36} />
                  <Tooltip /><Bar dataKey="Pessoas" fill="hsl(var(--primary))" radius={[0, 3, 3, 0]} /></BarChart></ResponsiveContainer></div>
            ) : <p className="text-sm text-muted-foreground hp-card p-4 mb-3">Ninguém com estado cadastrado ainda neste segmento.</p>}
            {geo.data.by_city.length > 0 && <Table head={["Cidade", "UF", "Pessoas"]} right={[2]}>
              {geo.data.by_city.map((c) => <tr key={c.city + c.uf}><Td>{c.city}</Td><Td>{c.uf}</Td><Td num>{c.count}</Td></tr>)}</Table>}
          </div>
          <div className="hp-card p-4 self-start">
            <p className="text-sm"><strong className="tabular">{geo.data.total}</strong> no total</p>
            <p className="text-sm text-muted-foreground mt-1"><strong className="tabular">{geo.data.sem_localizacao}</strong> sem cidade/UF cadastrado{geo.data.sem_localizacao > 0 && <> — <Link to={SEG_ROUTE[seg]} className="text-accent hover:underline">completar cadastro</Link></>}</p>
            {geo.data.by_state.length > 0 && (
              <ul className="mt-3 text-sm space-y-1">
                {geo.data.by_state.slice(0, 6).map((s) => <li key={s.uf} className="flex justify-between"><span>{s.uf}</span><span className="tabular text-muted-foreground">{s.count} ({s.pct}%)</span></li>)}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
};

export default GeoSection;
