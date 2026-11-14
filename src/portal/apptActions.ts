import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { fmtDateTime } from "@/lib/format";
import { confirmDialog, errText } from "@/lib/ui";

/** O que a regra de confirmação/cancelamento precisa saber de um atendimento (o mesmo formato de my_appointments). */
export interface ApptRule { id: string; service_name: string; professional_name: string; starts_at: string; timezone: string; uses_package: boolean; cancel_consumes: boolean; late_cancel_hours: number | null }
interface Msg { ok: (s: string) => void; err: (s: string) => void }

/** Confirmar presença e cancelar com as MESMAS regras de sempre (consequência avisada ANTES de cancelar). Usado na Agenda e no Início do paciente. */
export const useApptActions = (m: Msg) => {
  const qc = useQueryClient();
  const refresh = () => { for (const k of ["my-appts", "my-pkgs", "my-pkg-breakdown", "my-home"]) void qc.invalidateQueries({ queryKey: [k] }); };
  const confirm = async (a: { id: string }) => {
    const { error } = await supabase.rpc("my_appointment_confirm", { p_id: a.id });
    if (error) m.err(errText(error)); else { m.ok("Presença confirmada. Obrigado!"); refresh(); }
  };
  // A regra de consumo é a do produto do pacote: cancelar com menos de `late_cancel_hours` de antecedência desconta 1 sessão. O paciente é avisado ANTES.
  const cancel = async (a: ApptRule) => {
    const h = a.late_cancel_hours;
    const consequence = !a.uses_package ? "Este atendimento não usa pacote, então nenhuma sessão é descontada."
      : a.cancel_consumes ? `Faltam menos de ${h} h para o atendimento: pela regra do seu pacote, esta sessão SERÁ DESCONTADA.`
      : `Você está cancelando com mais de ${h} h de antecedência: nenhuma sessão será descontada.`;
    if (!(await confirmDialog("Cancelar atendimento?", `${a.service_name} com ${a.professional_name}, ${fmtDateTime(a.starts_at, a.timezone)}. ${consequence}`, "Cancelar atendimento", true))) return;
    const { data, error } = await supabase.rpc("my_appointment_cancel", { p_id: a.id, p_reason: null });
    if (error) return m.err(errText(error));
    m.ok((data as { session_consumed?: boolean } | null)?.session_consumed ? "Atendimento cancelado. A sessão foi descontada do seu pacote, conforme a regra de cancelamento tardio." : "Atendimento cancelado. Nenhuma sessão foi descontada.");
    refresh();
  };
  return { confirm, cancel };
};
