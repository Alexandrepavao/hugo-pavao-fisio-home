import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { btnGhost, btnPrimary, errText, Msg, useMsg } from "@/lib/ui";

/** Configurações › Operação › Jornada do paciente: modelo de sessões (padrão inicial, não obrigação clínica) e biblioteca Bunny dos vídeos privados.
 *  Os SEGREDOS do Bunny nunca são digitados aqui: ficam nos Secrets do Supabase (ver docs/jornada-do-paciente.md). O botão só verifica se a proteção está ativa no servidor. */
const JourneySettings = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg();
  const s = useQuery({ queryKey: ["journey-settings"], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("journey_settings_get"); if (error) throw error; return (data as { default_sessions: number; bunny_library_id: string | null }[])[0]; } });
  const [sessions, setSessions] = useState<string | null>(null); const [lib, setLib] = useState<string | null>(null);
  const [probe, setProbe] = useState<string | null>(null);
  if (s.error || !s.data) return null;     // migration ainda não aplicada (ou sem permissão): a seção simplesmente não aparece
  const save = async (e: FormEvent) => {
    e.preventDefault(); const n = Number(sessions ?? s.data!.default_sessions);
    if (!Number.isInteger(n) || n < 1 || n > 200) return m.err("Informe de 1 a 200 sessões.");
    const { error } = await supabase.rpc("journey_settings_set", { p_default_sessions: n, p_bunny_library_id: (lib ?? s.data!.bunny_library_id ?? "") || null });
    if (error) return m.err(errText(error)); m.ok("Configuração da jornada salva."); setSessions(null); setLib(null); void qc.invalidateQueries({ queryKey: ["journey-settings"] });
  };
  const check = async () => {
    setProbe("Verificando…");
    const { error } = await supabase.functions.invoke("bunny-playback", { body: { video_id: "00000000-0000-0000-0000-000000000000" } });
    const status = (error as { context?: { status?: number } } | null)?.context?.status;
    setProbe(status === 503 ? "Proteção NÃO configurada: falta o segredo BUNNY_EMBED_TOKEN_KEY no Supabase. Enquanto isso, a reprodução fica indisponível para os pacientes."
      : status === 403 ? "Função publicada e chave de token configurada (o vídeo de teste foi corretamente negado)."
      : status === 404 || status === undefined ? "A função bunny-playback não está publicada neste projeto." : `Resposta inesperada (HTTP ${status}).`);
  };
  return (
    <div className="mt-8">
      <h3 className="text-sm font-medium mb-2">Jornada do paciente</h3>
      <Msg m={msg} />
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-4 items-end mb-3">
        <div><label htmlFor="js-n" className="block text-xs mb-1">Sessões do plano modelo</label><input id="js-n" type="number" min={1} max={200} value={sessions ?? s.data.default_sessions} onChange={(e) => setSessions(e.target.value)} /></div>
        <div><label htmlFor="js-l" className="block text-xs mb-1">ID da biblioteca Bunny (padrão)</label><input id="js-l" inputMode="numeric" value={lib ?? s.data.bunny_library_id ?? ""} onChange={(e) => setLib(e.target.value)} placeholder="ex.: 123456" /></div>
        <button className={btnPrimary}>Salvar</button><button type="button" className={btnGhost} onClick={check}>Verificar proteção de vídeo</button>
      </form>
      {probe && <p role="status" className="text-sm text-muted-foreground mb-2">{probe}</p>}
      <p className="text-xs text-muted-foreground">O número de sessões é só o <b>modelo inicial</b> dos planos novos; o fisioterapeuta ajusta a quantidade de cada paciente e decide continuidade, manutenção ou alta. A chave de token do Bunny <b>não</b> é cadastrada aqui — fica no Supabase (Secrets) e nunca chega ao navegador.</p>
    </div>
  );
};

export default JourneySettings;
