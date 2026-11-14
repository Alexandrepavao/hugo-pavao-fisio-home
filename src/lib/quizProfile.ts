import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/** Perfil do fisioterapeuta parceiro vindo do formulário de parceria (RPC quiz_profiles): é o que alimenta a tag de área de atuação e o resumo dos cards do CRM e da Captação.
 *  Só leitura; nunca traz resposta de saúde. Quem parou o formulário no meio aparece com o que já respondeu (os demais campos vêm vazios). */
export interface ProfileAnswer { value: unknown; label: string; detalhe?: string }
export interface PartnerProfile {
  person_id: string; quiz_id: string; status: "started" | "partial" | "completed" | string; city: string | null; state_uf: string | null;
  experience: ProfileAnswer | null; area: ProfileAnswer | null; registro: ProfileAnswer | null; crefito: string | null; modelo: ProfileAnswer | null;
  objetivos: string | null; programa: string | null; resumo: string | null;
}

/** Área de atuação ou de interesse, com o que a pessoa escreveu quando marcou “Outra”. */
export const areaText = (p: PartnerProfile | undefined | null): string | null => (p?.area ? (p.area.detalhe ? `${p.area.label} — ${p.area.detalhe}` : p.area.label) : null);
/** Só o nome da área para a tag (“Outra” vira o texto escrito, quando houver). */
export const areaTag = (p: PartnerProfile | undefined | null): string | null => (p?.area ? (p.area.value === "outra" && p.area.detalhe ? p.area.detalhe : p.area.label) : null);

/** Uma linha curta: “Fisioterapeuta em atuação · Ortopedia” (para listas e cards). */
export const partnerLine = (p: PartnerProfile | undefined | null): string => [p?.experience?.label, areaText(p)].filter(Boolean).join(" · ");

export const PARTNER_PIPELINE_KINDS = ["partners", "education"];
export const isPartnerKind = (kind: string | null | undefined) => !!kind && PARTNER_PIPELINE_KINDS.includes(kind);

/** Busca os perfis de uma lista de pessoas ('person') ou de captações ('quiz') de uma vez; devolve um mapa id → perfil. Falha de permissão ou de rede = mapa vazio (os cards só ficam sem o resumo). */
export const usePartnerProfiles = (by: "person" | "quiz", ids: (string | null | undefined)[], enabled = true) => {
  const list = [...new Set(ids.filter((x): x is string => !!x))].sort().slice(0, 300);
  const q = useQuery({
    queryKey: ["quiz-profiles", by, list.join(",")], enabled: enabled && list.length > 0, staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("quiz_profiles", { p_by: by, p_ids: list });
      if (error) return [] as PartnerProfile[];
      return (data ?? []) as PartnerProfile[];
    },
  });
  const map = new Map<string, PartnerProfile>();
  for (const p of q.data ?? []) map.set(by === "person" ? p.person_id : p.quiz_id, p);
  return map;
};

const QUIZ_SOURCE: Record<string, string> = { academy: "Academy", parceria: "Parceria", atendimento: "Atendimento" };
/** Nome legível da origem de uma oportunidade: “quiz:academy” → “Quiz: Academy”, “page:slug” → “Página: slug”. Outras origens (ex.: “manual”, “Importação CSV”) ficam como estão. */
export const sourceLabel = (s: string | null | undefined): string => {
  if (!s) return "";
  const quiz = /^quiz:(.+)$/.exec(s); if (quiz) return `Quiz: ${QUIZ_SOURCE[quiz[1]] ?? quiz[1].charAt(0).toUpperCase() + quiz[1].slice(1)}`;
  const page = /^page:(.+)$/.exec(s); if (page) return `Página: ${page[1]}`;
  return s;
};
