// Definições dos dois quizzes de captação — texto e ordem das perguntas seguem exatamente o que foi
// especificado (não invente, não reordene). Cada resposta é salva como {value, label[, detalhe]} — o
// rótulo é o texto exibido no momento da resposta, preservado mesmo que uma versão futura mude o texto.
export type Journey = "atendimento" | "parceria";

export const CONTACT_CONSENT_VERSION = "contact-v1";
export const CONTACT_CONSENT_TEXT =
  "Vamos usar seu nome, e-mail e WhatsApp para entender sua necessidade e entrar em contato sobre o HP Group. " +
  "Você pode pedir a remoção dos seus dados a qualquer momento.";

export const HEALTH_CONSENT_VERSION = "health-v1";
export const HEALTH_CONSENT_TEXT =
  "As próximas perguntas são sobre sua dor e qualidade de vida. Essas respostas são tratadas como dado de " +
  "saúde: ficam visíveis só para a equipe autorizada do HP Group e ajudam a entender melhor sua situação " +
  "antes do contato — não substituem uma avaliação clínica.";

export const MARKETING_CONSENT_VERSION = "marketing-v1";
export const MARKETING_CONSENT_TEXT = "Aceito receber novidades e comunicações promocionais do HP Group por e-mail/WhatsApp.";

export interface QuestionOption { value: string; label: string }
export interface Question {
  key: string;
  question: string;
  kind: "options" | "scale" | "options-other" | "multi";
  options?: QuestionOption[];
  exclusiveValue?: string; // multi: essa opção é exclusiva das demais (ex.: "Nenhuma")
  healthSensitive?: boolean;
}

// Etapa 1 (nome/e-mail/whatsapp) e cidade/UF são tratadas fora desta lista (campos fixos do QuizRunner).
export const ATENDIMENTO_QUESTIONS: Question[] = [
  { key: "dor_intensidade", question: "De 0 a 10, quanto sua dor ou desconforto incomoda você hoje?", kind: "scale", healthSensitive: true },
  { key: "motivacao_melhora", question: "De 0 a 10, quanto você deseja melhorar esse problema?", kind: "scale", healthSensitive: true },
  { key: "impacto_qualidade_vida", question: "Se esse desconforto diminuísse, quanto sua qualidade de vida melhoraria?", kind: "scale", healthSensitive: true },
  {
    key: "atividade_desejada", question: "Qual atividade você mais gostaria de voltar a fazer com conforto?", kind: "options-other",
    options: [
      { value: "trabalhar", label: "Trabalhar" }, { value: "dormir", label: "Dormir" },
      { value: "esporte", label: "Praticar esporte" }, { value: "atividades_diarias", label: "Realizar atividades diárias" },
      { value: "outra", label: "Outra" },
    ],
  },
  {
    key: "interesse_acompanhamento",
    question: "Você teria interesse em conhecer um acompanhamento individualizado, que pode incluir um plano inicial de 10 sessões após avaliação?",
    kind: "options",
    options: [{ value: "sim", label: "Sim" }, { value: "quero_entender", label: "Quero entender melhor" }, { value: "nao_momento", label: "Não neste momento" }],
  },
  {
    key: "faixa_investimento", question: "Considerando um atendimento individualizado, qual investimento por sessão você consideraria?", kind: "options",
    options: [
      { value: "ate_250", label: "Até R$ 250" }, { value: "250_500", label: "Acima de R$ 250 até R$ 500" },
      { value: "acima_500", label: "Acima de R$ 500" }, { value: "entender_proposta", label: "Preciso entender a proposta" },
    ],
  },
];

