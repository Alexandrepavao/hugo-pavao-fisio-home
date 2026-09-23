import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { EmptyState, errText, Msg, State, useMsg } from "@/lib/ui";
import PortalShell from "./PortalShell";

interface Available { id: string; title: string; description: string | null }
interface FormQuestion { id: string; prompt: string; kind: "single_choice" | "multi_choice" | "text"; options: string[] | null; required: boolean }
interface SurveyForm { id: string; title: string; description: string | null; is_anonymous: boolean; questions: FormQuestion[] }

/** Pesquisas disponíveis pro perfil da pessoa (pacientes/parceiros/alunos) — pública dentro da plataforma,
 * nunca por e-mail (isso depende de integração real, ainda não configurada). */
const Research = () => {
  const qc = useQueryClient(); const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["research-available"], queryFn: async () => { const { data, error } = await supabase.rpc("research_available_surveys"); if (error) throw error; return data as Available[]; } });
  return (
    <PortalShell title="Pesquisas" subtitle="Sua opinião ajuda a equipe a melhorar o atendimento.">
      <State loading={list.isLoading} error={list.error} />
      {list.data?.length === 0 && <EmptyState icon={ClipboardList} title="Nenhuma pesquisa disponível no momento" />}
      {list.data && list.data.length > 0 && <ul className="grid gap-3 max-w-2xl">
        {list.data.map((s) => (
          <li key={s.id} className="hp-card p-4">
            <p className="font-medium">{s.title}</p>
            {s.description && <p className="text-sm text-muted-foreground mt-1">{s.description}</p>}
            {open === s.id ? <SurveyForm id={s.id} onDone={() => { setOpen(null); void qc.invalidateQueries({ queryKey: ["research-available"] }); }} />
              : <button className="hp-btn hp-btn-primary mt-3" onClick={() => setOpen(s.id)}>Responder</button>}
          </li>
        ))}
      </ul>}
    </PortalShell>
  );
};

const SurveyForm = ({ id, onDone }: { id: string; onDone: () => void }) => {
  const [msg, m] = useMsg(); const [answers, setAnswers] = useState<Record<string, string[] | string>>({}); const [busy, setBusy] = useState(false);
  const form = useQuery({ queryKey: ["research-form", id], queryFn: async () => { const { data, error } = await supabase.rpc("research_survey_for_response", { p_survey: id }); if (error) throw error; return data as SurveyForm; } });
  const setChoice = (q: FormQuestion, opt: string) => setAnswers((a) => {
    if (q.kind === "single_choice") return { ...a, [q.id]: [opt] };
    const cur = (a[q.id] as string[] | undefined) ?? [];
    return { ...a, [q.id]: cur.includes(opt) ? cur.filter((o) => o !== opt) : [...cur, opt] };
  });
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (!form.data) return; setBusy(true);
    const payload = form.data.questions.map((q) => {
      const v = answers[q.id];
      return q.kind === "text" ? { question_id: q.id, text: (v as string) ?? "" } : { question_id: q.id, options: (v as string[]) ?? [] };
    });
    const { error } = await supabase.rpc("research_response_submit", { p_survey: id, p_answers: payload });
    setBusy(false);
    if (error) return m.err(errText(error));
    onDone();
  };
  if (form.isLoading) return <State loading />;
  if (form.error) return <State error={form.error} />;
  if (!form.data) return null;
  return (
    <form onSubmit={submit} className="mt-4 grid gap-4 border-t border-border pt-4">
      <Msg m={msg} />
      {form.data.is_anonymous && <p className="text-xs text-muted-foreground">Esta pesquisa é anônima: sua identidade não é registrada com a resposta.</p>}
      {form.data.questions.map((q) => (
        <fieldset key={q.id}>
          <legend className="text-sm font-medium mb-1.5">{q.prompt} {!q.required && <span className="text-xs text-muted-foreground font-normal">(opcional)</span>}</legend>
          {q.kind === "text" ? (
            <textarea rows={3}   value={(answers[q.id] as string) ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} />
          ) : (
            <div className="grid gap-1.5">{q.options?.map((o) => (
              <label key={o} className="flex items-center gap-2 text-sm !font-normal">
                <input type={q.kind === "single_choice" ? "radio" : "checkbox"} name={q.id} checked={((answers[q.id] as string[]) ?? []).includes(o)} onChange={() => setChoice(q, o)} />{o}
              </label>
            ))}</div>
          )}
        </fieldset>
      ))}
      <button className="hp-btn hp-btn-primary w-fit" disabled={busy}>{busy ? "Enviando…" : "Enviar respostas"}</button>
    </form>
  );
};

export default Research;
