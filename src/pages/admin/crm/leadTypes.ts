import { Building2, GraduationCap, HeartPulse, Stethoscope, type LucideIcon } from "lucide-react";

/** Os quatro tipos de lead do CRM = o tipo do funil (pipelines.kind). Uma pessoa pode estar em mais de um funil ao mesmo tempo (uma oportunidade aberta por funil). */
export type LeadKind = "patients" | "partners" | "education" | "companies";

export const LEAD_KINDS: LeadKind[] = ["patients", "partners", "education", "companies"];

export const LEAD_TYPE: Record<LeadKind, { label: string; short: string; description: string; icon: LucideIcon; chip: string; dot: string }> = {
  patients: { label: "Paciente", short: "Pacientes", description: "Quer receber atendimento", icon: HeartPulse, chip: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200", dot: "bg-sky-500" },
  partners: { label: "Fisioterapeuta · Equipe", short: "Equipe", description: "Fisioterapeuta que quer fazer parte da equipe HP", icon: Stethoscope, chip: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200", dot: "bg-amber-500" },
  education: { label: "Fisioterapeuta · HP Academy", short: "HP Academy", description: "Fisioterapeuta que quer fazer a HP Academy", icon: GraduationCap, chip: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200", dot: "bg-emerald-500" },
  companies: { label: "Empresa · B2B", short: "Empresas", description: "Empresa ou estabelecimento para parceria B2B", icon: Building2, chip: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200", dot: "bg-violet-500" },
};

export const isLeadKind = (k: string | null | undefined): k is LeadKind => !!k && (LEAD_KINDS as string[]).includes(k);

/** Nome mostrado para um funil: o do TIPO de lead (Paciente, Fisioterapeuta · Equipe, Fisioterapeuta · HP Academy, Empresa · B2B); funil livre mantém o próprio nome. */
export const pipeLabel = (p: { name: string; kind: string }) => (isLeadKind(p.kind) ? LEAD_TYPE[p.kind].label : p.name);
