import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { State, Table, Td } from "@/lib/ui";
import { SP_ZONES, SP_ZONE_LABEL } from "@/lib/spZones";
import LeadTypeBadge from "./LeadTypeBadge";
import { isLeadKind } from "./leadTypes";

interface ZoneDist { total_sp: number; sem_zona: number; zones: { zone: string; count: number; physios: number }[]; neighborhoods: { neighborhood: string; count: number }[] }
interface ZoneContact { person_id: string; full_name: string; phone: string | null; email: string | null; neighborhood: string | null; zone: string | null; kinds: string[] }

/** Contatos do CRM que moram na capital paulista, por zona (Sul, Norte, Leste, Oeste, Centro): onde atender os pacientes e de onde vêm os parceiros. Mostra também quantos fisioterapeutas
 *  ativos dizem atender cada zona (cadastro de onboarding). Cadastros antigos, sem bairro/zona, aparecem em “Sem zona informada” — nada é deduzido. */
const CrmZoneSection = ({ kind, unit }: { kind: string; unit: string }) => {
  const [zone, setZone] = useState<string | null>(null);
  const dist = useQuery({
    queryKey: ["crm-zones", kind, unit],
    queryFn: async () => { const { data, error } = await supabase.rpc("crm_zone_distribution", { p_kind: kind || null, p_unit: unit || null }); if (error) throw error; return data as ZoneDist; },
  });
  const contacts = useQuery({
    queryKey: ["crm-zone-contacts", zone, kind, unit], enabled: !!zone,
    queryFn: async () => { const { data, error } = await supabase.rpc("crm_zone_contacts", { p_zone: zone, p_kind: kind || null, p_unit: unit || null }); if (error) throw error; return data as ZoneContact[]; },
  });
  const d = dist.data;
  return (
    <section className="mt-6" data-testid="crm-zonas" aria-label="Zonas de São Paulo">
      <h3 className="text-sm font-medium mb-1">Zonas de São Paulo (capital)</h3>
      <p className="text-xs text-muted-foreground mb-3">Contatos do CRM que informaram morar em São Paulo/SP. Clique numa zona para ver quem é.</p>
      <State loading={dist.isLoading} error={dist.error} empty={d?.total_sp === 0} emptyText="Nenhum contato de São Paulo capital no CRM ainda." />
      {d && d.total_sp > 0 && (<>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          {SP_ZONES.map((z) => { const r = d.zones.find((x) => x.zone === z.id); return (
            <button key={z.id} type="button" aria-pressed={zone === z.id} onClick={() => setZone(zone === z.id ? null : z.id)} className={`hp-card p-3 text-left ${zone === z.id ? "border-2 border-primary" : ""}`} data-testid={`crm-zona-${z.id}`}>
              <p className="text-xs text-muted-foreground">{z.label}</p><p className="text-2xl font-extrabold tabular">{r?.count ?? 0}</p>
              <p className="text-[11px] text-muted-foreground">{r?.physios ?? 0} fisioterapeuta(s) atendem</p>
            </button>); })}
          <button type="button" aria-pressed={zone === "none"} onClick={() => setZone(zone === "none" ? null : "none")} className={`hp-card p-3 text-left ${zone === "none" ? "border-2 border-primary" : ""}`} data-testid="crm-zona-none">
            <p className="text-xs text-muted-foreground">Sem zona informada</p><p className="text-2xl font-extrabold tabular">{d.sem_zona}</p><p className="text-[11px] text-muted-foreground">cadastros anteriores</p>
          </button>
        </div>
        {d.neighborhoods.length > 0 && <p className="text-xs text-muted-foreground mt-3">Bairros mais citados: {d.neighborhoods.map((n) => `${n.neighborhood} (${n.count})`).join(" · ")}</p>}
        {zone && (
          <div className="hp-card p-4 mt-3" data-testid="crm-zona-contatos">
            <h4 className="text-sm font-medium mb-2">{zone === "none" ? "Sem zona informada" : SP_ZONE_LABEL[zone]}{contacts.data ? ` (${contacts.data.length})` : ""}</h4>
            <State loading={contacts.isLoading} error={contacts.error} empty={contacts.data?.length === 0} emptyText="Nenhum contato nesta zona." />
            {contacts.data && contacts.data.length > 0 && (
              <Table head={["Nome", "Bairro", "Telefone", "E-mail", "Tipo"]}>
                {contacts.data.map((c) => (
                  <tr key={c.person_id}>
                    <Td><Link className="text-accent hover:underline font-medium" to={`/admin/pessoas?q=${encodeURIComponent(c.full_name)}`}>{c.full_name}</Link></Td>
                    <Td>{c.neighborhood ?? <span className="text-muted-foreground">—</span>}</Td>
                    <Td>{c.phone ? <a className="hover:underline" href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}>{c.phone}</a> : <span className="text-muted-foreground">—</span>}</Td>
                    <Td>{c.email ? <a className="hover:underline break-all" href={`mailto:${c.email}`}>{c.email}</a> : <span className="text-muted-foreground">—</span>}</Td>
                    <Td>{c.kinds.filter(isLeadKind).map((k) => <LeadTypeBadge key={k} kind={k} short />)}</Td>
                  </tr>))}
              </Table>)}
          </div>)}
      </>)}
    </section>
  );
};

export default CrmZoneSection;
