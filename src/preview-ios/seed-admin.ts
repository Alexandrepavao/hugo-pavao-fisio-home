import type { AccessEntry, AdminData, ExtraAppt, OtherPatient, Phase, Program, Representation, Sale, Ticket, TeamMember } from "./types";

type Mk = (id: string, name: string, hue: number) => { id: string; name: string; initials: string; hue: number };

/** Dados da clínica ao redor do Rafael (FICTÍCIOS). O Rafael e os pacientes dele são "vivos" (mesmo estado dos outros apps); o resto serve para a gestão enxergar a clínica inteira. */
export const buildAdmin = (anchor: string, D: (off: number) => string, weekdayOf: (day: string) => number, mk: Mk, protocols: { id: string; priceCents: number }[]): AdminData => {
  const team: TeamMember[] = [
    { ...mk("fi-1", "Dr. Rafael Moreira", 205), council: "CREFITO-3 000000-F (fictício)", specialty: "Fisioterapia Ortopédica", live: true, patients: 0, sessions30: 0, noShowPct: 0, adherencePct: 0, pendingEvo: 0, buckets: { apurado: 0, liberado: 0, pago: 0 } },
    { ...mk("fi-2", "Dra. Beatriz Campos", 150), council: "CREFITO-3 000001-F (fictício)", specialty: "Fisioterapia Neurofuncional", live: false, patients: 2, sessions30: 18, noShowPct: 6, adherencePct: 54, pendingEvo: 1, buckets: { apurado: 40000, liberado: 50000, pago: 90000 } },
    { ...mk("fi-3", "Dr. Lucas Almeida", 260), council: "CREFITO-3 000002-F (fictício)", specialty: "Fisioterapia Geriátrica", live: false, patients: 2, sessions30: 22, noShowPct: 9, adherencePct: 61, pendingEvo: 0, buckets: { apurado: 60000, liberado: 40000, pago: 120000 } },
    { ...mk("fi-4", "Dra. Camila Rocha", 15), council: "CREFITO-3 000003-F (fictício)", specialty: "Fisioterapia Desportiva", live: false, patients: 4, sessions30: 15, noShowPct: 12, adherencePct: 47, pendingEvo: 2, buckets: { apurado: 30000, liberado: 30000, pago: 90000 } },
  ];
  const op = (id: string, name: string, hue: number, code: string, age: number, protocolId: string, phase: Phase, goal: string, physioId: string, adherencePct: number, done: number, flags: Partial<OtherPatient["flags"]> = {}): OtherPatient =>
    ({ ...mk(id, name, hue), code, age, protocolId, phase, goal, physioId, adherencePct, done, flags: { evolution: 0, feedback: 0, reassessment: 0, ...flags } });
  const others: OtherPatient[] = [
    op("ot-1", "Ricardo Salles", 300, "#1033", 45, "pr-lombar", "tratamento", "Voltar a jogar futebol com os amigos", "fi-2", 57, 6, { feedback: 1 }),
    op("ot-2", "Sônia Teixeira", 120, "#1047", 66, "pr-quadril", "tratamento", "Subir no ônibus sem apoio", "fi-2", 50, 3, { evolution: 1 }),
    op("ot-3", "Alice Ferraz", 340, "#1029", 79, "pr-quadril", "reavaliacao", "Caminhar até a praça", "fi-3", 64, 5, { reassessment: 1 }),
    op("ot-4", "Antônio Rocha", 70, "#1052", 74, "pr-joelho", "tratamento", "Descer escadas com segurança", "fi-3", 58, 4),
    op("ot-5", "Bruno Tavares", 190, "#1061", 28, "pr-joelho", "tratamento", "Voltar ao treino de corrida", "fi-4", 43, 5, { evolution: 1 }),
    op("ot-6", "Larissa Gomes", 235, "#1063", 31, "pr-ombro", "concluido", "Nadar sem dor", "fi-4", 70, 5),
    op("ot-7", "Felipe Dias", 25, "#1068", 24, "pr-ombro", "avaliacao", "Voltar ao vôlei", "fi-4", 0, 0),
    op("ot-8", "Patrícia Vaz", 280, "#1070", 44, "pr-lombar", "tratamento", "Dormir sem dor nas costas", "fi-4", 48, 2, { evolution: 1 }),
  ];
  // agenda das outras fisioterapeutas: -3 a +7 dias, só dias úteis, horários fixos por profissional
  const extraAppts: ExtraAppt[] = []; let n = 0;
  const slots: Record<string, string[]> = { "fi-2": ["08:00", "10:30", "15:00"], "fi-3": ["09:00", "13:30", "16:00"], "fi-4": ["07:30", "11:00", "14:30", "17:00"] };
  const pool: Record<string, OtherPatient[]> = { "fi-2": others.filter((o) => o.physioId === "fi-2"), "fi-3": others.filter((o) => o.physioId === "fi-3"), "fi-4": others.filter((o) => o.physioId === "fi-4") };
  for (let off = -3; off <= 7; off++) {
    const day = D(off); const w = weekdayOf(day); if (w === 0 || w === 6) continue;
    Object.entries(slots).forEach(([fid, hs]) => hs.forEach((hm, i) => {
      n++; if ((n + i) % 3 === 0) return; const pt = pool[fid][(n + i) % pool[fid].length];
      const past = off < 0 || (off === 0 && Number(hm.slice(0, 2)) < 12); const status = past ? ((n % 11 === 0) ? "no_show" : "done") : "scheduled";
      extraAppts.push({ id: `ex-${n}`, physioId: fid, patientName: pt.name, patientCode: pt.code, at: `${day}T${hm}`, durationMin: 45, kind: i === 0 && off % 4 === 0 ? "reavaliacao" : "atendimento", status, place: i % 2 ? "Clínica" : "Domicílio" });
    }));
  }
  const tickets: Ticket[] = [
    { id: "tk-1", patientId: null, patientName: "Alice Ferraz", patientCode: "#1029", kind: "clinico", subject: "Dor nova no quadril depois da caminhada", openedAt: `${D(-2)}T09:00`, status: "aberto", thread: [{ from: "paciente", text: "Depois da caminhada de ontem senti uma dor diferente no quadril. Devo continuar os exercícios?", at: `${D(-2)}T09:00` }] },
    { id: "tk-2", patientId: null, patientName: "Bruno Tavares", patientCode: "#1061", kind: "clinico", subject: "Dúvida sobre a carga do agachamento", openedAt: `${D(-1)}T18:00`, status: "aberto", thread: [{ from: "paciente", text: "Posso aumentar o peso do agachamento esta semana?", at: `${D(-1)}T18:00` }] },
    { id: "tk-3", patientId: null, patientName: "Ricardo Salles", patientCode: "#1033", kind: "administrativo", subject: "Segunda via do comprovante de pagamento", openedAt: `${D(0)}T09:00`, status: "aberto", thread: [{ from: "paciente", text: "Preciso da segunda via do comprovante para o reembolso do plano.", at: `${D(0)}T09:00` }] },
    { id: "tk-4", patientId: null, patientName: "Sônia Teixeira", patientCode: "#1047", kind: "administrativo", subject: "Mudar o horário das sessões", openedAt: `${D(-4)}T14:00`, status: "respondido", thread: [{ from: "paciente", text: "Podemos mudar as sessões para a tarde?", at: `${D(-4)}T14:00` }, { from: "equipe", text: "Claro! Já pedimos à Dra. Beatriz para abrir horários à tarde. Retornamos amanhã.", at: `${D(-3)}T10:00` }] },
    { id: "tk-5", patientId: null, patientName: "Larissa Gomes", patientCode: "#1063", kind: "administrativo", subject: "Nota fiscal do pacote", openedAt: `${D(-6)}T11:00`, status: "fechado", closedAt: `${D(-5)}T15:00`, thread: [{ from: "paciente", text: "Pode enviar a nota fiscal do pacote?", at: `${D(-6)}T11:00` }, { from: "equipe", text: "Enviada por e-mail. Obrigado!", at: `${D(-5)}T15:00` }] },
  ];
  const programs: Program[] = [
    { id: "pg-man", name: "Manutenção mensal", sessions: 4, priceCents: 56000, active: true, status: "ativo", audience: "Pacientes concluídos, só com consentimento comercial e indicação clínica" },
    { id: "pg-fort", name: "Fortalecimento em grupo", sessions: 8, priceCents: 72000, active: true, status: "ativo", audience: "Pacientes em alta que queiram continuar com exercícios supervisionados" },
    { id: "pg-queda", name: "Prevenção de quedas (60+)", sessions: 10, priceCents: 120000, active: false, status: "em_criacao", audience: "Ainda em criação — não é ofertado" },
  ];
  const representations: Representation[] = [
    { id: "rp-1", patientName: "Alice Ferraz", patientCode: "#1029", patientAge: 79, responsible: "Marcos Ferraz (filho)", relation: "Cuidador", status: "verificado", docs: 2 },
    { id: "rp-2", patientName: "Theo Almeida", patientCode: "#1074", patientAge: 8, responsible: "Carla Almeida (mãe)", relation: "Responsável legal", status: "pendente", docs: 1 },
    { id: "rp-3", patientName: "Júlia Prado", patientCode: "#1075", patientAge: 15, responsible: "Sérgio Prado (pai)", relation: "Responsável legal", status: "pendente", docs: 0 },
    { id: "rp-4", patientName: "Antônio Rocha", patientCode: "#1052", patientAge: 74, responsible: "Vera Rocha (esposa)", relation: "Delegado", status: "suspenso", docs: 1 },
  ];
  const accessLog: AccessEntry[] = [
    { id: "ac-1", at: `${D(-6)}T10:12`, who: "Dr. Rafael Moreira (fisioterapeuta responsável)", patientId: "pa-1", patientName: "Marina Duarte", what: "Leitura da ficha e registro de evolução" },
    { id: "ac-2", at: `${D(-3)}T16:40`, who: "Administração (gestor)", patientId: "pa-6", patientName: "Pedro Nunes", what: "Leitura somente da jornada clínica" },
    { id: "ac-3", at: `${D(-1)}T08:05`, who: "Dr. Rafael Moreira (fisioterapeuta responsável)", patientId: "pa-3", patientName: "Helena Prado", what: "Resposta a feedback de exercício" },
  ];
  const sales: Sale[] = [
    { id: "sl-1", date: D(-27), patientName: "Pedro Nunes", protocolId: "pr-lombar", cents: 160000, status: "pago", physioId: "fi-1" },
    { id: "sl-2", date: D(-24), patientName: "Ricardo Salles", protocolId: "pr-lombar", cents: 160000, status: "pago", physioId: "fi-2" },
    { id: "sl-3", date: D(-20), patientName: "Antônio Rocha", protocolId: "pr-joelho", cents: 160000, status: "pago", physioId: "fi-3" },
    { id: "sl-4", date: D(-17), patientName: "Sônia Teixeira", protocolId: "pr-quadril", cents: 80000, status: "pago", physioId: "fi-2" },
    { id: "sl-5", date: D(-14), patientName: "Bruno Tavares", protocolId: "pr-joelho", cents: 160000, status: "pago", physioId: "fi-4" },
    { id: "sl-6", date: D(-11), patientName: "Patrícia Vaz", protocolId: "pr-lombar", cents: 160000, status: "pendente", physioId: "fi-4" },
    { id: "sl-7", date: D(-8), patientName: "Alice Ferraz", protocolId: "pr-quadril", cents: 80000, status: "pago", physioId: "fi-3" },
    { id: "sl-8", date: D(-4), patientName: "Felipe Dias", protocolId: "pr-ombro", cents: 80000, status: "pago", physioId: "fi-4" },
    { id: "sl-9", date: D(-1), patientName: "Carlos Menezes", protocolId: "pr-ombro", cents: 80000, status: "pago", physioId: "fi-1" },
    { id: "sl-10", date: D(0), patientName: "Ana Lima", protocolId: "pr-joelho", cents: 160000, status: "pago", physioId: "fi-1" },
  ];
  void protocols; void anchor;
  return { name: "Administração (demonstração)", team, others, extraAppts, tickets, programs, rules: protocols.map((p) => ({ protocolId: p.id, shareCents: 10000 })), representations, accessLog, sales };
};
