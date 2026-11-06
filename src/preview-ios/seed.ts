import { buildAdmin } from "./seed-admin";
import type { Appointment, Demo, Exercise, ExerciseLog, LogResult, Measure, Note, Patient, Payout, Routine } from "./types";

const pad = (n: number) => String(n).padStart(2, "0");
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayISO = () => isoDay(new Date());
const shift = (anchor: string, days: number) => { const [y, m, d] = anchor.split("-").map(Number); return isoDay(new Date(y, m - 1, d + days)); };
export const weekdayOf = (day: string) => { const [y, m, d] = day.split("-").map(Number); return new Date(y, m - 1, d).getDay(); };

const EX: Exercise[] = [
  { id: "ex-agach", name: "Agachamento assistido", region: "Coxas e glúteos", pose: "stand", steps: ["Apoie as mãos no encosto de uma cadeira firme.", "Afaste os pés na largura dos ombros.", "Dobre os joelhos como se fosse sentar, até onde estiver confortável.", "Volte devagar, sem travar os joelhos."], caution: "Pare se sentir dor aguda no joelho.", videoRef: null },
  { id: "ex-ponte", name: "Ponte glútea", region: "Glúteos e lombar", pose: "lying", steps: ["Deite de barriga para cima, joelhos dobrados e pés apoiados.", "Contraia o glúteo e eleve o quadril.", "Segure por 2 segundos.", "Desça devagar, vértebra por vértebra."], caution: "Não arqueie a lombar ao subir.", videoRef: null },
  { id: "ex-elev", name: "Elevação de perna estendida", region: "Quadríceps", pose: "lying", steps: ["Deitada, dobre uma perna e mantenha a outra esticada.", "Contraia a coxa da perna esticada.", "Eleve até a altura do joelho oposto.", "Desça com controle."], caution: "Mantenha o joelho esticado durante todo o movimento.", videoRef: null },
  { id: "ex-mob", name: "Mobilização ativa do joelho", region: "Joelho", pose: "seated", steps: ["Sente-se na beirada da cadeira.", "Estique o joelho devagar e volte.", "Mantenha um ritmo constante, sem forçar."], caution: "Movimente apenas até o limite confortável.", videoRef: null },
  { id: "ex-equi", name: "Equilíbrio em um pé", region: "Equilíbrio", pose: "stand", steps: ["Fique de pé ao lado de uma bancada para apoio.", "Eleve um pé do chão.", "Mantenha o corpo alinhado e o olhar à frente.", "Troque de perna."], caution: "Mantenha a mão perto do apoio.", videoRef: null },
  { id: "ex-alon", name: "Alongamento posterior da coxa", region: "Posterior da coxa", pose: "seated", steps: ["Sentada, estenda uma perna à frente.", "Incline o tronco com as costas retas.", "Sinta o alongamento, sem dor, e respire."], caution: "Não balance o corpo.", videoRef: null },
  { id: "ex-cam", name: "Caminhada leve em casa", region: "Condicionamento", pose: "stand", steps: ["Caminhe em ritmo confortável pelo corredor ou sala.", "Mantenha a postura ereta e o passo regular."], caution: "Use calçado fechado e antiderrapante.", videoRef: null },
];

const mk = (id: string, name: string, hue: number): { id: string; name: string; initials: string; hue: number } => ({ id, name, initials: name.split(" ").map((p) => p[0]).slice(0, 2).join(""), hue });