export const PARCERIA_QUESTIONS: Question[] = [
  {
    key: "momento_profissional", question: "Qual é seu momento profissional?", kind: "options",
    options: [
      { value: "estudante", label: "Estudante" }, { value: "formado_iniciando", label: "Formado iniciando atuação" },
      { value: "em_atuacao", label: "Fisioterapeuta em atuação" }, { value: "gestor_proprietario", label: "Gestor ou proprietário de clínica" },
    ],
  },
  {
    key: "situacao_registro", question: "Qual é sua situação de registro profissional?", kind: "options",
    options: [{ value: "ativo", label: "Ativo" }, { value: "em_regularizacao", label: "Em regularização" }, { value: "nao_possuo", label: "Ainda não possuo" }],
  },
  {
    key: "area_atuacao", question: "Qual é sua principal área de atuação ou interesse?", kind: "options-other",
    options: [
      { value: "ortopedia", label: "Ortopedia" }, { value: "esportiva", label: "Esportiva" },
      { value: "neurologica", label: "Neurológica" }, { value: "geriatrica", label: "Geriátrica" }, { value: "outra", label: "Outra" },
    ],
  },
  {
    key: "modelo_atendimento", question: "Como você atende atualmente?", kind: "options-other",
    options: [
      { value: "clinica_propria", label: "Clínica própria" }, { value: "clinica_terceiros", label: "Clínica de terceiros" },
      { value: "domiciliar", label: "Atendimento domiciliar" }, { value: "nao_atendo", label: "Ainda não atendo" }, { value: "outro", label: "Outro" },
    ],
  },
  {
    key: "objetivos_parceria", question: "O que você busca na parceria com o HP Group?", kind: "multi",
    options: [
      { value: "encaminhamentos", label: "Encaminhamentos" }, { value: "equipe", label: "Atuar na equipe" },
      { value: "conhecer_metodo", label: "Conhecer o método de atendimento" }, { value: "desenvolver_negocio", label: "Desenvolver meu negócio" },
    ],
  },
  {
    key: "interesses_desenvolvimento", question: "Em quais áreas você gostaria de se desenvolver?", kind: "multi",
    options: [
      { value: "precificacao", label: "Precificação" }, { value: "posicionamento_marca", label: "Posicionamento de marca" },
      { value: "captacao_pacientes", label: "Captação de pacientes" }, { value: "vendas", label: "Vendas" },
      { value: "gestao", label: "Gestão" }, { value: "nenhuma", label: "Nenhuma no momento" },
    ],
    exclusiveValue: "nenhuma",
  },
];

export const JOURNEY_LABEL: Record<Journey, string> = { atendimento: "Avaliação inicial", parceria: "Parceria HP Group" };
export const JOURNEY_ROUTE: Record<Journey, string> = { atendimento: "/avaliacao", parceria: "/seja-parceiro" };
export const JOURNEY_CTA_LABEL: Record<Journey, string> = { atendimento: "Quero cuidar da minha dor", parceria: "Quero ser fisioterapeuta parceiro" };
export const JOURNEY_QUESTIONS: Record<Journey, Question[]> = { atendimento: ATENDIMENTO_QUESTIONS, parceria: PARCERIA_QUESTIONS };

// 3 etapas fixas (contato) + cidade/UF + N perguntas específicas = 10 no total, igual à especificação.
export const totalSteps = (j: Journey) => 4 + JOURNEY_QUESTIONS[j].length;

export const UF_LIST = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
] as const;

export interface WhatsAppTemplateFields {
  firstName: string; fullName: string; email: string; phone: string; city: string; uf: string; protocol: string;
}

const line = (label: string, value: string) => (value ? `${label}: ${value}` : null);

export const buildAtendimentoMessage = (
  f: WhatsAppTemplateFields, interesseLabel: string | null, includeHealth: boolean, healthLines: string[], includeBudget: boolean, budgetLabel: string | null,
): string => {
  const fields = [
    line("Nome", f.fullName), line("E-mail", f.email), line("WhatsApp", f.phone),
    line("Cidade/UF", f.city && f.uf ? `${f.city}/${f.uf}` : f.city || f.uf),
    interesseLabel ? line("Interesse", interesseLabel) : null,
    includeHealth && healthLines.length ? healthLines.join("\n") : null,
    includeBudget && budgetLabel ? line("Investimento considerado", budgetLabel) : null,
    line("Protocolo", f.protocol),
  ].filter((x): x is string => Boolean(x));
  return "Olá! Preenchi a avaliação inicial no site do HP Group e gostaria de conhecer o acompanhamento.\n\n" + fields.join("\n");
};

export const buildParceriaMessage = (
  f: WhatsAppTemplateFields, momento: string | null, registro: string | null, area: string | null, modelo: string | null, objetivos: string | null, interesses: string | null,
): string => {
  const fields = [
    line("Nome", f.fullName), line("E-mail", f.email), line("WhatsApp", f.phone),
    line("Cidade/UF", f.city && f.uf ? `${f.city}/${f.uf}` : f.city || f.uf),
    momento ? line("Momento profissional", momento) : null,
    registro ? line("Situação do registro", registro) : null,
    area ? line("Área de atuação", area) : null,
    modelo ? line("Modelo de atendimento", modelo) : null,
    objetivos ? line("Objetivos da parceria", objetivos) : null,
    interesses ? line("Interesses de desenvolvimento", interesses) : null,
    line("Protocolo", f.protocol),
  ].filter((x): x is string => Boolean(x));
  return "Olá! Preenchi o formulário de parceria do HP Group.\n\n" + fields.join("\n");
};

export const waLink = (phone: string, text: string) => `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
