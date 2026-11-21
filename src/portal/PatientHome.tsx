import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { btnPrimary, errText, inputCls, Msg, State, useMsg } from "@/lib/ui";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PrivateVideo } from "@/pages/portal/Journey";
import { useActing } from "./acting";
import { useApptActions, type ApptRule } from "./apptActions";
import { PATIENT_HREF, useLiveJourney, type RawAppt } from "./journey/live";
import { JourneyProvider, PatientDashboard } from "./journey/ui";

export interface PatientHomeData {
  person: { id: string; name: string; birth_date: string | null; age?: number | null };
  acting?: { kind: string; representative: string } | null;
  needs_birth_date?: boolean;
  next_appointment: { id: string; starts_at: string; status: string; service: string; professional: string } | null;
  plan: { planned_sessions: number; attended: number; status: string; maintenance: boolean } | null;
  package_balance: number | null;
  pain: { first: number; last: number; count: number } | null;
  goal: { id: string; title: string; target_date: string | null } | null;
  last_decision: "continuidade" | "manutencao" | "alta" | null;
  renewal_open: boolean;
  videos_count: number;
  unread_msgs: number;
  training?: { today: { total: number; done: number } | null; streak: number; week_pct: number | null } | null;
  checkin_due?: boolean;
  offers?: { id: string; title: string; summary: string | null }[];
}

/** Passo de cadastro: a data de nascimento define as regras de idade/responsável/acesso — a regra continua no servidor (my_birth_date_set), a tela só a organiza. */
const BirthDate = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [v, setV] = useState("");
  const save = async (e: FormEvent) => { e.preventDefault(); const { error } = await supabase.rpc("my_birth_date_set", { p_date: v }); if (error) return m.err(errText(error)); void qc.invalidateQueries({ queryKey: ["my-home"] }); };
  return (
    <form onSubmit={save} className="jr-row" data-testid="birth-card" aria-label="Data de nascimento">
      <Msg m={msg} /><label htmlFor="bd" className="jr-small" style={{ fontWeight: 700 }}>Data de nascimento</label>
      <input id="bd" type="date" className={inputCls} value={v} onChange={(e) => setV(e.target.value)} required style={{ maxWidth: 220 }} />
      <button className={btnPrimary}>Salvar</button>
    </form>
  );
};

/** Início do paciente (portal real): a MESMA tela da demonstração, alimentada pelos registros reais. Sem dado, mostra o início do acompanhamento — nunca gráfico, meta ou número inventado. */
const PatientHome = () => {
  const { acting, switchTo } = useActing(); const [msg, m] = useMsg(); const [video, setVideo] = useState<{ id: string; title: string } | null>(null);
  const { model, loading, error } = useLiveJourney(); const act = useApptActions(m); const qc = useQueryClient();
  const raw = (id: string) => qc.getQueryData<RawAppt[]>(["my-appts"])?.find((a) => a.id === id) as (RawAppt & ApptRule) | undefined;
  return (
    <>
      <State loading={loading && !model} error={error} />
      {error && acting ? <p className="mt-3 text-sm" role="alert">Este vínculo não está mais ativo. <button className="text-accent underline" onClick={() => switchTo(null)}>Voltar para o meu perfil</button></p> : null}
      <Msg m={msg} />
      {model && (
        <JourneyProvider value={{
          hrefFor: (t) => PATIENT_HREF[t], presentationHref: "/paciente/apresentacao",
          confirmAppt: (a) => { const r = raw(a.id); if (r) void act.confirm(r); },
          cancelAppt: (a) => { const r = raw(a.id); if (r) void act.cancel(r); },
          watch: (v) => { if (v.kind === "video") setVideo({ id: v.id, title: v.title }); },
        }}>
          <PatientDashboard m={model} onboarding={model.needsBirthDate ? <BirthDate /> : undefined} />
          <Dialog open={!!video} onOpenChange={(o) => { if (!o) setVideo(null); }}>
            <DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>{video?.title}</DialogTitle><DialogDescription>Vídeo privado do seu fisioterapeuta. O link é temporário e só funciona para você.</DialogDescription></DialogHeader>
              {video && <PrivateVideo video={video} />}</DialogContent>
          </Dialog>
        </JourneyProvider>)}
    </>
  );
};
export default PatientHome;
