import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { errText } from "@/lib/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DOC_KINDS, useAccInvalidate, useAccScope } from "./accLib";

export interface AttachTarget { type: "receivable" | "payable" | "payment" | "period"; id: string | null; label: string }
const MAX = 10 * 1024 * 1024;
const OK_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp", "text/xml", "application/xml"];

/** Anexa um arquivo ao bucket privado `accounting-private` (pasta da organização/unidade/mês) e o registra na competência.
 *  O envio só passa se a política de Storage autorizar a unidade; o registro é revalidado no servidor. */
const AttachDialog = ({ target, onClose }: { target: AttachTarget | null; onClose: () => void }) => {
  const { ctx, unit, month } = useAccScope(); const invalidate = useAccInvalidate();
  const [file, setFile] = useState<File | null>(null); const [kind, setKind] = useState("comprovante"); const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const reset = () => { setFile(null); setTitle(""); setKind("comprovante"); setErr(null); setBusy(false); };

  const submit = async () => {
    if (!target || !file) return setErr("Escolha o arquivo.");
    if (file.size > MAX) return setErr("Arquivo acima de 10 MB.");
    if (!OK_TYPES.includes(file.type)) return setErr("Formato não aceito. Use PDF, imagem (PNG, JPG, WEBP) ou XML.");
    setBusy(true); setErr(null);
    const safe = file.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80);
    const path = `${ctx.org.id}/${unit.id}/${month.slice(0, 7)}/${crypto.randomUUID()}-${safe}`;
    const up = await supabase.storage.from("accounting-private").upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) { setBusy(false); return setErr("Não foi possível enviar o arquivo (verifique sua permissão nesta unidade)."); }
    const { error } = await supabase.rpc("acc_document_register", {
      p_unit: unit.id, p_month: month, p_source_type: target.type, p_source_id: target.id, p_kind: kind,
      p_title: title.trim() || file.name, p_path: path, p_mime: file.type, p_size: file.size,
    });
    setBusy(false);
    if (error) return setErr(errText(error, "O arquivo foi enviado, mas não pôde ser registrado."));
    await invalidate(); reset(); onClose();
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Anexar documento</DialogTitle>
          <DialogDescription>{target?.type === "period" ? "Documento da competência (extrato, contrato, relatório)." : `Vinculado a: ${target?.label ?? ""}`} O arquivo fica em armazenamento privado, só acessível por quem tem permissão contábil nesta unidade.</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div><label htmlFor="att-file" className="block text-xs mb-1">Arquivo (PDF, imagem ou XML — até 10 MB) *</label><input id="att-file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.xml" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label htmlFor="att-kind" className="block text-xs mb-1">Tipo</label><select id="att-kind" value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(DOC_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div><label htmlFor="att-title" className="block text-xs mb-1">Título</label><input id="att-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={file?.name ?? "Ex.: Recibo do aluguel"} /></div>
          </div>
          {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
        </div>
        <DialogFooter>
          <button className="hp-btn hp-btn-outline" onClick={() => { reset(); onClose(); }} disabled={busy}>Cancelar</button>
          <button className="hp-btn hp-btn-primary" onClick={submit} disabled={busy || !file}>{busy ? "Enviando…" : "Anexar"}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
export default AttachDialog;
