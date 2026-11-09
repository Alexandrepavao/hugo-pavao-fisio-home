/** Zonas da cidade de São Paulo (capital). Usadas no quiz, nos cadastros e no CRM — só valem para São Paulo/SP; em outras cidades pergunta-se apenas a cidade. */
export const SP_ZONES = [
  { id: "sul", label: "Zona Sul" },
  { id: "norte", label: "Zona Norte" },
  { id: "leste", label: "Zona Leste" },
  { id: "oeste", label: "Zona Oeste" },
  { id: "centro", label: "Centro" },
] as const;
export type SpZone = (typeof SP_ZONES)[number]["id"];
export const SP_ZONE_LABEL: Record<string, string> = Object.fromEntries(SP_ZONES.map((z) => [z.id, z.label]));

/** Mesma regra do banco (`private.is_sp_capital`): UF = SP e cidade "São Paulo" sem acento, caixa ou espaços. */
export const isSpCapital = (city: string, uf: string): boolean =>
  uf.trim().toUpperCase() === "SP" && city.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "") === "saopaulo";
