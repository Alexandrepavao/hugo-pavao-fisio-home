import { SP_ZONES } from "@/lib/spZones";

/** Capitais com zonas de atendimento + bairro: só as capitais de estado já liberadas aparecem aqui (cada uma com a divisão OFICIAL da própria cidade). Cidades que não são capital, ou capitais
 *  ainda não liberadas, continuam perguntando só a cidade. O banco tem a mesma lista (tabela geo_zones): front e banco precisam andar juntos. */
export interface Zone { id: string; label: string }
export interface CapitalMeta {
  key: string;            // chave da cidade, igual a private.geo_city_key (sem acento, caixa ou espaços)
  uf: string; name: string;
  zones: Zone[];
  hasBairroList: boolean; // true = o bairro é escolhido de uma lista da cidade e a zona vem junto; false = bairro digitado e zona escolhida
  zoneLabel: string;      // rótulo do campo (“Zona de São Paulo”)
  zonePrompt: string;     // mensagem quando falta escolher a zona
}
export interface CityGeo {
  neighborhoods: [string, string][];   // [bairro, id da zona]
  map: { w: number; h: number; paths: Record<string, string>; labels: Record<string, [number, number]> };
  credit: string;
}

export const CAPITALS: CapitalMeta[] = [
  { key: "saopaulo", uf: "SP", name: "São Paulo", zones: SP_ZONES.map((z) => ({ id: z.id, label: z.label })), hasBairroList: false, zoneLabel: "Zona de São Paulo", zonePrompt: "Escolha a zona de São Paulo." },
  { key: "riodejaneiro", uf: "RJ", name: "Rio de Janeiro", zones: [{ id: "rj-sul", label: "Zona Sul" }, { id: "rj-norte", label: "Zona Norte" }, { id: "rj-oeste", label: "Zona Oeste" }, { id: "rj-centro", label: "Centro" }],
    hasBairroList: true, zoneLabel: "Zona do Rio de Janeiro", zonePrompt: "Escolha a zona do Rio de Janeiro." },
];

/** Mesma normalização do banco: sem acento, só letras, minúsculas (“São Paulo”, “sao paulo” e “  SAO  PAULO ” viram “saopaulo”). */
export const cityKey = (city: string): string => city.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
export const capitalOf = (city: string | null | undefined, uf: string | null | undefined): CapitalMeta | null => {
  if (!city || !uf) return null; const k = cityKey(city); const u = uf.trim().toUpperCase();
  return CAPITALS.find((c) => c.key === k && c.uf === u) ?? null;
};
/** Rótulo de qualquer zona (os ids são únicos entre as capitais: São Paulo usa “sul”, “norte”…, as demais, “rj-sul”…). */
export const ZONE_LABEL: Record<string, string> = Object.fromEntries(CAPITALS.flatMap((c) => c.zones.map((z) => [z.id, z.label])));
export const zoneLabel = (id: string | null | undefined): string | null => (id ? (ZONE_LABEL[id] ?? id) : null);
/** “Zona Sul (Rio de Janeiro)”: quando a lista mistura cidades (ex.: zonas que um fisioterapeuta atende), o nome da zona vem com a cidade. */
export const zoneWithCity = (id: string): string => { const c = CAPITALS.find((x) => x.zones.some((z) => z.id === id)); return c ? `${ZONE_LABEL[id]} (${c.name})` : id; };

/** Bairros e mapa da cidade, carregados só quando a tela precisa (os desenhos pesam dezenas de KB). */
export const loadCityGeo = async (c: CapitalMeta): Promise<CityGeo> => {
  if (c.key === "riodejaneiro") return (await import("./geo/rio")).RIO_GEO;
  const { SP_MAP } = await import("./spMapData");
  return { neighborhoods: [], map: SP_MAP as unknown as CityGeo["map"], credit: "Distritos do município: GeoSampa / Prefeitura de São Paulo (dados abertos), agrupados nas zonas pela subprefeitura; geometria simplificada." };
};
