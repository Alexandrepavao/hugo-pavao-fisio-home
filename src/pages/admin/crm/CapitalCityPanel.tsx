import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Badge, State, Table, Td } from "@/lib/ui";
import { loadCityGeo, zoneLabel, type CapitalMeta, type CityGeo } from "@/lib/capitals";
import CityZoneMap from "@/components/hp/CityZoneMap";
import LeadTypeBadge from "./LeadTypeBadge";
import { isLeadKind } from "./leadTypes";

export interface CityContact { person_id: string; full_name: string; phone: string | null; email: string | null; neighborhood: string | null; zone: string | null; kinds: string[] }

/** Painel que desce logo abaixo da linha de uma capital liberada (São Paulo, Rio de Janeiro…): mapa das zonas (quantos contatos informaram cada uma) e a lista de quem é, com a zona e o bairro que cada
 *  pessoa cadastrou. Clicar numa zona do mapa (ou no filtro) mostra só os contatos dela; “Sem zona informada” = cadastros em que a zona nunca foi perguntada (nada é deduzido). */
const CapitalCityPanel = ({ capital, kind, unit, onClose, onOpenPerson }: { capital: CapitalMeta; kind: string; unit: string; onClose: () => void; onOpenPerson: (c: CityContact) => void }) => {
  const [zone, setZone] = useState<string | null>(null); const [geo, setGeo] = useState<CityGeo | null>(null);
  useEffect(() => { let on = true; void loadCityGeo(capital).then((g) => { if (on) setGeo(g); }); return () => { on = false; }; }, [capital]);
  const q = useQuery({
    queryKey: ["crm-capital-contacts", capital.key, capital.uf, kind, unit],
    queryFn: async () => { const { data, error } = await supabase.rpc("crm_capital_contacts", { p_city_key: capital.key, p_uf: capital.uf, p_kind: kind || null, p_unit: unit || null }); if (error) throw error; return data as CityContact[]; },
  });
  const all = q.data ?? [];
  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const p of all) if (p.zone) c[p.zone] = (c[p.zone] ?? 0) + 1; return c; }, [all]);
  const semZona = all.filter((p) => !p.zone).length;
  const shown = zone === "none" ? all.filter((p) => !p.zone) : zone ? all.filter((p) => p.zone === zone) : all;
  const chip = (id: string | null, label: string, n: number) => (
    <button key={id ?? "all"} type="button" aria-pressed={zone === id} onClick={() => setZone(id)} data-testid={`sp-filtro-${id ?? "todas"}`}
      className={`h-8 px-3 rounded-full border text-[12.5px] font-medium ${zone === id ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:text-foreground"}`}>{label} <span className="tabular opacity-80">{n}</span></button>);
  return (
    <section className="hp-card p-4" data-testid="geo-cidade-contatos" aria-label={`Contatos em ${capital.name} por zona`}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className="text-sm font-medium">Contatos em {capital.name}/{capital.uf}{q.data ? ` (${all.length})` : ""} — por zona</h3>
        <button type="button" className="text-accent hover:underline text-sm" onClick={onClose}>fechar</button>
      </div>
      <p className="text-xs text-muted-foreground mb-3">A zona é a que cada pessoa informou ao se cadastrar. Clique numa zona do mapa para ver só quem a escolheu.</p>
      <State loading={q.isLoading} error={q.error} empty={q.data?.length === 0} emptyText={`Nenhum contato de ${capital.name} neste filtro.`} />
      {q.data && q.data.length > 0 && (
        <div className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] items-start">
            <div>
              {geo ? <CityZoneMap map={geo.map} zones={capital.zones} counts={counts} selected={zone && zone !== "none" ? zone : null} onSelect={setZone} cityName={capital.name} /> : <div className="h-56 rounded-lg bg-muted/40 animate-pulse" aria-hidden />}
              <p className="text-[11px] text-muted-foreground mt-1">Mapa por zona, simplificado. Quanto mais escuro, mais contatos. {geo?.credit}</p>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground mb-2">Filtrar a lista por zona</p>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por zona">
                {chip(null, "Todas", all.length)}
                {capital.zones.map((z) => chip(z.id, z.label, counts[z.id] ?? 0))}
                {chip("none", "Sem zona informada", semZona)}
              </div>
              <p className="text-[12.5px] mt-3" data-testid="sp-resumo"><b className="tabular">{all.length - semZona}</b> de <b className="tabular">{all.length}</b> contatos informaram a zona; {semZona > 0 ? <><b className="tabular">{semZona}</b> ainda não (cadastros antigos ou sem formulário).</> : "todos informaram."}</p>
            </div>
          </div>
          {shown.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum contato nesta zona.</p> : (
            <div className="max-h-[26rem] overflow-y-auto rounded-xl" data-testid="sp-lista">
              <Table head={["Nome", "Zona", "Bairro", "Telefone", "E-mail", "Tipo"]}>
                {shown.map((c) => (
                  <tr key={c.person_id} data-testid="sp-contato">
                    <Td><button type="button" className="text-accent hover:underline font-medium text-left" onClick={() => onOpenPerson(c)} aria-label={`Ver formulário e dados de ${c.full_name}`}>{c.full_name}</button></Td>
                    <Td>{c.zone ? <Badge tone="info">{zoneLabel(c.zone)}</Badge> : <span className="text-muted-foreground text-xs">Não informada</span>}</Td>
                    <Td>{c.neighborhood ?? <span className="text-muted-foreground">—</span>}</Td>
                    <Td className="whitespace-nowrap">{c.phone ? <a className="hover:underline" href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}>{c.phone}</a> : <span className="text-muted-foreground">—</span>}</Td>
                    <Td>{c.email ? <a className="hover:underline break-all" href={`mailto:${c.email}`}>{c.email}</a> : <span className="text-muted-foreground">—</span>}</Td>
                    <Td>{c.kinds.filter(isLeadKind).map((k) => <LeadTypeBadge key={k} kind={k} short />)}</Td>
                  </tr>))}
              </Table>
            </div>)}
        </div>)}
    </section>
  );
};
export default CapitalCityPanel;
