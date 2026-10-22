import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { fmtDateTime } from "@/lib/format";
import { Badge, type Tone } from "@/lib/ui";
import { JOURNEY_QUESTIONS, type Journey } from "@/lib/quiz";

interface QuizEntry {
  id: string; journey: Journey; status: "started" | "partial" | "completed"; city: string | null; state_uf: string | null;
  answers: Record<string, { value: unknown; label: string; detalhe?: string }>; health_answers_restricted: boolean;
  started_at: string; completed_at: string | null; last_activity_at: string; origin_path: string | null; page_slug: string | null; marketing_consent: boolean;
}
interface FormEntry { id: string; form_name: string; page_slug: string | null; created_at: string; fields: { label: string; value: string | null }[] }

const STATUS: Record<string, [string, Tone]> = { started: ["Iniciado", "neutral"], partial: ["Parou no meio", "warning"], completed: ["Concluído", "success"] };
const TITLE: Record<Journey, string> = { atendimento: "Quiz de avaliação (paciente)", parceria: "Quiz de parceria (fisioterapeuta)" };

/** Tudo o que a pessoa preencheu nos formulários (quizzes e formulários de página), com a cidade e o estado em destaque. Mesmas regras de acesso da Captação de leads:
 *  gestão e comercial leem; respostas sobre saúde só para gestão (o servidor já as remove para o comercial). `empty` = o que mostrar quando não há formulário (nada, por padrão). */
const PersonFormAnswers = ({ personId, empty }: { personId: string; empty?: string }) => {
  const q = useQuery({
    queryKey: ["person-form-answers", personId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("person_form_answers", { p_person: personId });
      if (error) throw error;
      return data as { quiz: QuizEntry[]; forms: FormEntry[] };
    },
  });
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Carregando formulários…</p>;
  if (q.error) return <p className="text-sm text-destructive" role="alert">Não foi possível carregar os formulários preenchidos.</p>;
  const quiz = q.data?.quiz ?? []; const forms = q.data?.forms ?? [];
  if (quiz.length === 0 && forms.length === 0) return empty ? <p className="text-sm text-muted-foreground" data-testid="form-answers-empty">{empty}</p> : null;

  return (
    <div className="grid gap-3" data-testid="form-answers">
      {quiz.map((z) => {
        const known = JOURNEY_QUESTIONS[z.journey]; const keys = Object.keys(z.answers);
        const ordered = [...known.map((k) => k.key).filter((k) => keys.includes(k)), ...keys.filter((k) => !known.some((x) => x.key === k))];
        const [stLabel, stTone] = STATUS[z.status] ?? [z.status, "neutral" as Tone];
        return (
          <article key={z.id} className="rounded-md border border-border p-3" data-testid="form-answers-quiz" data-journey={z.journey}>
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-semibold">{TITLE[z.journey] ?? z.journey}</h4><Badge tone={stTone}>{stLabel}</Badge>
              <span className="text-xs text-muted-foreground ml-auto">{fmtDateTime(z.completed_at ?? z.last_activity_at)}</span>
            </div>
            <dl className="grid grid-cols-2 gap-3 mt-2 rounded-md bg-muted/50 px-3 py-2" data-testid="form-answers-local">
              <div><dt className="text-xs text-muted-foreground">Cidade informada</dt><dd className="font-semibold" data-testid="form-answers-city">{z.city ?? <span className="font-normal text-muted-foreground">não informada</span>}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Estado (UF)</dt><dd className="font-semibold" data-testid="form-answers-uf">{z.state_uf ?? <span className="font-normal text-muted-foreground">não informado</span>}</dd></div>
            </dl>
            {ordered.length === 0
              ? <p className="text-sm text-muted-foreground mt-2">Ainda não respondeu às perguntas.</p>
              : (
                <dl className="grid gap-2 mt-3">
                  {ordered.map((k) => {
                    const a = z.answers[k]; const text = known.find((x) => x.key === k)?.question ?? k;
                    return <div key={k} data-testid="form-answers-item"><dt className="text-xs text-muted-foreground">{text}</dt><dd className="text-sm font-medium break-words">{a.label}{a.detalhe ? ` — ${a.detalhe}` : ""}</dd></div>;
                  })}
                </dl>
              )}
            {z.health_answers_restricted && <p className="text-xs text-warning mt-2">Respostas sobre saúde ocultas: permissão de gestão necessária.</p>}
            <p className="text-[11px] text-muted-foreground mt-2">Origem: {z.origin_path ?? "—"}{z.page_slug ? ` (página ${z.page_slug})` : ""} · {z.marketing_consent ? "aceitou comunicações de marketing" : "sem autorização de marketing"}</p>
          </article>
        );
      })}
      {forms.map((f) => (
        <article key={f.id} className="rounded-md border border-border p-3" data-testid="form-answers-page">
          <div className="flex flex-wrap items-center gap-2"><h4 className="text-sm font-semibold">Formulário: {f.form_name}</h4><span className="text-xs text-muted-foreground ml-auto">{fmtDateTime(f.created_at)}</span></div>
          <dl className="grid gap-2 mt-3">{f.fields.map((x, i) => <div key={i}><dt className="text-xs text-muted-foreground">{x.label}</dt><dd className="text-sm font-medium break-words">{x.value ?? "—"}</dd></div>)}</dl>
          {f.page_slug && <p className="text-[11px] text-muted-foreground mt-2">Página: /{f.page_slug}</p>}
        </article>
      ))}
    </div>
  );
};

export default PersonFormAnswers;
