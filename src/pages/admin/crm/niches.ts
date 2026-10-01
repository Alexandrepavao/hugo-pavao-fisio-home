/** Nichos do CRM = tipo do funil da oportunidade (`pipelines.kind`). A ficha do lead mostra os campos do nicho; as chaves e os valores aceitos são os MESMOS de
 *  `private.lead_profile_spec` (migration 077) — o servidor recusa o que não estiver aqui. Só campos administrativos: nada clínico. */
export interface NicheField { key: string; label: string; options?: [string, string][]; placeholder?: string }
export interface Niche { kind: string; label: string; short: string; fields: NicheField[]; note?: string }

export const NICHES: Record<string, Niche> = {
  patients: {
    kind: "patients", label: "Paciente · HP Fisioterapia", short: "Fisioterapia",
    note: "Campos administrativos. Não registre dados clínicos (diagnóstico, exames, condutas) aqui.",
    fields: [
      { key: "contact_reason", label: "Motivo do contato (administrativo)", placeholder: "Ex.: quer conhecer valores e horários" },
      { key: "preferred_period", label: "Melhor período", options: [["manha", "Manhã"], ["tarde", "Tarde"], ["noite", "Noite"], ["indiferente", "Indiferente"]] },
      { key: "payment_pref", label: "Forma de atendimento", options: [["particular", "Particular"], ["convenio", "Convênio"], ["a_definir", "A definir"]] },
      { key: "referred_by", label: "Indicado por" },
    ],
  },
  education: {
    kind: "education", label: "Aluno · HP Academy", short: "Academy",
    fields: [
      { key: "course_interest", label: "Curso ou mentoria de interesse" },
      { key: "professional_profile", label: "Perfil", options: [["fisioterapeuta", "Fisioterapeuta"], ["estudante", "Estudante"], ["outro_profissional_saude", "Outro profissional da saúde"], ["outro", "Outro"]] },
      { key: "council_registry", label: "Registro no conselho", placeholder: "Ex.: CREFITO-3/000000-F" },
      { key: "format_pref", label: "Formato preferido", options: [["online", "Online"], ["presencial", "Presencial"], ["indiferente", "Indiferente"]] },
    ],
  },
  partners: {
    kind: "partners", label: "Parceiro", short: "Parceiros",
    fields: [
      { key: "partnership_type", label: "Tipo de parceria" },
      { key: "organization", label: "Organização" },
      { key: "city_uf", label: "Cidade/UF" },
      { key: "council_registry", label: "Registro no conselho" },
    ],
  },
  companies: {
    kind: "companies", label: "Empresa", short: "Empresas",
    fields: [
      { key: "company_name", label: "Empresa" },
      { key: "contact_role", label: "Cargo do contato" },
      { key: "employees_range", label: "Colaboradores", options: [["ate_10", "Até 10"], ["11_50", "11 a 50"], ["51_200", "51 a 200"], ["acima_200", "Acima de 200"]] },
      { key: "program_interest", label: "Programa de interesse" },
    ],
  },
};

export const nicheOf = (kind: string | null | undefined): Niche | null => (kind ? NICHES[kind] ?? null : null);

export const STATUS_LABEL: Record<string, string> = { open: "Aberta", pending: "Aguardando retorno", resolved: "Resolvida" };
export const CHANNEL_LABEL: Record<string, string> = { whatsapp: "WhatsApp", phone: "Telefone", email: "E-mail" };
