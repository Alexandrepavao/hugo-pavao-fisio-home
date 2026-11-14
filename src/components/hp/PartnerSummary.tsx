import { Badge } from "@/lib/ui";
import { areaTag, areaText, type PartnerProfile } from "@/lib/quizProfile";

/** Tag da área de atuação (ou de interesse) do parceiro, para ficar ao lado do tipo do lead (“Fisioterapeuta · HP Academy”). Sem resposta, não mostra nada. */
export const PartnerAreaTag = ({ profile }: { profile: PartnerProfile | undefined | null }) => {
  const a = areaTag(profile); if (!a) return null;
  return <Badge tone="info"><span data-testid="partner-area-tag" title="Área de atuação ou de interesse informada no formulário de parceria">{a}</span></Badge>;
};

const ROWS: [string, (p: PartnerProfile) => string | null][] = [
  ["Experiência", (p) => p.experience?.label ?? null],
  ["Área de atuação ou interesse", (p) => areaText(p)],
  ["Registro profissional", (p) => (p.registro ? `${p.registro.label}${p.crefito ? ` · ${p.crefito}` : ""}` : null)],
  ["Como atende hoje", (p) => (p.modelo ? `${p.modelo.label}${p.modelo.detalhe ? ` — ${p.modelo.detalhe}` : ""}` : null)],
  ["O que busca na parceria", (p) => p.objetivos],
  ["Programa de clínica própria", (p) => p.programa],
  ["Cidade/UF", (p) => (p.city || p.state_uf ? `${p.city ?? "—"}/${p.state_uf ?? "—"}` : null)],
];

/** Resumo do que o fisioterapeuta respondeu no formulário de parceria, em um bloco só (ficha da oportunidade e resumo do lead). Quem parou no meio mostra o que já respondeu. */
export const PartnerSummary = ({ profile, className = "" }: { profile: PartnerProfile | undefined | null; className?: string }) => {
  if (!profile) return null;
  const rows = ROWS.map(([label, get]) => [label, get(profile)] as const).filter(([, v]) => !!v);
  if (rows.length === 0 && !profile.resumo) return null;
  return (
    <section aria-label="Resumo do parceiro" data-testid="partner-summary" className={`rounded-lg border border-border bg-muted/40 p-3 grid gap-2 ${className}`}>
      <div className="flex flex-wrap items-center gap-2"><h4 className="text-sm font-semibold">Resumo do parceiro</h4>{profile.status !== "completed" && <Badge tone="warning">Formulário não concluído</Badge>}<PartnerAreaTag profile={profile} /></div>
      {rows.length > 0 && (
        <dl className="grid gap-1.5 text-sm">
          {rows.map(([label, v]) => <div key={label} className="grid grid-cols-[9.5rem_1fr] gap-2"><dt className="text-xs text-muted-foreground pt-0.5">{label}</dt><dd className="font-medium break-words">{v}</dd></div>)}
        </dl>)}
      {profile.resumo && (
        <div><p className="text-xs text-muted-foreground mb-0.5">Resumo da experiência profissional</p><p className="text-sm whitespace-pre-line break-words" data-testid="partner-resumo">{profile.resumo}</p></div>)}
    </section>
  );
};
