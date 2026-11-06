/** Contratos de dados do PREVIEW do app iOS (dados FICTÍCIOS). Cada interface é a forma que a API do Hub deverá devolver no app definitivo
 *  (ver docs/preview-ios.md): trocar o `store` por chamadas às funções do Hub não deve exigir mudar as telas. Datas são locais, no formato "AAAA-MM-DDTHH:MM". */
export type Role = "patient" | "physio" | "admin";
export type ApptStatus = "scheduled" | "confirmed" | "done" | "no_show" | "cancelled" | "cancelled_late";
export type ApptKind = "avaliacao" | "atendimento" | "reavaliacao";
export type Phase = "avaliacao" | "tratamento" | "reavaliacao" | "concluido";
export type LogResult = "concluido" | "parcial" | "nao_consegui";

export interface Person { id: string; name: string; initials: string; hue: number }
export interface Physio extends Person { council: string; specialty: string }
export interface Protocol { id: string; name: string; totalSessions: 5 | 10; definedBy: string; definedOn: string; priceCents: number }
export interface Patient extends Person { code: string; age: number; protocolId: string; phase: Phase; goal: string; physioId: string; since: string }
export interface Appointment { id: string; patientId: string; at: string; durationMin: number; kind: ApptKind; status: ApptStatus; place: "Domicílio" | "Clínica"; sessionNo?: number; evolutionNoteId?: string; confirmedAt?: string }
export interface Exercise { id: string; name: string; region: string; pose: "stand" | "lying" | "seated"; steps: string[]; caution: string; videoRef: string | null }
export interface RoutineItem { exerciseId: string; sets: number; reps?: number; durationS?: number; guidance: string }
export interface Routine { id: string; patientId: string; name: string; days: number[]; items: RoutineItem[]; version: number; assignedAt: string; note: string; active: boolean }
export interface ExerciseLog { id: string; patientId: string; routineId: string; exerciseId: string; date: string; result: LogResult; difficulty: string; doubt: string; demoViewed: boolean; reviewedAt?: string; reply?: string }
export interface MeasurePoint { date: string; value: number }
export interface Measure { id: string; patientId: string; label: string; unit: string; source: "paciente" | "profissional"; better: "lower" | "higher"; goal: number; points: MeasurePoint[]; hint: string }
export interface Goal { id: string; patientId: string; title: string; measureId?: string; status: "em_andamento" | "atingida"; note: string; primary?: boolean }
export interface Achievement { id: string; patientId: string; date: string; text: string }
export interface Note { id: string; patientId: string; apptId?: string; date: string; shared: boolean; text: string; author: string }
export interface Reassessment { id: string; patientId: string; date: string; decision: "concluir" | "manter" | "recomendar"; reason: string; recommendedProtocol?: string; sharedMessage: string }
export interface Recommendation { id: string; patientId: string; protocolName: string; reason: string; createdAt: string; interested: boolean }
export interface Message { id: string; patientId: string; from: "paciente" | "equipe"; text: string; at: string }
export interface Checkin { id: string; patientId: string; date: string; mood: 1 | 2 | 3 | 4 | 5; note: string }
export interface Payment { id: string; patientId: string; date: string; label: string; cents: number; method: string; status: "pago" | "pendente" }
export type PayoutState = "apurado" | "liberado" | "pago";
export interface Payout { id: string; apptId: string | null; kind: "sessao" | "ajuste" | "estorno"; cents: number; state: PayoutState; date: string; label: string }
export interface AvailRule { weekday: number; enabled: boolean; from: string; to: string }
export interface Prefs { reminderAppt: boolean; reminderRoutine: boolean; reminderCheckin: boolean; shareReported: boolean }

export interface Demo {
  version: 2; anchor: string;                              // dia "hoje" da demonstração (AAAA-MM-DD)
  physio: Physio; patients: Patient[]; protocols: Protocol[]; appts: Appointment[]; library: Exercise[]; routines: Routine[]; logs: ExerciseLog[];
  measures: Measure[]; goals: Goal[]; achievements: Achievement[]; notes: Note[]; reassessments: Reassessment[]; recommendations: Recommendation[];
  messages: Message[]; checkins: Checkin[]; payments: Payment[]; payouts: Payout[]; availability: AvailRule[]; prefs: Prefs;
  meId: string;                                           // paciente da experiência "Paciente"
  ratePerSessionCents: number;                            // regra FICTÍCIA do preview: R$ 100 por sessão elegível (padrão de cada produto)
  admin: AdminData;                                       // dados da gestão (experiência Administrador)
}

// ---------------------------------------------------------------- ADMINISTRADOR (gestor/dono). Tudo FICTÍCIO. O Rafael e os pacientes dele são os dados "vivos" compartilhados; o resto da clínica é de apoio.
export interface TeamMember extends Physio { live: boolean; patients: number; sessions30: number; noShowPct: number; adherencePct: number; pendingEvo: number; buckets: { apurado: number; liberado: number; pago: number } }
export interface OtherPatient extends Person { code: string; age: number; protocolId: string; phase: Phase; goal: string; physioId: string; adherencePct: number; done: number; flags: { evolution: number; feedback: number; reassessment: number } }
export interface ExtraAppt { id: string; physioId: string; patientName: string; patientCode: string; at: string; durationMin: number; kind: ApptKind; status: ApptStatus; place: "Domicílio" | "Clínica" }
export type TicketKind = "clinico" | "administrativo";
export type TicketStatus = "aberto" | "respondido" | "fechado";
export interface TicketMsg { from: "paciente" | "equipe"; text: string; at: string; internal?: boolean }
export interface Ticket { id: string; patientId: string | null; patientName: string; patientCode: string; kind: TicketKind; subject: string; openedAt: string; status: TicketStatus; closedAt?: string; thread: TicketMsg[] }
export interface Program { id: string; name: string; sessions: number; priceCents: number; active: boolean; status: "ativo" | "em_criacao"; audience: string }
export interface ShareRule { protocolId: string; shareCents: number }
export type RepStatus = "pendente" | "verificado" | "suspenso" | "revogado";
export interface Representation { id: string; patientName: string; patientCode: string; patientAge: number; responsible: string; relation: "Responsável legal" | "Tutor" | "Curador" | "Procurador" | "Cuidador" | "Delegado"; status: RepStatus; docs: number }
export interface AccessEntry { id: string; at: string; who: string; patientId: string | null; patientName: string; what: string }
export interface Sale { id: string; date: string; patientName: string; protocolId: string; cents: number; status: "pago" | "pendente"; physioId: string }
export interface AdminData { name: string; team: TeamMember[]; others: OtherPatient[]; extraAppts: ExtraAppt[]; tickets: Ticket[]; programs: Program[]; rules: ShareRule[]; representations: Representation[]; accessLog: AccessEntry[]; sales: Sale[] }
