import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/lib/supabase";
import { brl, fmtDate } from "@/lib/format";
import { PageHead, State, Table, Td } from "@/lib/ui";
import { PeriodFilter } from "@/lib/PeriodFilter";
import { presetRange, type RangePreset } from "@/lib/period";
import { axisBrl, iso, useUnits } from "./shared";

interface Row { month: string; realized_in_cents: number; realized_out_cents: number; forecast_in_cents: number; forecast_out_cents: number }

const FinanceCashFlow = () => {
  const [unit, setUnit] = useState("");
  const [preset, setPreset] = useState<RangePreset>("personalizado");
  const today = new Date();
  const [from, setFrom] = useState(iso(new Date(today.getFullYear(), today.getMonth() - 5, 1)));
  const [to, setTo] = useState(iso(new Date(today.getFullYear(), today.getMonth() + 3, 1)));
  const units = useUnits();
  const cash = useQuery({ queryKey: ["cash-full", from, to, unit], queryFn: async () => {
    const { data, error } = await supabase.rpc("cash_flow_monthly", { p_from: from, p_to: to, p_unit: unit || null }); if (error) throw error; return data as Row[];
  } });
  const chart = (cash.data ?? []).map((r) => ({ mes: fmtDate(r.month + "T12:00:00Z").slice(0, 6), Recebido: r.realized_in_cents / 100, Pago: r.realized_out_cents / 100, "Saldo do mês": (r.realized_in_cents - r.realized_out_cents) / 100 }));

  return (
    <div>
      <PageHead eyebrow="Financeiro" title="Fluxo de caixa" hint="Realizado = pagamentos e despesas efetivos, pelo mês do pagamento. Previsto = parcelas contratadas e contas a pagar em aberto, pelo mês do vencimento (a projeção de mensalidades fica separada em Recorrência)." actions={<PeriodFilter preset={preset} from={from} to={to} unit={unit} units={units.data} defaultPreset="personalizado"
          onPreset={(p) => { setPreset(p); if (p !== "personalizado") { const r = presetRange(p); setFrom(r.from); setTo(r.to); } }} onFrom={setFrom} onTo={setTo} onUnit={setUnit}
          onClear={() => { setPreset("personalizado"); setFrom(iso(new Date(today.getFullYear(), today.getMonth() - 5, 1))); setTo(iso(new Date(today.getFullYear(), today.getMonth() + 3, 1))); setUnit(""); }} />} />
      <State loading={cash.isLoading} error={cash.error} empty={cash.data?.length === 0} />
      {chart.length > 0 && (
        <div className="hp-card p-4 mb-6" style={{ height: 300 }}><ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chart}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="mes" fontSize={12} /><YAxis fontSize={12} tickFormatter={axisBrl} />
            <Tooltip formatter={(v: number) => brl(Math.round(v * 100))} /><Legend />
            <Bar dataKey="Recebido" fill="hsl(var(--success))" radius={[3, 3, 0, 0]} /><Bar dataKey="Pago" fill="hsl(var(--destructive))" radius={[3, 3, 0, 0]} />
            <Line type="monotone" dataKey="Saldo do mês" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart></ResponsiveContainer></div>
      )}
      {cash.data && cash.data.length > 0 && <Table head={["Mês", "Recebido", "Pago", "Saldo do mês", "A receber (contratado)", "A pagar"]} right={[1, 2, 3, 4, 5]}>
        {cash.data.map((r) => <tr key={r.month}><Td>{fmtDate(r.month + "T12:00:00Z").slice(3)}</Td><Td num>{brl(r.realized_in_cents)}</Td><Td num>{brl(r.realized_out_cents)}</Td>
          <Td num className={r.realized_in_cents - r.realized_out_cents < 0 ? "text-destructive" : ""}>{brl(r.realized_in_cents - r.realized_out_cents)}</Td>
          <Td num>{brl(r.forecast_in_cents)}</Td><Td num>{brl(r.forecast_out_cents)}</Td></tr>)}</Table>}
    </div>
  );
};

export default FinanceCashFlow;
