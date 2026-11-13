import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { loadCityGeo, type CapitalMeta, type CityGeo } from "@/lib/capitals";

export type WrapProps = { id: string; label: string; error?: string; hint?: string; className?: string; children: ReactNode };
const OUTRO = "__outro__";

/** Bairro + zona de uma capital liberada (quiz e cadastros). Capital com lista de bairros (ex.: Rio de Janeiro): a pessoa ESCOLHE o bairro e a zona vem junto, sem erro de digitação; “Outro bairro” abre
 *  um campo livre e a zona passa a ser escolhida na lista. Capital sem lista (São Paulo): bairro digitado e zona escolhida, como sempre foi. O pai guarda só `neighborhood` e `zone`. */
export const BairroZonaFields = ({ capital, neighborhood, zone, onChange, ids, inputClass, Wrap, errors = {}, className = {} }: {
  capital: CapitalMeta; neighborhood: string; zone: string; onChange: (neighborhood: string, zone: string) => void;
  ids: { neigh: string; zone: string }; inputClass: string; Wrap: ComponentType<WrapProps>; errors?: { neighborhood?: string; zone?: string }; className?: { neigh?: string; zone?: string };
}) => {
  const [geo, setGeo] = useState<CityGeo | null>(null); const [outro, setOutro] = useState(false);
  useEffect(() => { let on = true; if (capital.hasBairroList) void loadCityGeo(capital).then((g) => { if (on) setGeo(g); }); return () => { on = false; }; }, [capital]);
  const zoneOf = useMemo(() => new Map((geo?.neighborhoods ?? []).map(([n, z]) => [n.toLowerCase(), z])), [geo]);
  const inList = !!neighborhood && zoneOf.has(neighborhood.toLowerCase());
  // zona de outra cidade (a pessoa trocou de capital): limpa; bairro que veio do CEP e está na lista: zona preenchida sozinha
  useEffect(() => { if (zone && !capital.zones.some((z) => z.id === zone)) onChange(neighborhood, ""); }, [capital, zone, neighborhood, onChange]);
  useEffect(() => { if (capital.hasBairroList && geo && inList && !outro) { const z = zoneOf.get(neighborhood.toLowerCase()) ?? ""; if (z && z !== zone) onChange(neighborhood, z); } }, [capital, geo, inList, outro, neighborhood, zone, zoneOf, onChange]);
  const zoneSelect = (disabled: boolean) => (
    <select id={ids.zone} className={inputClass} value={zone} disabled={disabled} onChange={(e) => onChange(neighborhood, e.target.value)} aria-invalid={!!errors.zone} required>
      <option value="">{disabled ? "Preenchida pelo bairro" : "Escolha…"}</option>{capital.zones.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
    </select>);

  if (!capital.hasBairroList) {
    return (<>
      <Wrap id={ids.neigh} label="Bairro" error={errors.neighborhood} className={className.neigh}><input id={ids.neigh} className={inputClass} value={neighborhood} onChange={(e) => onChange(e.target.value, zone)} maxLength={100} aria-invalid={!!errors.neighborhood} required /></Wrap>
      <Wrap id={ids.zone} label={capital.zoneLabel} error={errors.zone} className={className.zone} hint="Para sabermos a região onde você está.">{zoneSelect(false)}</Wrap>
    </>);
  }
  const options = geo?.neighborhoods ?? [];
  const selectValue = outro ? OUTRO : inList ? options.find(([n]) => n.toLowerCase() === neighborhood.toLowerCase())?.[0] ?? "" : neighborhood ? OUTRO : "";
  const other = outro || (!!neighborhood && !inList && !!geo);
  return (<>
    <Wrap id={ids.neigh} label="Bairro" error={errors.neighborhood} className={className.neigh}>
      <select id={ids.neigh} className={inputClass} value={selectValue} disabled={!geo} aria-invalid={!!errors.neighborhood} required
        onChange={(e) => { const v = e.target.value; if (v === OUTRO) { setOutro(true); onChange("", ""); } else { setOutro(false); onChange(v, v ? (zoneOf.get(v.toLowerCase()) ?? "") : ""); } }}>
        <option value="">{geo ? "Escolha o bairro…" : "Carregando bairros…"}</option>
        {options.map(([n]) => <option key={n} value={n}>{n}</option>)}
        {geo && <option value={OUTRO}>Outro bairro (não está na lista)</option>}
      </select>
    </Wrap>
    {other && <Wrap id={`${ids.neigh}-outro`} label="Qual é o bairro?" className={className.neigh}><input id={`${ids.neigh}-outro`} className={inputClass} value={neighborhood} maxLength={100} onChange={(e) => onChange(e.target.value, zone)} /></Wrap>}
    <Wrap id={ids.zone} label={capital.zoneLabel} error={errors.zone} className={className.zone} hint={other ? "Escolha a zona do bairro." : "Preenchida pelo bairro."}>{zoneSelect(!other)}</Wrap>
  </>);
};
export default BairroZonaFields;
