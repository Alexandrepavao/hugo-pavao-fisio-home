import { useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { errText } from "@/lib/ui";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { refreshConversations, useStaff } from "./api";

const pad = (n: number) => String(n).padStart(2, "0");
const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Agendar mensagem: grava a mensagem e cria um LEMBRETE para o responsável pelo envio. O HP não envia sozinho — no horário a mensagem fica "pronta para enviar". */
const ScheduleDialog = ({ open, onOpenChange, conversationId, personName, initialBody, myId, onDone }: {
  open: boolean; onOpenChange: (o: boolean) => void; conversationId: string; personName: string; initialBody: string; myId: string | null; onDone: (text: string) => void;
}) => {
  const qc = useQueryClient(); const staff = useStaff();
  const [body, setBody] = useState(initialBody); const [when, setWhen] = useState(""); const [who, setWho] = useState(myId ?? ""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setBody(initialBody); setErr(""); setWho(myId ?? ""); const t = new Date(Date.now() + 36e5); t.setMinutes(0, 0, 0); setWhen(local(t)); } }, [open, initialBody, myId]);

  const preset = (h: number, dayOffset = 0) => { const d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(h, 0, 0, 0); setWhen(local(d)); };
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(""); setBusy(true);
    const { error } = await supabase.rpc("crm_schedule_message", { p_conversation: conversationId, p_body: body, p_when: new Date(when).toISOString(), p_assignee: who || null });
    setBusy(false);
    if (error) return setErr(errText(error));
    refreshConversations(qc, conversationId); onOpenChange(false); onDone("Mensagem agendada. No horário ela fica pronta para enviar e o responsável recebe um lembrete.");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Agendar mensagem para {personName.split(" ")[0]}</DialogTitle>
          <DialogDescription>O HP não envia sozinho: no horário marcado a mensagem aparece como <strong>pronta para enviar</strong> e vira uma tarefa para o responsável abrir o WhatsApp.</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <div><label htmlFor="sc-body" className="block mb-1">Mensagem</label><textarea id="sc-body" rows={4} required maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} /></div>
          <div><label htmlFor="sc-when" className="block mb-1">Quando</label><input id="sc-when" type="datetime-local" required value={when} onChange={(e) => setWhen(e.target.value)} />
            <div className="flex flex-wrap gap-1.5 pt-2">
              <button type="button" className="hp-pill" onClick={() => { const d = new Date(Date.now() + 36e5); setWhen(local(d)); }}>Em 1 hora</button>
              <button type="button" className="hp-pill" onClick={() => preset(9, 1)}>Amanhã 9h</button>
              <button type="button" className="hp-pill" onClick={() => preset(14, 1)}>Amanhã 14h</button>
              <button type="button" className="hp-pill" onClick={() => preset(9, 7)}>Em 1 semana</button>
            </div></div>
          <div><label htmlFor="sc-who" className="block mb-1">Quem vai enviar</label>
            <select id="sc-who" value={who} onChange={(e) => setWho(e.target.value)}>{myId && <option value={myId}>Eu</option>}{(staff.data ?? []).filter((u) => u.user_id !== myId).map((u) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}</select></div>
          {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
          <div className="flex justify-end gap-2"><button type="button" className="hp-btn hp-btn-outline" onClick={() => onOpenChange(false)}>Cancelar</button><button className="hp-btn hp-btn-primary" disabled={busy}>{busy ? "Agendando…" : "Agendar"}</button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
export default ScheduleDialog;
