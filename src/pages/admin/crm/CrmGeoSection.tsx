import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { LevelSection, State, Table, Tabs, Td } from "@/lib/ui";
import PersonFormAnswers from "@/components/hp/PersonFormAnswers";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { GeoView, type Geo } from "../GeoSection";
import LeadTypeBadge from "./LeadTypeBadge";
import { LEAD_KINDS, LEAD_TYPE, isLeadKind } from "./leadTypes";

const TABS: [string, string][] = [["", "Todos os contatos"], ...LEAD_KINDS.map((k) => [k, LEAD_TYPE[k].short] as [string, string])];

interface CityContact { person_id: string; full_name: string; phone: string | null; email: string | null; city: string; state_uf: string; kinds: string[]; is_company: boolean }
interface CityPick { city: string; uf: string; key: string }

/** Distribuição geográfica dos contatos do CRM (pessoas com oportunidade), por tipo de lead. Local = cidade/UF do cadastro da pessoa (que o quiz também preenche);
 *  em funil de empresas, o local da empresa. Grafias diferentes da mesma cidade ("São Paulo", "sao paulo") contam juntas. Clicar numa cidade lista os contatos dela
 *  (nome, telefone, e-mail); clicar no nome abre o que a pessoa preencheu. `uf`/`onUf` deixam a tela que a hospeda (ex.: Contatos) filtrar a lista pelo estado do mapa. */
const CrmGeoSection = ({ unit, uf, onUf }: { unit: string; uf?: string | null; onUf?: (uf: string | null) => void }) => {
  const [kind, setKind] = useState("");
  const [own, setOwn] = useState<string | null>(null);
  const [city, setCity] = useState<CityPick | null>(null);
  const [who, setWho] = useState<CityContact | null>(null);
  const selected = uf !== undefined ? uf : own; const select = (v: string | null) => { setCity(null); if (onUf) onUf(v); else setOwn(v); };
  const geo = useQuery({
    queryKey: ["crm-geo", kind, unit],
    queryFn: async () => { const { data, error } = await supabase.rpc("crm_geo_distribution", { p_kind: kind || null, p_unit: unit || null }); if (error) throw error; return data as Geo; },
  });
  const contacts = useQuery({
    queryKey: ["crm-geo-contacts", city?.key, city?.uf, kind, unit], enabled: !!city,
    queryFn: async () => { const { data, error } = await supabase.rpc("crm_geo_contacts", { p_city_key: city!.key, p_uf: city!.uf, p_kind: kind || null, p_unit: unit || null }); if (error) throw error; return data as CityContact[]; },
  });

  const panel = city && (
    <section className="hp-card p-4 mt-3" data-testid="geo-cidade-contatos" aria-label={`Contatos em ${city.city}`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-sm font-medium">Contatos em {city.city}/{city.uf}{contacts.data ? ` (${contacts.data.length})` : ""}</h3>
        <button type="button" className="text-accent hover:underline text-sm" onClick={() => setCity(null)}>fechar</button>
      </div>
      <State loading={contacts.isLoading} error={contacts.error} empty={contacts.data?.length === 0} emptyText="Nenhum contato encontrado nesta cidade." />
      {contacts.data && contacts.data.length > 0 && (
        <Table head={["Nome", "Telefone", "E-mail", "Tipo"]}>
          {contacts.data.map((c) => (
            <tr key={c.person_id + c.full_name}>
              <Td><button type="button" className="text-accent hover:underline font-medium text-left" onClick={() => setWho(c)} aria-label={`Ver formulário e dados de ${c.full_name}`}>{c.full_name}</button></Td>
              <Td>{c.phone ? <a className="hover:underline" href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}>{c.phone}</a> : <span className="text-muted-foreground">—</span>}</Td>
              <Td>{c.email ? <a className="hover:underline break-all" href={`mailto:${c.email}`}>{c.email}</a> : <span className="text-muted-foreground">—</span>}</Td>
              <Td>{c.kinds.filter(isLeadKind).map((k) => <LeadTypeBadge key={k} kind={k} short />)}</Td>
            </tr>
          ))}
        </Table>
      )}
    </section>
  );

  return (
    <LevelSection level="analysis" title="Distribuição geográfica" label="Onde estão os contatos" hint="Pelos contatos que estão no CRM (pessoas com oportunidade), segundo a cidade e o estado do cadastro — que o quiz também preenche. Cada contato conta uma vez dentro de cada tipo de lead. Clique numa cidade para ver os contatos dela.">
      <div data-testid="crm-geo">
        <Tabs tabs={TABS} value={kind} onChange={(v) => { setKind(v); setCity(null); select(null); }} />
        <GeoView geo={geo.data} loading={geo.isLoading} error={geo.error} selectedUf={selected} onSelectUf={select} noun="contato(s)" countLabel="Contatos"
          emptyTitle={kind ? `Nenhum contato de ${LEAD_TYPE[kind as keyof typeof LEAD_TYPE].short.toLowerCase()} no CRM ainda` : "Nenhum contato no CRM ainda"} route="/admin/crm/leads" routeLabel="Ir para a Gestão de leads" missing="sem cidade/estado no cadastro" completeRoute="/admin/pessoas"
          onCity={(c) => c.key && setCity({ city: c.city, uf: c.uf, key: c.key })} selectedCityKey={city?.key ?? null} cityPanel={panel} />
      </div>
      <Sheet open={!!who} onOpenChange={(o) => { if (!o) setWho(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col gap-0" data-testid="geo-contato-detalhe">
          <SheetHeader className="px-5 pt-5 pb-3 border-b border-border text-left space-y-1.5">
            <SheetTitle className="text-[1.0625rem]">{who?.full_name}</SheetTitle>
            <SheetDescription>{who ? `${who.city}/${who.state_uf}` : ""}{who?.phone ? ` · ${who.phone}` : ""}{who?.email ? ` · ${who.email}` : ""}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-5 py-5 grid gap-4">
            {who && <PersonFormAnswers personId={who.person_id} empty="Esta pessoa não preencheu formulário (quiz ou página): o contato veio por outro caminho." />}
            {who && <Link className="hp-btn hp-btn-outline w-fit" to={`/admin/pessoas?q=${encodeURIComponent(who.full_name)}`}>Ver cadastro</Link>}
          </div>
        </SheetContent>
      </Sheet>
    </LevelSection>
  );
};

export default CrmGeoSection;