/** Monta a demonstração inteira a partir de "hoje". Tudo FICTÍCIO (nomes, valores, datas). */
export const buildSeed = (anchor = todayISO()): Demo => {
  const D = (off: number) => shift(anchor, off); const at = (off: number, hm: string) => `${D(off)}T${hm}`;
  const physio = { ...mk("fi-1", "Dr. Rafael Moreira", 205), council: "CREFITO-3 000000-F (fictício)", specialty: "Fisioterapia Ortopédica" };
  const protocols = [
    { id: "pr-joelho", name: "Reabilitação do joelho", totalSessions: 10 as const, definedBy: physio.name, definedOn: D(-49), priceCents: 160000 },
    { id: "pr-ombro", name: "Recuperação do ombro", totalSessions: 5 as const, definedBy: physio.name, definedOn: D(-40), priceCents: 80000 },
    { id: "pr-lombar", name: "Cuidado com a lombar", totalSessions: 10 as const, definedBy: physio.name, definedOn: D(-45), priceCents: 160000 },
    { id: "pr-quadril", name: "Mobilidade do quadril", totalSessions: 5 as const, definedBy: physio.name, definedOn: D(-60), priceCents: 80000 },
  ];
  const patients: Patient[] = [
    { ...mk("pa-1", "Marina Duarte", 330), code: "#1042", age: 58, protocolId: "pr-joelho", phase: "tratamento", goal: "Voltar a caminhar com conforto", physioId: physio.id, since: D(-49) },
    { ...mk("pa-2", "Carlos Menezes", 160), code: "#1051", age: 47, protocolId: "pr-ombro", phase: "reavaliacao", goal: "Levantar o braço para pegar objetos no armário", physioId: physio.id, since: D(-40) },
    { ...mk("pa-3", "Helena Prado", 20), code: "#1038", age: 63, protocolId: "pr-lombar", phase: "tratamento", goal: "Cuidar do jardim sem dor nas costas", physioId: physio.id, since: D(-45) },
    { ...mk("pa-4", "João Batista", 95), code: "#1019", age: 71, protocolId: "pr-quadril", phase: "concluido", goal: "Andar até a padaria sem apoio", physioId: physio.id, since: D(-60) },
    { ...mk("pa-5", "Ana Lima", 275), code: "#1066", age: 39, protocolId: "pr-joelho", phase: "avaliacao", goal: "Retornar à corrida de rua", physioId: physio.id, since: D(0) },
    { ...mk("pa-6", "Pedro Nunes", 45), code: "#1058", age: 52, protocolId: "pr-lombar", phase: "tratamento", goal: "Trabalhar sentado sem dor", physioId: physio.id, since: D(-35) },
  ];
  const A: Appointment[] = []; let n = 0;
  const add = (p: string, off: number, hm: string, status: Appointment["status"], kind: Appointment["kind"] = "atendimento", sessionNo?: number, place: Appointment["place"] = "Domicílio") => { A.push({ id: `ap-${++n}`, patientId: p, at: at(off, hm), durationMin: kind === "avaliacao" ? 60 : 45, kind, status, place, sessionNo }); };
  // Marina (paciente da experiência): 10 encontros contratados · 5 realizados · 1 falta · 1 cancelamento tardio · 3 agendados = saldo disponível 3
  add("pa-1", -49, "09:00", "done", "avaliacao", 1); add("pa-1", -42, "09:00", "done", "atendimento", 2); add("pa-1", -35, "09:00", "done", "atendimento", 3); add("pa-1", -28, "09:00", "no_show");
  add("pa-1", -21, "09:00", "done", "atendimento", 4); add("pa-1", -14, "09:00", "cancelled_late"); add("pa-1", -7, "09:00", "done", "atendimento", 5);
  add("pa-1", 1, "09:00", "scheduled"); add("pa-1", 4, "09:00", "scheduled"); add("pa-1", 8, "09:00", "scheduled", "reavaliacao");
  // Carlos
  add("pa-2", -40, "10:00", "done", "avaliacao", 1); add("pa-2", -33, "10:00", "done", "atendimento", 2); add("pa-2", -31, "10:00", "done", "atendimento", 3); add("pa-2", -19, "10:00", "no_show"); add("pa-2", -12, "10:00", "done", "atendimento", 4);
  add("pa-2", 0, "08:00", "done", "atendimento", 5); add("pa-2", 1, "10:00", "scheduled", "reavaliacao"); add("pa-2", -9, "15:00", "cancelled");
  // Helena
  add("pa-3", -45, "11:00", "done", "avaliacao", 1); add("pa-3", -38, "11:00", "done", "atendimento", 2); add("pa-3", -31, "11:00", "done", "atendimento", 3); add("pa-3", -24, "11:00", "done", "atendimento", 4); add("pa-3", -17, "11:00", "no_show");
  add("pa-3", -10, "11:00", "done", "atendimento", 5); add("pa-3", -3, "11:00", "done", "atendimento", 6); add("pa-3", 0, "09:30", "confirmed", "atendimento", 7); add("pa-3", 6, "11:00", "scheduled", "atendimento", 8);
  // João (concluído)
  add("pa-4", -60, "14:00", "done", "avaliacao", 1); add("pa-4", -54, "14:00", "done", "atendimento", 2); add("pa-4", -47, "14:00", "done", "atendimento", 3); add("pa-4", -34, "14:00", "done", "atendimento", 4); add("pa-4", -30, "14:00", "done", "atendimento", 5); add("pa-4", -20, "14:00", "done", "reavaliacao", 6);
  add("pa-4", 0, "16:30", "cancelled", "atendimento", undefined, "Clínica");
  // Ana (nova)
  add("pa-5", 0, "14:00", "scheduled", "avaliacao", 1, "Clínica"); add("pa-5", 7, "14:00", "scheduled");
  // Pedro
  add("pa-6", -35, "15:00", "done", "avaliacao", 1); add("pa-6", -30, "15:00", "done", "atendimento", 2); add("pa-6", -21, "15:00", "done", "atendimento", 3); add("pa-6", -14, "15:00", "done", "atendimento", 4); add("pa-6", -8, "15:00", "cancelled_late");
  add("pa-6", -5, "15:00", "done", "atendimento", 5); add("pa-6", -1, "15:00", "done", "atendimento", 6); add("pa-6", 0, "11:00", "scheduled", "atendimento", 7); add("pa-6", 4, "15:00", "scheduled");

  // notas de evolução (compartilháveis x internas). Pendências de evolução: Marina (-7), Helena (-3), Pedro (-1) e Carlos (hoje 08:00).
  const notes: Note[] = []; let nn = 0;
  const evolved = new Set<string>();
  const note = (p: string, off: number, shared: boolean, text: string) => { const ap = A.find((a) => a.patientId === p && a.at === at(off, a.at.slice(11))) ; const id = `nt-${++nn}`; notes.push({ id, patientId: p, apptId: ap?.id, date: D(off), shared, text, author: physio.name }); if (ap && !shared) evolved.add(ap.id); if (ap && shared) evolved.add(ap.id); };
  note("pa-1", -42, true, "Boa resposta ao primeiro treino. Mantenha a rotina em dias alternados e observe o joelho ao final do dia.");
  note("pa-1", -42, false, "Leve sensibilidade retropatelar à carga. Reavaliar na 3ª sessão.");
  note("pa-1", -35, true, "Você já consegue dobrar mais o joelho. Vamos progredir os agachamentos com apoio.");
  note("pa-1", -21, true, "Ótimo avanço na amplitude e na confiança nas escadas. A rotina foi ajustada.");
  note("pa-1", -21, false, "Aumentar carga de forma gradual; atenção à adesão nos fins de semana.");
  note("pa-2", -26, true, "Mobilidade do ombro melhorando. Continue os exercícios pendulares.");
  note("pa-2", -12, true, "Boa evolução na elevação do braço. Reavaliação será feita na próxima semana.");
  note("pa-3", -10, true, "Dor lombar menos frequente. Mantenha os alongamentos.");
  note("pa-4", -20, true, "Metas atingidas. Alta combinada com orientação de manutenção.");
  note("pa-6", -5, true, "Evoluindo bem na postura sentado. Pausas ativas a cada 50 minutos.");

  const measures: Measure[] = [
    { id: "me-disc", patientId: "pa-1", label: "Desconforto ao caminhar", unit: "0–10", source: "paciente", better: "lower", goal: 2, hint: "Relato do paciente: 0 = nenhum desconforto, 10 = o pior possível.", points: [{ date: D(-49), value: 7 }, { date: D(-35), value: 6 }, { date: D(-21), value: 5 }, { date: D(-7), value: 4 }] },
    { id: "me-flex", patientId: "pa-1", label: "Flexão do joelho direito", unit: "graus", source: "profissional", better: "higher", goal: 120, hint: "Medida pelo fisioterapeuta com goniômetro.", points: [{ date: D(-49), value: 78 }, { date: D(-35), value: 90 }, { date: D(-21), value: 100 }, { date: D(-7), value: 108 }] },
    { id: "me-conf", patientId: "pa-1", label: "Confiança para subir escadas", unit: "0–10", source: "paciente", better: "higher", goal: 8, hint: "Relato do paciente: 0 = nenhuma confiança, 10 = total.", points: [{ date: D(-49), value: 3 }, { date: D(-35), value: 4 }, { date: D(-21), value: 5 }, { date: D(-7), value: 6 }] },
    { id: "me-tug", patientId: "pa-1", label: "Levantar e andar 3 metros (tempo)", unit: "segundos", source: "profissional", better: "lower", goal: 10, hint: "Atividade funcional cronometrada pelo fisioterapeuta.", points: [{ date: D(-49), value: 14.5 }, { date: D(-21), value: 12.4 }, { date: D(-7), value: 11.2 }] },
    { id: "me-ombro", patientId: "pa-2", label: "Elevação do braço", unit: "graus", source: "profissional", better: "higher", goal: 160, hint: "Medida pelo fisioterapeuta.", points: [{ date: D(-40), value: 95 }, { date: D(-26), value: 125 }, { date: D(-12), value: 142 }] },
    { id: "me-lomb", patientId: "pa-3", label: "Dor nas costas", unit: "0–10", source: "paciente", better: "lower", goal: 2, hint: "Relato do paciente.", points: [{ date: D(-45), value: 8 }, { date: D(-24), value: 6 }, { date: D(-3), value: 5 }] },
    { id: "me-quad", patientId: "pa-4", label: "Distância caminhada sem apoio", unit: "metros", source: "profissional", better: "higher", goal: 400, hint: "Teste de caminhada cronometrado.", points: [{ date: D(-60), value: 120 }, { date: D(-34), value: 280 }, { date: D(-20), value: 410 }] },
    { id: "me-ped", patientId: "pa-6", label: "Dor ao ficar sentado", unit: "0–10", source: "paciente", better: "lower", goal: 2, hint: "Relato do paciente.", points: [{ date: D(-35), value: 7 }, { date: D(-14), value: 5 }, { date: D(-1), value: 4 }] },
  ];
  const goals = [
    { id: "go-1", patientId: "pa-1", title: "Voltar a caminhar com conforto", measureId: "me-disc", status: "em_andamento" as const, note: "Meta principal definida na avaliação inicial.", primary: true },
    { id: "go-2", patientId: "pa-1", title: "Subir um lance de escada sem apoio", measureId: "me-conf", status: "em_andamento" as const, note: "Hoje sobe 10 degraus com apoio leve." },
    { id: "go-3", patientId: "pa-1", title: "Caminhar 30 minutos seguidos", status: "em_andamento" as const, note: "Referência atual: 18 minutos (avaliação do profissional)." },
    { id: "go-4", patientId: "pa-4", title: "Andar até a padaria sem apoio", measureId: "me-quad", status: "atingida" as const, note: "Meta atingida na reavaliação.", primary: true },
  ];
  const achievements = [
    { id: "ac-1", patientId: "pa-1", date: D(-14), text: "Subiu 10 degraus de escada com apoio leve, sem pausa." },
    { id: "ac-2", patientId: "pa-1", date: D(-21), text: "Passou a flexionar o joelho a 100°, sem dor ao final do movimento." },
    { id: "ac-3", patientId: "pa-1", date: D(-7), text: "Completou a semana de exercícios 4 vezes, como combinado." },
  ];
  // rotina da Marina: A (seg/qua/sex), B (ter/qui), C (sáb/dom) — assim sempre há algo previsto para o dia
  const routines: Routine[] = [
    { id: "rt-a", patientId: "pa-1", name: "Rotina A · Força", days: [1, 3, 5], version: 2, assignedAt: D(-21), note: "Faça com calma e pare se sentir dor forte.", active: true, items: [{ exerciseId: "ex-agach", sets: 3, reps: 10, guidance: "Desça até onde estiver confortável." }, { exerciseId: "ex-ponte", sets: 3, reps: 12, guidance: "Segure 2 segundos no alto." }, { exerciseId: "ex-elev", sets: 3, reps: 10, guidance: "Mantenha o joelho esticado." }] },
    { id: "rt-b", patientId: "pa-1", name: "Rotina B · Mobilidade e equilíbrio", days: [2, 4], version: 2, assignedAt: D(-21), note: "Use o apoio da bancada no equilíbrio.", active: true, items: [{ exerciseId: "ex-mob", sets: 3, durationS: 30, guidance: "Movimento lento e contínuo." }, { exerciseId: "ex-equi", sets: 3, durationS: 20, guidance: "Troque de perna a cada série." }, { exerciseId: "ex-alon", sets: 2, durationS: 30, guidance: "Sem dor, respirando." }] },
    { id: "rt-c", patientId: "pa-1", name: "Rotina C · Fim de semana leve", days: [0, 6], version: 1, assignedAt: D(-35), note: "Dia mais leve: mobilidade e uma caminhada curta.", active: true, items: [{ exerciseId: "ex-mob", sets: 2, durationS: 30, guidance: "Sem forçar." }, { exerciseId: "ex-cam", sets: 1, durationS: 300, guidance: "Ritmo confortável, 5 minutos." }] },
    { id: "rt-h", patientId: "pa-3", name: "Rotina lombar", days: [1, 3, 5], version: 1, assignedAt: D(-30), note: "Alongue sem dor.", active: true, items: [{ exerciseId: "ex-ponte", sets: 3, reps: 10, guidance: "Sem arquear a lombar." }, { exerciseId: "ex-alon", sets: 2, durationS: 30, guidance: "Respire." }] },
    { id: "rt-p", patientId: "pa-6", name: "Pausas ativas", days: [1, 2, 3, 4, 5], version: 1, assignedAt: D(-20), note: "Faça no trabalho.", active: true, items: [{ exerciseId: "ex-alon", sets: 2, durationS: 30, guidance: "A cada 50 min." }] },
  ];
  // registros de exercícios (autodeclarados). O mais recente da Marina traz uma dúvida SEM resposta (feedback pendente para o fisio).
  const logs: ExerciseLog[] = []; let ln = 0;
  const routineFor = (p: string, day: string) => routines.find((r) => r.patientId === p && r.days.includes(weekdayOf(day)));
  const log = (p: string, off: number, result: LogResult, diff = "", doubt = "", reviewed = true, reply = "") => {
    const day = D(off); const r = routineFor(p, day); if (!r) return; const ex = r.items[0].exerciseId;
    logs.push({ id: `lg-${++ln}`, patientId: p, routineId: r.id, exerciseId: ex, date: day, result, difficulty: diff, doubt, demoViewed: off % 2 === 0, reviewedAt: reviewed ? D(off + 1) : undefined, reply: reply || undefined });
  };
  [[-12, "concluido"], [-11, "concluido"], [-10, "parcial", "Fiquei cansada no meio das séries."], [-8, "concluido"], [-6, "concluido"], [-5, "nao_consegui", "Dor no joelho depois de subir escada."], [-4, "concluido"], [-3, "concluido"], [-2, "parcial", "Senti repuxar atrás da coxa."]]
    .forEach(([o, r, d]) => log("pa-1", o as number, r as LogResult, (d as string) ?? "", "", true, d ? "Obrigado pelo aviso! Vamos ajustar a carga na próxima sessão." : ""));
  log("pa-1", -1, "concluido", "", "Senti um leve repuxar atrás da coxa na ponte. É normal?", false);
  log("pa-3", -2, "parcial", "Dor leve ao alongar.", "Posso alongar com a perna mais dobrada?", false);
  log("pa-3", -4, "concluido"); log("pa-6", -3, "concluido"); log("pa-6", -2, "concluido");

  // pagamentos e repasses (regra FICTÍCIA: R$ 100 por sessão elegível = atendimento realizado em pacote pago)
  const payments = [
    { id: "pg-1", patientId: "pa-1", date: D(-50), label: "Reabilitação do joelho — parcela 1 de 2", cents: 80000, method: "Pix", status: "pago" as const },
    { id: "pg-2", patientId: "pa-1", date: D(-20), label: "Reabilitação do joelho — parcela 2 de 2", cents: 80000, method: "Cartão de crédito", status: "pago" as const },
  ];
  const doneInWindow = A.filter((a) => a.status === "done" && a.at.slice(0, 10) >= D(-29)).sort((x, y) => x.at.localeCompare(y.at));
  const payouts: Payout[] = doneInWindow.map((a, i) => ({ id: `po-${i + 1}`, apptId: a.id, kind: "sessao" as const, cents: 10000, state: i < 5 ? "pago" as const : i < 8 ? "liberado" as const : "apurado" as const, date: a.at.slice(0, 10), label: "Sessão elegível" }));
  payouts.push({ id: "po-aj", apptId: null, kind: "ajuste", cents: 5000, state: "liberado", date: D(-6), label: "Ajuste: sessão de avaliação fora do horário (aprovado pela administração)" });
  payouts.push({ id: "po-es", apptId: null, kind: "estorno", cents: -10000, state: "apurado", date: D(-2), label: "Estorno: sessão devolvida ao paciente por reagendamento da clínica" });

  A.forEach((a) => { if (evolved.has(a.id)) a.evolutionNoteId = notes.find((x) => x.apptId === a.id)?.id; });
  return {
    version: 2, anchor, physio, patients, protocols, appts: A, library: EX, routines, logs, measures, goals, achievements, notes, reassessments: [
      { id: "re-1", patientId: "pa-4", date: D(-20), decision: "concluir", reason: "Metas atingidas e autonomia recuperada.", sharedMessage: "Parabéns! Você atingiu suas metas. Mantenha os exercícios de manutenção." },
    ],
    recommendations: [], messages: [{ id: "ms-1", patientId: "pa-1", from: "equipe", text: "Olá, Marina! Qualquer dúvida sobre agenda ou pagamentos, escreva por aqui. Respondemos em até 24 horas.", at: `${D(-48)}T10:00` }],
    checkins: [{ id: "ck-1", patientId: "pa-1", date: D(-1), mood: 4, note: "Dia bom, joelho tranquilo." }], payments, payouts,
    availability: [0, 1, 2, 3, 4, 5, 6].map((w) => ({ weekday: w, enabled: w >= 1 && w <= 5, from: "08:00", to: "17:00" })),
    prefs: { reminderAppt: true, reminderRoutine: true, reminderCheckin: false, shareReported: true }, meId: "pa-1", ratePerSessionCents: 10000,
    admin: buildAdmin(anchor, D, weekdayOf, mk, protocols),
  };
};
