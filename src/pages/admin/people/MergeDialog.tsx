import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Badge, errText } from "@/lib/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface P { id: string; full_name: string }
interface Preview { keep: P; merge: P & { name?: string }; moves: Record<string, number>; conflicts: { level: "block" | "warn"; message: string }[]; can_merge: boolean }

/** Mesclagem com decisão explícita: escolha o cadastro a manter, veja a prévia de conflitos e o que será movido. */
const MergeDialog = ({ from, onClose, onDone }: { from: P | null; onClose: () => void; onDone: () => void }) => {
  const [search, setSearch] = useState(""); const [other, setOther] = useState<P | null>(null); const [keepFrom, setKeepFrom] = useState(true);
  const [accept, setAccept] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [pv, setPv] = useState<Preview | null>(null);
  useEffect(() => { setSearch(""); setOther(null); setPv(null); setAccept(false); setErr(null); setKeepFrom(true); }, [from?.id]);
  const found = useQuery({ queryKey: ["merge-search", search], enabled: !!from && search.length >= 2 && !other, queryFn: async () => (await supabase.from("people").select("id, full_name").ilike("full_name", `%${search.replace(/[%_]/g, "")}%`).is("merged_into_id", null).neq("id", from!.id).limit(6)).data ?? [] });

  const keepId = from && other ? (keepFrom ? from.id : other.id) : null; const mergeId = from && other ? (keepFrom ? other.id : from.id) : null;
  useEffect(() => {
    setPv(null); setAccept(false); setErr(null); if (!keepId || !mergeId) return; let alive = true;
    supabase.rpc("merge_preview", { p_keep: keepId, p_merge: mergeId }).then(({ data, error }) => { if (!alive) return; error ? setErr(errText(error, "Não foi possível gerar a prévia.")) : setPv(data as Preview); });
    return () => { alive = false; };
  }, [keepId, mergeId]);

  const warns = pv?.conflicts.filter((c) => c.level === "warn") ?? []; const blocks = pv?.conflicts.filter((c) => c.level === "block") ?? [];
  const confirm = async () => {
    if (!keepId || !mergeId) return; setBusy(true); setErr(null);
    const { error } = await supabase.rpc("merge_people", { p_keep: keepId, p_merge: mergeId, p_accept_warnings: accept });
    setBusy(false); error ? setErr(errText(error)) : onDone();
  };
  const total = Object.values(pv?.moves ?? {}).reduce((a, b) => a + b, 0);

  return (
    <Dialog open={!!from} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Mesclar cadastros</DialogTitle><DialogDescription>O cadastro mesclado é arquivado (não é apagado) e todo o histórico passa para o cadastro mantido. Esta ação exige sua decisão explícita.</DialogDescription></DialogHeader>
        {from && (<div className="grid gap-3">
          <div><label htmlFor="mg-s" className="block mb-1">Mesclar “{from.full_name}” com…</label>
            <input id="mg-s" autoComplete="off" placeholder="Busque o outro cadastro pelo nome" value={other ? other.full_name : search} onChange={(e) => { setOther(null); setSearch(e.target.value); }} />
            {!other && found.data && found.data.length > 0 && <ul className="hp-card mt-1 overflow-hidden">{found.data.map((p) => <li key={p.id}><button type="button" className="w-full text-left px-3 py-2 hover:bg-muted" onClick={() => setOther(p)}>{p.full_name}</button></li>)}</ul>}</div>
          {other && (
            <fieldset className="grid gap-1"><legend className="text-[0.8125rem] font-medium mb-1">Qual cadastro deve ser mantido?</legend>
              <label className="flex items-center gap-2 !font-normal"><input type="radio" name="keep" checked={keepFrom} onChange={() => setKeepFrom(true)} />Manter “{from.full_name}” e mesclar “{other.full_name}” nele</label>
              <label className="flex items-center gap-2 !font-normal"><input type="radio" name="keep" checked={!keepFrom} onChange={() => setKeepFrom(false)} />Manter “{other.full_name}” e mesclar “{from.full_name}” nele</label></fieldset>)}
          {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
          {pv && (<div className="grid gap-2" aria-live="polite">
            {blocks.map((c, i) => <p key={i} role="alert" className="rounded-md border p-2 text-sm" style={{ borderColor: "hsl(var(--destructive) / .4)", background: "hsl(var(--destructive-soft))", color: "hsl(var(--destructive))" }}><b>Bloqueado:</b> {c.message}</p>)}
            {warns.map((c, i) => <p key={i} className="rounded-md border p-2 text-sm" style={{ borderColor: "hsl(var(--warning) / .5)", background: "hsl(var(--warning-soft))" }}><b>Atenção:</b> {c.message}</p>)}
            <div className="hp-card p-3 text-sm"><p className="font-medium mb-1">O que será movido ({total} registros)</p>
              {Object.keys(pv.moves).length === 0 ? <p className="text-muted-foreground">Nenhum registro vinculado ao cadastro mesclado.</p> : <ul className="flex flex-wrap gap-1.5">{Object.entries(pv.moves).map(([k, n]) => <li key={k}><Badge>{k.split(".")[0].replace(/_/g, " ")}: {n}</Badge></li>)}</ul>}</div>
            {warns.length > 0 && blocks.length === 0 && <label className="flex items-start gap-2 text-sm !font-normal"><input type="checkbox" className="mt-1" checked={accept} onChange={(e) => setAccept(e.target.checked)} />Li os avisos acima e confirmo que se trata da mesma pessoa.</label>}
          </div>)}
        </div>)}
        <DialogFooter><button className="hp-btn hp-btn-outline" onClick={onClose}>Cancelar</button>
          <button className="hp-btn hp-btn-primary" disabled={busy || !pv || !pv.can_merge || (warns.length > 0 && !accept)} onClick={confirm}>{busy ? "Mesclando…" : "Mesclar cadastros"}</button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
export default MergeDialog;
