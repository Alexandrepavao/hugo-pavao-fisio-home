import { DAY_FMT, DEFAULT_STAGES, type ApptItem, type ExerciseItem, type JourneyModel, type WorkLog } from "../model";

/** Exemplos ILUSTRATIVOS da demonstração. Mostram possibilidades de acompanhamento, nunca resultados garantidos para um paciente. Nada aqui vem do banco e nada daqui é gravado. */
export type ScenarioKey = "inicio" | "acompanhamento" | "reavaliacao";
export const SCENARIOS: { key: ScenarioKey; label: string; hint: string }[] = [
  { key: "inicio", label: "Início", hint: "Primeiras semanas: objetivo, primeira dor registrada e rotina recém-liberada" },
  { key: "acompanhamento", label: "Acompanhamento", hint: "Meio do caminho: vários registros, rotina em andamento e consultas" },
  { key: "reavaliacao", label: "Reavaliação", hint: "Reavaliação: decisão do fisioterapeuta e conteúdos para o próximo passo" },
];

const at = (now: Date, days: number, h = 10) => { const d = new Date(now.getTime() + days * 864e5); d.setUTCHours(h + 3, 0, 0, 0); return d.toISOString(); };   // h no horário de São Paulo (UTC-3)
const EX: ExerciseItem[] = [
  { id: "demo-ex-1", workout: "A", title: "Ponte de glúteos", instructions: "Deite de costas, joelhos dobrados. Eleve o quadril sem arquear a lombar.", sets: 3, reps: "10", duration_s: 200, notes: "Respeite o limite do desconforto combinado na consulta.", videoAvailable: true },
  { id: "demo-ex-2", workout: "A", title: "Extensão de joelho sentado", instructions: "Sentado, estenda um joelho devagar e volte controlando o movimento.", sets: 3, reps: "12", duration_s: 165, notes: null, videoAvailable: true },
  { id: "demo-ex-3", workout: "A", title: "Marcha com apoio", instructions: "Caminhe devagar dentro de casa, com apoio próximo, por alguns minutos.", sets: 1, reps: null, duration_s: 300, notes: "Interrompa se sentir tontura.", videoAvailable: true },
];

export interface DemoOptions { firstName?: string; goal?: string }

