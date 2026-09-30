import { Building2 } from "lucide-react";
import { Badge } from "@/lib/ui";
import { StatusBadge } from "./accShared";
import { useAccQuery, useAccScope, type PeriodStatus } from "./accLib";

interface Dash { period: { status: PeriodStatus }; month_ended: boolean }

/** Barra compacta de escopo, no topo de cada tela: organização (cliente da plataforma) → unidade operacional → competência. */
const AccScopeBar = () => {
  const { ctx, unit, month, months, setUnit, setMonth } = useAccScope();
  const d = useAccQuery<Dash>("acc_dashboard", { p_unit: unit.id, p_month: month }, ["dashboard", unit.id, month]);
  return (
    <div className="hp-card flex flex-wrap items-end gap-3 p-3 mb-4" role="group" aria-label="Escopo: empresa, unidade e competência">
      <div className="min-w-[10rem]">
        <p className="block text-xs text-muted-foreground mb-1">Organização</p>
        <p className="h-9 flex items-center gap-1.5 text-[13px] font-medium"><Building2 size={14} aria-hidden />{ctx.org.name}</p>
      </div>
      <div className="min-w-[11rem]">
        <label htmlFor="acc-unit" className="block text-xs text-muted-foreground mb-1">Unidade operacional</label>
        <select id="acc-unit" value={unit.id} onChange={(e) => setUnit(e.target.value)} className="!h-9 rounded-full !py-0 text-[13px]">
          {ctx.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </div>
      <div className="min-w-[11rem]">
        <label htmlFor="acc-month" className="block text-xs text-muted-foreground mb-1">Competência</label>
        <select id="acc-month" value={month} onChange={(e) => setMonth(e.target.value)} className="!h-9 rounded-full !py-0 text-[13px]">
          {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-2 h-9 ml-auto text-[13px]">
        {unit.legal_entity && <span className="text-muted-foreground hidden md:inline" title="Pessoa jurídica (ADM) vinculada a esta unidade">{unit.legal_entity.name}{unit.legal_entity.cnpj ? ` · CNPJ ${unit.legal_entity.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")}` : ""}</span>}
        {d.data ? <StatusBadge status={d.data.period.status} /> : <Badge>…</Badge>}
      </div>
    </div>
  );
};
export default AccScopeBar;
