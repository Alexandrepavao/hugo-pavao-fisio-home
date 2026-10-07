import { LEAD_TYPE, isLeadKind } from "./leadTypes";

/** Selo do tipo de lead (a partir do tipo do funil ou da lista). `short` mostra o nome curto. */
const LeadTypeBadge = ({ kind, short = false }: { kind: string | null | undefined; short?: boolean }) => {
  if (!isLeadKind(kind)) return <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">{kind ? "Outro" : "Sem tipo"}</span>;
  const t = LEAD_TYPE[kind]; const Icon = t.icon;
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${t.chip}`} title={t.description} data-kind={kind}><Icon size={12} aria-hidden />{short ? t.short : t.label}</span>;
};

export default LeadTypeBadge;