/** Monta o modelo da demonstração para um exemplo. As datas são relativas a "agora" para a semana e a próxima consulta sempre fazerem sentido. */
export const buildDemoModel = (scenario: ScenarioKey, opts: DemoOptions = {}, now: Date = new Date()): JourneyModel => {
  const firstName = (opts.firstName ?? "").trim() || "Ana"; const goal = (opts.goal ?? "").trim() || "Voltar a caminhar com conforto";
  const day = (n: number) => DAY_FMT(new Date(now.getTime() + n * 864e5));
  const appt = (id: string, days: number, status: string, service = "Fisioterapia ortopédica", h = 14): ApptItem => ({ id, starts_at: at(now, days, h), status, service, professional: "Dr. Hugo", canConfirm: status === "scheduled", confirmed: status === "confirmed" });
  const base = { mode: "demo" as const, firstName, goal: { title: goal, target_date: null as string | null }, specialtyLabel: "Fisioterapia ortopédica", videos: [], checkinDue: false, needsBirthDate: false, hasData: true, decision: null, decisionMessage: null, education: [], offers: [], workLogs: [] as WorkLog[] };
  const week = (days: number[]): WorkLog[] => days.map((d) => ({ date: day(d), skipped: false }));
  if (scenario === "inicio") return {
    ...base, stages: DEFAULT_STAGES, currentStage: 0,
    nextAppointment: appt("demo-a1", 3, "scheduled"), appointments: [appt("demo-a0", -2, "attended", "Avaliação inicial", 9), appt("demo-a1", 3, "scheduled")],
    pain: [{ at: at(now, -2, 9), value: 8, by: "professional", author: "Dr. Hugo" }], functional: [{ name: "Caminhar", first: 3, last: 3, count: 1, firstAt: at(now, -2, 9), lastAt: at(now, -2, 9) }],
    training: { title: "Rotina inicial", weeklyTarget: 3, workoutToday: "A", items: EX.slice(0, 2), todayDone: 0, todayTotal: 2, streak: 0, weekDays: 0 },
    sessions: { planned: 10, attended: 1, noShow: 0, lateCancel: 0, balance: 9, maintenance: false, planStatus: "active" },
    education: [{ id: "demo-e1", topic: "objetivos", title: "O que vamos buscar juntos", body: "Seu objetivo orienta as escolhas do acompanhamento. Ele pode ser ajustado conforme você evolui e conversa com seu fisioterapeuta." }],
  };
  if (scenario === "acompanhamento") return {
    ...base, stages: DEFAULT_STAGES, currentStage: 2,
    nextAppointment: appt("demo-a9", 2, "scheduled"),
    appointments: [appt("demo-a5", -9, "attended"), appt("demo-a6", -6, "attended"), appt("demo-a7", -3, "attended"), appt("demo-a8", -1, "cancelled_by_patient"), appt("demo-a9", 2, "scheduled")],
    pain: [8, 7, 6, 5, 4, 3].map((v, i) => ({ at: at(now, -26 + i * 5, 10), value: v, by: (i % 2 ? "patient" : "professional") as "patient" | "professional", author: i % 2 ? "Você" : "Dr. Hugo" })),
    functional: [{ name: "Caminhar", first: 3, last: 6, count: 4, firstAt: at(now, -26), lastAt: at(now, -3) }, { name: "Subir escadas", first: 2, last: 5, count: 3, firstAt: at(now, -20), lastAt: at(now, -3) }, { name: "Dormir melhor", first: 4, last: 7, count: 3, firstAt: at(now, -20), lastAt: at(now, -3) }],
    training: { title: "Rotina de fortalecimento", weeklyTarget: 3, workoutToday: "A", items: EX, todayDone: 0, todayTotal: 3, streak: 2, weekDays: 2 }, workLogs: week([-3, -1]),
    sessions: { planned: 10, attended: 4, noShow: 0, lateCancel: 1, balance: 5, maintenance: false, planStatus: "active" },
    education: [{ id: "demo-e2", topic: "rotina", title: "Por que a rotina em casa importa", body: "Os exercícios em casa complementam as consultas. Quem ajusta a rotina é o seu fisioterapeuta, a cada reavaliação." }],
  };
  return {
    ...base, stages: DEFAULT_STAGES, currentStage: 4,
    nextAppointment: appt("demo-r9", 1, "scheduled", "Reavaliação"),
    appointments: [appt("demo-r5", -14, "attended"), appt("demo-r6", -9, "attended"), appt("demo-r7", -5, "attended"), appt("demo-r8", -2, "attended"), appt("demo-r9", 1, "scheduled", "Reavaliação")],
    pain: [8, 7, 6, 5, 4, 3, 2].map((v, i) => ({ at: at(now, -40 + i * 6, 10), value: v, by: (i % 2 ? "patient" : "professional") as "patient" | "professional", author: i % 2 ? "Você" : "Dr. Hugo" })),
    functional: [{ name: "Caminhar", first: 3, last: 8, count: 6, firstAt: at(now, -40), lastAt: at(now, -2) }, { name: "Subir escadas", first: 2, last: 7, count: 5, firstAt: at(now, -34), lastAt: at(now, -2) }],
    training: { title: "Rotina de fortalecimento", weeklyTarget: 3, workoutToday: "A", items: EX, todayDone: 3, todayTotal: 3, streak: 4, weekDays: 3 }, workLogs: week([-5, -3, -2, -1, 0]),
    sessions: { planned: 10, attended: 8, noShow: 1, lateCancel: 0, balance: 1, maintenance: false, planStatus: "active" },
    decision: "continuidade", decisionMessage: "Você evoluiu bem nas atividades que combinamos. Vamos manter o acompanhamento com foco em autonomia e ajustar a rotina de exercícios.",
    education: [
      { id: "demo-e3", topic: "reavaliacao", title: "Como se preparar para a reavaliação", body: "Anote como foram suas semanas, o que melhorou e o que ainda incomoda. Leve suas dúvidas: a reavaliação decide os próximos passos com você." },
      { id: "demo-e4", topic: "autonomia", title: "Caminho para a autonomia", body: "O objetivo é você conseguir manter os ganhos sozinho. A alta é decidida junto com seu fisioterapeuta, quando fizer sentido para o seu caso." },
    ],
  };
};

export interface TourStep { id: string; tab: "inicio" | "evolucao" | "exercicios" | "agenda" | "mais"; target: string; title: string; text: string }
/** Roteiro guiado: cada passo leva à aba certa e destaca o bloco que o fisioterapeuta vai explicar. */
export const TOUR: TourStep[] = [
  { id: "t1", tab: "inicio", target: "jr-hero", title: "Começa pelo objetivo do paciente", text: "O objetivo é definido por você com o paciente. A tela sempre indica a próxima ação a partir do plano registrado." },
  { id: "t2", tab: "inicio", target: "jr-journey", title: "A jornada tem as etapas que você definir", text: "Os nomes e a etapa atual são seus. Nada avança sozinho por número de sessões." },
  { id: "t3", tab: "inicio", target: "jr-pain", title: "A dor, com data e escala", text: "Cada ponto é um registro real. Um único registro não vira tendência, e o gráfico não é previsão de recuperação." },
  { id: "t4", tab: "inicio", target: "jr-functional", title: "As atividades do objetivo", text: "Só aparecem atividades cadastradas e avaliadas, na escala registrada (0 a 10). Não há percentual de recuperação." },
  { id: "t5", tab: "exercicios", target: "jr-exercises", title: "A rotina liberada por você", text: "Assistir ao vídeo e registrar que fez são coisas diferentes. A rotina é sempre prescrita pelo fisioterapeuta." },
  { id: "t6", tab: "agenda", target: "jr-week", title: "A semana do paciente", text: "Consultas agendadas, realizadas e canceladas aparecem separadas dos treinos que o paciente informa." },
  { id: "t7", tab: "mais", target: "jr-sessions", title: "Sessões não são recuperação", text: "Plano clínico, sessões realizadas, consumidas sem atendimento e saldo financeiro ficam separados." },
  { id: "t8", tab: "mais", target: "jr-education", title: "Conteúdos para o próximo passo", text: "Textos aprovados por você sobre objetivos, rotina, reavaliação e autonomia. A continuidade depende da necessidade clínica." },
];
