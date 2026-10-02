import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { btnGhost, errText } from "@/lib/ui";
import type { BankShare } from "./lineReports";

const MODES: [string, string][] = [["none", "Sem alocação (Não classificado)"], ["physio", "100% HP Fisioterapia"], ["academy", "100% HP Academy"], ["shared", "100% Compartilhado / não alocado"], ["split", "Dividir entre HP Fisioterapia e HP Academy"]];

/** Aloca um movimento PENDENTE/IGNORADO a uma linha de negócio. O extrato original não muda: a alocação é uma camada à parte, auditada no servidor.
 *  Movimento conciliado não passa por aqui — a linha dele vem do recebimento/conta conciliada. */
const BankLineAllocator = ({ lineId, current, onDone }: { lineId: string; current?: BankShare[]; onDone: () => void }) => {
  const qc = useQueryClient();
  const manual = current?.filter((s) => s.origin === "alocacao_manual") ?? [];
  const initial = manual.length === 0 ? "none" : manual.length === 1 ? manual[0].bucket : "split";
  const [mode, setMode] = useState(initial);
  const total = manual.reduce((a, s) => a + Math.abs(s.cents), 0);
  const [physioPct, setPhysioPct] = useState(() => { const p = manual.find((s) => s.bucket === "physio"); return p && total > 0 && manual.length > 1 ? String(Math.round((100 * Math.abs(p.cents)) / total)) : "50"; });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");

  const save = async () => {
    setErr("");
    let alloc: { line: string; basis_points: number }[] | null = null;
    if (mode === "split") {
      const pct = Number(physioPct.replace(",", "."));
      if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) return setErr("Informe o percentual da HP Fisioterapia entre 1 e 99; o restante vai para a HP Academy.");
      const bp = Math.round(pct * 100); alloc = [{ line: "physio", basis_points: bp }, { line: "academy", basis_points: 10000 - bp }];
    } else if (mode !== "none") alloc = [{ line: mode, basis_points: 10000 }];
    setBusy(true);
    const { error } = await supabase.rpc("bank_line_set_allocation", { p_line: lineId, p_allocations: alloc });
    setBusy(false);
    if (error) return setErr(errText(error));
    void qc.invalidateQueries({ queryKey: ["bank-shares"] }); void qc.invalidateQueries({ queryKey: ["bank-by-line"] });
    onDone();
  };

  return (
    <div className="mt-3 border-t border-border pt-3 grid gap-2 sm:grid-cols-[1fr_auto] items-end" aria-label="Linha de negócio do movimento">
      <div className="grid gap-2 sm:grid-cols-2">
        <div><label htmlFor={`alloc-${lineId}`} className="block text-xs mb-1">Linha de negócio deste movimento</label>
          <select id={`alloc-${lineId}`} value={mode} onChange={(e) => setMode(e.target.value)}>{MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        {mode === "split" && <div><label htmlFor={`alloc-pct-${lineId}`} className="block text-xs mb-1">% HP Fisioterapia (o restante vai para a HP Academy)</label>
          <input id={`alloc-pct-${lineId}`} inputMode="decimal" value={physioPct} onChange={(e) => setPhysioPct(e.target.value)} /></div>}
      </div>
      <div className="flex gap-2"><button className={btnGhost + " hp-btn-sm"} disabled={busy} onClick={() => void save()}>{busy ? "Salvando…" : "Salvar alocação"}</button>
        <button className={btnGhost + " hp-btn-sm"} onClick={onDone}>Fechar</button></div>
      {err && <p role="alert" className="text-xs text-destructive sm:col-span-2">{err}</p>}
      <p className="text-[11px] text-muted-foreground sm:col-span-2">A alocação não altera o extrato importado (data, descrição e valor continuam os originais). Ao conciliar este movimento com um recebimento ou conta paga, a linha passa a vir do lançamento e a alocação manual deixa de valer.</p>
    </div>
  );
};

export default BankLineAllocator;
