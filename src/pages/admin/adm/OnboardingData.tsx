import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const PIX: Record<string, string> = { cpf: "CPF", cnpj: "CNPJ", email: "E-mail", phone: "Celular", random: "Chave aleatória" };
const WORK: Record<string, string> = { pf: "Pessoa física", pj: "Pessoa jurídica" };

interface Data {
  rg: string | null; birth_date: string | null;
  profile: { work_as: string; council_uf: string | null; specialties: string[]; education: string | null; bio: string | null; service_regions: string | null } | null;
  bank: { pix_key_type: string | null; pix_key: string | null; bank_name: string | null; bank_agency: string | null; bank_account: string | null } | null;
  intake: { emergency_name: string | null; emergency_phone: string | null; emergency_relation: string | null; address_reference: string | null; main_complaint: string | null; how_found: string | null; health_consent_at: string | null } | null;
}

const Row = ({ label, value }: { label: string; value: string | null | undefined }) => (value ? <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-sm break-words">{value}</dd></div> : null);

/** Dados recebidos no onboarding (RG, perfil profissional, pagamento, emergência e motivo). Só leitura; as tabelas são protegidas por RLS: só a própria pessoa e gestor/administrativo leem. */
const OnboardingData = ({ personId }: { personId: string }) => {
  const q = useQuery({
    queryKey: ["adm-onboarding-data", personId],
    queryFn: async (): Promise<Data> => {
      const [p, pr, b, i] = await Promise.all([
        supabase.from("people").select("rg, birth_date").eq("id", personId).maybeSingle(),
        supabase.from("professional_profiles").select("work_as, council_uf, specialties, education, bio, service_regions").eq("person_id", personId).maybeSingle(),
        supabase.from("person_bank_info").select("pix_key_type, pix_key, bank_name, bank_agency, bank_account").eq("person_id", personId).maybeSingle(),
        supabase.from("person_intake").select("emergency_name, emergency_phone, emergency_relation, address_reference, main_complaint, how_found, health_consent_at").eq("person_id", personId).maybeSingle(),
      ]);
      return { rg: p.data?.rg ?? null, birth_date: p.data?.birth_date ?? null, profile: pr.data as Data["profile"], bank: b.data as Data["bank"], intake: i.data as Data["intake"] };
    },
  });
  const d = q.data; if (!d) return null;
  const has = d.rg || d.birth_date || d.profile || d.bank || d.intake; if (!has) return null;
  const fmt = (s: string) => new Date(s.length === 10 ? s + "T12:00:00Z" : s).toLocaleDateString("pt-BR");
  return (
    <section data-testid="adm-onboarding-dados">
      <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Dados do onboarding (somente leitura)</h3>
      <div className="rounded-md border border-border p-3 grid gap-4">
        <dl className="grid gap-3 sm:grid-cols-2"><Row label="Data de nascimento" value={d.birth_date ? fmt(d.birth_date) : null} /><Row label="RG" value={d.rg} /></dl>
        {d.profile && (<div><p className="text-xs font-medium mb-1.5">Perfil profissional</p><dl className="grid gap-3 sm:grid-cols-2">
          <Row label="Atua como" value={WORK[d.profile.work_as]} /><Row label="UF do CREFITO" value={d.profile.council_uf} />
          <Row label="Especialidades" value={d.profile.specialties.join(", ")} /><Row label="Regiões de atendimento" value={d.profile.service_regions} />
          <Row label="Formação" value={d.profile.education} /><Row label="Apresentação" value={d.profile.bio} /></dl></div>)}
        {d.bank && (<div><p className="text-xs font-medium mb-1.5">Pagamento dos repasses</p><dl className="grid gap-3 sm:grid-cols-2">
          <Row label="Chave PIX" value={d.bank.pix_key ? `${PIX[d.bank.pix_key_type ?? ""] ?? ""}: ${d.bank.pix_key}` : null} /><Row label="Banco" value={d.bank.bank_name} />
          <Row label="Agência" value={d.bank.bank_agency} /><Row label="Conta" value={d.bank.bank_account} /></dl></div>)}
        {d.intake && (<div><p className="text-xs font-medium mb-1.5">Ficha do paciente</p><dl className="grid gap-3 sm:grid-cols-2">
          <Row label="Contato de emergência" value={[d.intake.emergency_name, d.intake.emergency_relation && `(${d.intake.emergency_relation})`, d.intake.emergency_phone].filter(Boolean).join(" ")} />
          <Row label="Ponto de referência" value={d.intake.address_reference} /><Row label="Como conheceu a HP" value={d.intake.how_found} />
          <Row label="Motivo do atendimento (dado de saúde)" value={d.intake.main_complaint} /><Row label="Uso de dado de saúde autorizado em" value={d.intake.health_consent_at ? fmt(d.intake.health_consent_at) : null} /></dl></div>)}
      </div>
    </section>
  );
};

export default OnboardingData;
