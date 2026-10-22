import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { LevelSection, Tabs } from "@/lib/ui";
import { GeoView, type Geo } from "../GeoSection";
import { LEAD_KINDS, LEAD_TYPE } from "./leadTypes";

const TABS: [string, string][] = [["", "Todos os contatos"], ...LEAD_KINDS.map((k) => [k, LEAD_TYPE[k].short] as [string, string])];

/** Distribuição geográfica dos contatos do CRM (pessoas com oportunidade), por tipo de lead. Local = cidade/UF do cadastro da pessoa (que o quiz também preenche);
 *  em funil de empresas, o local da empresa. `uf`/`onUf` deixam a tela que a hospeda (ex.: Contatos) filtrar a lista pelo estado clicado no mapa. */
const CrmGeoSection = ({ unit, uf, onUf }: { unit: string; uf?: string | null; onUf?: (uf: string | null) => void }) => {
  const [kind, setKind] = useState("");
  const [own, setOwn] = useState<string | null>(null);
  const selected = uf !== undefined ? uf : own; const select = (v: string | null) => (onUf ? onUf(v) : setOwn(v));
  const geo = useQuery({
    queryKey: ["crm-geo", kind, unit],
    queryFn: async () => { const { data, error } = await supabase.rpc("crm_geo_distribution", { p_kind: kind || null, p_unit: unit || null }); if (error) throw error; return data as Geo; },
  });
  return (
    <LevelSection level="analysis" title="Distribuição geográfica" label="Onde estão os contatos" hint="Pelos contatos que estão no CRM (pessoas com oportunidade), segundo a cidade e o estado do cadastro — que o quiz também preenche. Cada contato conta uma vez dentro de cada tipo de lead.">
      <div data-testid="crm-geo">
        <Tabs tabs={TABS} value={kind} onChange={(v) => { setKind(v); select(null); }} />
        <GeoView geo={geo.data} loading={geo.isLoading} error={geo.error} selectedUf={selected} onSelectUf={select} noun="contato(s)" countLabel="Contatos"
          emptyTitle={kind ? `Nenhum contato de ${LEAD_TYPE[kind as keyof typeof LEAD_TYPE].short.toLowerCase()} no CRM ainda` : "Nenhum contato no CRM ainda"} route="/admin/crm/leads" routeLabel="Ir para a Gestão de leads" missing="sem cidade/estado no cadastro" completeRoute="/admin/pessoas" />
      </div>
    </LevelSection>
  );
};

export default CrmGeoSection;
