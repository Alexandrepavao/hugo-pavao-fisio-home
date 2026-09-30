import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, EyeOff, Plus } from "lucide-react";
import { Badge } from "@/lib/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export interface CatalogColumn { key: string; label: string; sensitive: boolean; allowed: boolean; default_visible: boolean }

/** Personalização da planilha: mostrar/ocultar e reordenar colunas. "Nome" é fixa. Colunas sensíveis ficam
 *  visíveis na lista mas bloqueadas para quem não tem permissão — e o servidor as descarta mesmo assim. */
const ColumnsDialog = ({ open, onOpenChange, catalog, columns, isDefault, busy, onSave, onReset }: {
  open: boolean; onOpenChange: (v: boolean) => void; catalog: CatalogColumn[]; columns: string[]; isDefault: boolean; busy: boolean;
  onSave: (cols: string[]) => void; onReset: () => void;
}) => {
  const [sel, setSel] = useState<string[]>(columns);
  useEffect(() => { if (open) setSel(columns); }, [open, columns]);
  const byKey = new Map(catalog.map((c) => [c.key, c]));
  const move = (i: number, d: -1 | 1) => setSel((s) => { const j = i + d; if (j < 1 || j >= s.length) return s; const n = [...s]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const hidden = catalog.filter((c) => !sel.includes(c.key));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Colunas da planilha</DialogTitle>
          <DialogDescription>Escolha o que aparece e a ordem. A preferência é sua (por usuário) e vale também na exportação.{isDefault ? " Hoje você usa o padrão." : ""}</DialogDescription>
        </DialogHeader>
        <section aria-label="Colunas visíveis">
          <h3 className="text-sm font-semibold mb-2">Visíveis (na ordem em que aparecem)</h3>
          <ol className="grid gap-1">
            {sel.map((k, i) => {
              const c = byKey.get(k); if (!c) return null;
              return (
                <li key={k} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm" data-col={k}>
                  <span className="flex-1">{c.label}{k === "name" && <span className="text-xs text-muted-foreground"> (fixa)</span>}</span>
                  {c.sensitive && <Badge tone="gold">restrita</Badge>}
                  <button type="button" className="hp-btn hp-btn-ghost hp-btn-sm" style={{ width: "2rem", padding: 0 }} disabled={i <= 1} onClick={() => move(i, -1)} aria-label={`Mover ${c.label} para cima`}><ArrowUp size={14} /></button>
                  <button type="button" className="hp-btn hp-btn-ghost hp-btn-sm" style={{ width: "2rem", padding: 0 }} disabled={k === "name" || i >= sel.length - 1} onClick={() => move(i, 1)} aria-label={`Mover ${c.label} para baixo`}><ArrowDown size={14} /></button>
                  <button type="button" className="hp-btn hp-btn-ghost hp-btn-sm" style={{ width: "2rem", padding: 0 }} disabled={k === "name"} onClick={() => setSel((s) => s.filter((x) => x !== k))} aria-label={`Ocultar ${c.label}`}><EyeOff size={14} /></button>
                </li>);
            })}
          </ol>
        </section>
        <section aria-label="Colunas ocultas">
          <h3 className="text-sm font-semibold mb-2">Ocultas</h3>
          {hidden.length === 0 ? <p className="text-sm text-muted-foreground">Todas as colunas estão visíveis.</p> : (
            <ul className="grid gap-1">
              {hidden.map((c) => (
                <li key={c.key} className="flex items-center gap-2 rounded-md border border-dashed border-border px-2 py-1.5 text-sm" data-col-hidden={c.key}>
                  <span className={`flex-1 ${c.allowed ? "" : "text-muted-foreground"}`}>{c.label}</span>
                  {c.sensitive && <Badge tone="gold">restrita</Badge>}
                  {c.allowed
                    ? <button type="button" className="hp-btn hp-btn-outline hp-btn-sm" onClick={() => setSel((s) => [...s, c.key])} aria-label={`Mostrar ${c.label}`}><Plus size={14} />Mostrar</button>
                    : <span className="text-xs text-muted-foreground">Somente gestor / administrador operacional</span>}
                </li>))}
            </ul>)}
        </section>
        <DialogFooter>
          <button className="hp-btn hp-btn-outline" onClick={onReset} disabled={busy}>Restaurar padrão</button>
          <button className="hp-btn hp-btn-outline" onClick={() => onOpenChange(false)}>Cancelar</button>
          <button className="hp-btn hp-btn-primary" onClick={() => onSave(sel)} disabled={busy}>{busy ? "Salvando…" : "Salvar preferência"}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
export default ColumnsDialog;
