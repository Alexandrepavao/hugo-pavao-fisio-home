// Definição dos blocos do editor. O conteúdo é DADOS (JSON), nunca HTML/JS: o front só renderiza componentes conhecidos.
import { buildJourneyHref, type Journey } from "@/lib/quiz";

export type BlockType = "hero" | "text" | "image" | "video" | "benefits" | "team" | "faq" | "cta" | "form";

export interface Block { type: BlockType; [key: string]: unknown }

export type FieldKind = "text" | "textarea" | "url" | "list" | "select";
export interface SelectOption { value: string; label: string }
export interface FieldDef { key: string; label: string; kind: FieldKind; fields?: FieldDef[]; hint?: string; options?: SelectOption[] }

// Destino do botão do bloco "cta": duas jornadas de quiz já existentes, ou um link personalizado (comportamento
// anterior, preservado). Blocos antigos não têm `target` gravado — tratados como "custom" (nunca mudam de destino
// sozinhos). O texto do botão (`label`) é sempre independente do destino.
export type CtaTarget = "avaliacao" | "seja-parceiro" | "custom";
export const CTA_TARGET_OPTIONS: SelectOption[] = [
  { value: "avaliacao", label: "Avaliação de paciente" },
  { value: "seja-parceiro", label: "Parceria profissional" },
  { value: "custom", label: "Link personalizado" },
];
export const ctaTargetOf = (b: Record<string, unknown>): CtaTarget =>
  b.target === "avaliacao" || b.target === "seja-parceiro" ? b.target : "custom";
const CTA_TARGET_JOURNEY: Record<"avaliacao" | "seja-parceiro", Journey> = { avaliacao: "atendimento", "seja-parceiro": "parceria" };

export const BLOCK_LABEL: Record<BlockType, string> = {
  hero: "Destaque (topo)", text: "Texto", image: "Imagem", video: "Vídeo", benefits: "Benefícios",
  team: "Equipe", faq: "Perguntas frequentes", cta: "Chamada para ação", form: "Formulário",
};

export const BLOCK_SCHEMA: Record<BlockType, FieldDef[]> = {
  hero: [
    { key: "title", label: "Título", kind: "text" }, { key: "subtitle", label: "Subtítulo", kind: "textarea" },
    { key: "cta_label", label: "Texto do botão", kind: "text" },
  ],
  text: [{ key: "title", label: "Título", kind: "text" }, { key: "body", label: "Texto", kind: "textarea", hint: "Separe parágrafos com linha em branco." }],
  image: [
    { key: "src", label: "Endereço da imagem (https://…)", kind: "url" }, { key: "alt", label: "Descrição (acessibilidade)", kind: "text" },
    { key: "caption", label: "Legenda", kind: "text" },
  ],
  video: [
    { key: "url", label: "Link do YouTube ou Vimeo", kind: "url" }, { key: "title", label: "Título do vídeo", kind: "text" },
  ],
  benefits: [
    { key: "title", label: "Título", kind: "text" },
    { key: "items", label: "Itens", kind: "list", fields: [{ key: "title", label: "Título", kind: "text" }, { key: "text", label: "Descrição", kind: "textarea" }] },
  ],
  team: [
    { key: "title", label: "Título", kind: "text" },
    { key: "members", label: "Pessoas", kind: "list", fields: [
      { key: "name", label: "Nome", kind: "text" }, { key: "role", label: "Função", kind: "text" }, { key: "photo", label: "Foto (https://…)", kind: "url" }] },
  ],
  faq: [
    { key: "title", label: "Título", kind: "text" },
    { key: "items", label: "Perguntas", kind: "list", fields: [{ key: "q", label: "Pergunta", kind: "text" }, { key: "a", label: "Resposta", kind: "textarea" }] },
  ],
  cta: [
    { key: "title", label: "Título", kind: "text" }, { key: "text", label: "Texto", kind: "textarea" },
    { key: "label", label: "Texto do botão", kind: "text" },
    // "target" (destino) e a URL personalizada (só quando target = custom) são especiais — ver BlockEditor.tsx.
  ],
  form: [{ key: "title", label: "Título acima do formulário", kind: "text" }],
};

export const newBlock = (type: BlockType): Block => {
  const b: Block = { type };
  if (type === "benefits" || type === "faq") b.items = [];
  if (type === "team") b.members = [];
  if (type === "form") b.form_id = "";
  if (type === "cta") b.target = "custom";
  return b;
};

