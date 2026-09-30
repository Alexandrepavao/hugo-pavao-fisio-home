/** Perfil de entrega. Na branch `release/v1` o padrão é "v1" (primeira versão operacional): recursos ainda incompletos ficam
 *  FORA da navegação e das rotas. Builds de desenvolvimento/preview podem usar VITE_RELEASE_PROFILE=full para vê-los.
 *
 *  ATENÇÃO: isto só organiza a interface. Nenhuma permissão depende daqui — a autorização de cada dado continua no banco
 *  (RLS e funções). Um recurso escondido não vira acessível nem inacessível por causa desta flag. */
export type FeatureKey =
  | "crm_scheduled_messages"   // exige provedor de envio automático (não existe); a tela só explica o bloqueio
  | "crm_broadcast"            // idem — disparo de mensagens
  | "system_status"            // "Estado dos módulos": painel técnico interno
  | "settings_pending_cards";  // cartões de Configurações ainda sem tela ("Pendente")

const OFF_IN_V1: ReadonlySet<FeatureKey> = new Set<FeatureKey>(["crm_scheduled_messages", "crm_broadcast", "system_status", "settings_pending_cards"]);

export const RELEASE_PROFILE: "v1" | "full" = (import.meta.env.VITE_RELEASE_PROFILE as string | undefined) === "full" ? "full" : "v1";
export const featureOn = (key: FeatureKey): boolean => RELEASE_PROFILE === "full" || !OFF_IN_V1.has(key);

declare const __BUILD_INFO__: { commit: string; builtAt: string };
export const BUILD_INFO: { commit: string; builtAt: string } = typeof __BUILD_INFO__ !== "undefined" ? __BUILD_INFO__ : { commit: "dev", builtAt: "" };
