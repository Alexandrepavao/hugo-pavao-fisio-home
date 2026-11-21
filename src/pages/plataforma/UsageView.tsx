export interface UsageData {
  usage: Record<string, unknown>;
  limits: { metric: string; value: number; limit: number | null; state: "ok" | "perto" | "acima" | "nao_configurado" | "ilimitado" | "zero" }[];
  enforcement: string | null; note?: string;
}

const LABEL: Record<string, string> = {
  staff_users: "Usuários da equipe", professionals: "Profissionais", units: "Unidades", active_patients: "Pacientes ativos", storage_bytes: "Armazenamento", route_requests_month: "Consultas de rota no mês",
};
const STATE: Record<string, { text: string; cls: string }> = {
  ok: { text: "dentro do limite", cls: "hp-badge-success" }, perto: { text: "perto do limite", cls: "hp-badge-warning" }, acima: { text: "acima do limite", cls: "hp-badge-danger" },
  nao_configurado: { text: "limite não configurado", cls: "" }, ilimitado: { text: "ilimitado", cls: "" }, zero: { text: "limite zero", cls: "hp-badge-warning" },
};
const fmtBytes = (b: number) => (b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1).replace(".", ",")} MB`);

/** Consumo × limites. São CONTAGENS de uso (não custo): excedente não é cobrado automaticamente e limites nunca apagam dados nem bloqueiam histórico/exportação. */
const UsageView = ({ data }: { data: UsageData }) => {
  const lim = new Map(data.limits.map((l) => [l.metric, l]));
  const keys = Object.keys(LABEL).filter((k) => typeof data.usage[k] === "number" || typeof data.usage[k] === "string");
  return (
    <div>
      <ul className="grid gap-1.5 text-sm" data-testid="usage-list">
        {keys.map((k) => {
          const v = Number(data.usage[k]); const l = lim.get(k); const st = l ? STATE[l.state] : null;
          return (
            <li key={k} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="text-muted-foreground">{LABEL[k]}</span>
              <span className="tabular">{k === "storage_bytes" ? fmtBytes(v) : v}{l && l.limit != null ? ` de ${l.limit}` : ""} {st && <span className={`hp-badge ${st.cls}`} data-testid={`estado-${k}`}>{st.text}</span>}</span>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground mt-3">Aplicação dos limites: <strong>{data.enforcement === "block_new" ? "bloqueia novas criações acima do limite" : "somente aviso"}</strong>. {data.note}</p>
    </div>
  );
};
export default UsageView;