/** Só permite esquemas seguros em links. */
export const safeUrl = (u: unknown): string | null => {
  if (typeof u !== "string") return null;
  const v = u.trim();
  return /^(https:\/\/|\/(?!\/)|#|mailto:|tel:)/i.test(v) ? v : null;
};

/** Destino real do botão do bloco "cta": jornada de quiz (registra a página de origem + parâmetros de
 * campanha permitidos) ou o link personalizado de sempre (validado por `safeUrl`, protocolos inseguros
 * bloqueados). Preview e página publicada usam exatamente esta função — nunca divergem. */
export const resolveCtaHref = (b: Record<string, unknown>, opts: { pageSlug?: string; utm?: Record<string, string> } = {}): string | null => {
  const target = ctaTargetOf(b);
  if (target === "custom") return safeUrl(b.url);
  return buildJourneyHref(CTA_TARGET_JOURNEY[target], { from: opts.pageSlug ? `/${opts.pageSlug}` : undefined, utm: opts.utm });
};

export function videoEmbed(url: unknown): string | null {
  const u = safeUrl(url);
  if (!u || !u.startsWith("https://")) return null;
  try {
    const { hostname, pathname, searchParams } = new URL(u);
    const h = hostname.replace(/^www\./, "");
    if (h === "youtube.com") { const id = searchParams.get("v"); return id && /^[\w-]{6,20}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null; }
    if (h === "youtu.be") { const id = pathname.slice(1); return /^[\w-]{6,20}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null; }
    if (h === "vimeo.com") { const id = pathname.slice(1); return /^\d+$/.test(id) ? `https://player.vimeo.com/video/${id}` : null; }
  } catch { /* URL inválida */ }
  return null;
}

const F = "__DEFAULT_FORM__"; // substituído pelo id do formulário criado junto com a página

export interface PageTemplate { id: string; name: string; purpose: string; suggestedSlug: string; pipelineKind: "patients" | "education" | "partners" | "companies"; blocks: Block[] }

export const TEMPLATES: PageTemplate[] = [
  { id: "checkup", name: "Check-up", purpose: "Captar pacientes para avaliação", suggestedSlug: "checkup", pipelineKind: "patients", blocks: [
    { type: "hero", title: "Check-up fisioterapêutico", subtitle: "Uma avaliação completa do seu movimento, com orientação profissional.", cta_label: "Quero agendar" },
    { type: "benefits", title: "O que você recebe", items: [{ title: "Avaliação individual", text: "Análise do seu histórico e da sua queixa." }, { title: "Plano de cuidado", text: "Orientações definidas por um fisioterapeuta." }] },
    { type: "faq", title: "Dúvidas frequentes", items: [{ q: "Como funciona a avaliação?", a: "Edite esta resposta com as informações do seu serviço." }] },
    { type: "form", title: "Agende sua avaliação", form_id: F },
  ] },
  { id: "mentoring", name: "Mentoria", purpose: "Captar fisioterapeutas para mentoria", suggestedSlug: "mentoring", pipelineKind: "education", blocks: [
    { type: "hero", title: "Mentoria para fisioterapeutas", subtitle: "Desenvolvimento profissional e comercial com acompanhamento.", cta_label: "Quero conhecer" },
    { type: "benefits", title: "Como funciona", items: [{ title: "Encontros ao vivo", text: "Edite com o formato real da mentoria." }, { title: "Acompanhamento", text: "Edite com a rotina de acompanhamento." }] },
    { type: "form", title: "Fale com nossa equipe", form_id: F },
  ] },
  { id: "pilates", name: "Pilates", purpose: "Captar alunos de pilates", suggestedSlug: "pilates", pipelineKind: "patients", blocks: [
    { type: "hero", title: "Pilates com orientação de fisioterapeuta", subtitle: "Aulas para todos os níveis.", cta_label: "Quero uma aula" },
    { type: "text", title: "Sobre as aulas", body: "Descreva turmas, horários e unidades." },
    { type: "form", title: "Agende uma aula experimental", form_id: F },
  ] },
  { id: "pos-operatorio", name: "Pós-operatório", purpose: "Captar pacientes em reabilitação", suggestedSlug: "pos-operatorio", pipelineKind: "patients", blocks: [
    { type: "hero", title: "Reabilitação pós-operatória", subtitle: "Acompanhamento fisioterapêutico após a cirurgia.", cta_label: "Falar com a equipe" },
    { type: "text", title: "Como acompanhamos você", body: "Descreva o processo de atendimento." },
    { type: "form", title: "Solicite contato", form_id: F },
  ] },
  { id: "parceiros", name: "Parceiros", purpose: "Recrutar fisioterapeutas parceiros", suggestedSlug: "parceiros", pipelineKind: "partners", blocks: [
    { type: "hero", title: "Seja um parceiro HP", subtitle: "Faça parte da nossa rede de fisioterapeutas.", cta_label: "Quero me candidatar" },
    { type: "benefits", title: "Por que ser parceiro", items: [{ title: "Encaminhamentos", text: "Edite com as condições reais." }] },
    { type: "form", title: "Candidate-se", form_id: F },
  ] },
  { id: "empresas", name: "Empresas", purpose: "Programas para empresas", suggestedSlug: "empresas", pipelineKind: "companies", blocks: [
    { type: "hero", title: "Saúde e movimento nas empresas", subtitle: "Programas de fisioterapia preventiva para equipes.", cta_label: "Solicitar proposta" },
    { type: "text", title: "Nossa proposta", body: "Descreva os programas corporativos." },
    { type: "form", title: "Solicite uma proposta", form_id: F },
  ] },
  { id: "eventos", name: "Eventos", purpose: "Inscrições em eventos", suggestedSlug: "eventos", pipelineKind: "education", blocks: [
    { type: "hero", title: "Nosso próximo evento", subtitle: "Informe data, local e programação.", cta_label: "Quero participar" },
    { type: "form", title: "Inscreva-se", form_id: F },
  ] },
  { id: "blank", name: "Em branco", purpose: "Começar do zero", suggestedSlug: "", pipelineKind: "patients", blocks: [{ type: "form", title: "Fale conosco", form_id: F }] },
];
