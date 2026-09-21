import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { safeUrl } from "@/features/pages/blocks";
import { fmtDate } from "@/lib/format";
import { btnGhost, errText, inputCls, Msg, State, useMsg } from "@/lib/ui";
import PortalShell from "./PortalShell";

interface Course { id: string; title: string; slug: string; description: string | null; kind: string }
interface Lesson { id: string; title: string; kind: string; body: string | null; external_url: string | null; storage_path: string | null; position: number; starts_at: string | null }

export const AcademyHome = () => {
  const courses = useQuery({ queryKey: ["my-courses"], queryFn: async () => (await supabase.from("courses").select("id, title, slug, description, kind").eq("status", "published").order("title")).data as Course[] });
  return (
    <PortalShell title="HP Academy">
      <State loading={courses.isLoading} error={courses.error} empty={courses.data?.length === 0} emptyText="Você ainda não tem cursos liberados. O acesso é liberado após a confirmação do pagamento, por turma ou pela equipe." />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {courses.data?.map((c) => <li key={c.id} className="card-hp"><p className="eyebrow mb-2">{c.kind === "mentoring" ? "Mentoria" : c.kind === "program" ? "Programa" : "Curso"}</p><h2 className="text-xl mb-2">{c.title}</h2><p className="text-navy-400 text-sm mb-4">{c.description}</p><Link className="btn-primary !py-2 !px-5" to={`/academy/${c.slug}`}>Acessar</Link></li>)}
      </ul>
    </PortalShell>
  );
};

export const CourseView = () => {
  const { slug = "" } = useParams(); const qc = useQueryClient(); const [msg, m] = useMsg(); const [cur, setCur] = useState<string | null>(null);
  const course = useQuery({ queryKey: ["course", slug], queryFn: async () => (await supabase.from("courses").select("id, title, slug, description, kind").eq("slug", slug).maybeSingle()).data as Course | null });
  const c = course.data;
  const lessons = useQuery({ queryKey: ["c-lessons", c?.id], enabled: !!c, queryFn: async () => (await supabase.from("lessons").select("id, title, kind, body, external_url, storage_path, position, starts_at").eq("course_id", c!.id).eq("published", true).order("position")).data as Lesson[] });
  const done = useQuery({ queryKey: ["c-done", c?.id], enabled: !!c, queryFn: async () => new Set(((await supabase.from("lesson_progress").select("lesson_id").eq("course_id", c!.id).not("completed_at", "is", null)).data ?? []).map((r) => r.lesson_id)) });
  const prog = useQuery({ queryKey: ["c-prog", c?.id], enabled: !!c, queryFn: async () => ((await supabase.rpc("course_progress", { p_course: c!.id })).data as { total: number; done: number; percent: number }[] | null)?.[0] });
  const quizzes = useQuery({ queryKey: ["c-quiz", c?.id], enabled: !!c, queryFn: async () => (await supabase.from("quizzes").select("id, title, pass_score").eq("course_id", c!.id)).data ?? [] });
  const cert = useQuery({ queryKey: ["c-cert", c?.id], enabled: !!c, queryFn: async () => (await supabase.from("certificates").select("code, issued_at").eq("course_id", c!.id).maybeSingle()).data });
  const lesson = lessons.data?.find((l) => l.id === (cur ?? lessons.data?.[0]?.id));
  const signed = useQuery({ queryKey: ["signed", lesson?.storage_path], enabled: !!lesson?.storage_path, staleTime: 50 * 60_000, queryFn: async () => (await supabase.storage.from("academy-private").createSignedUrl(lesson!.storage_path!, 3600)).data?.signedUrl ?? null });

  const complete = async () => { if (!lesson) return; const { error } = await supabase.rpc("lesson_complete", { p_lesson: lesson.id }); error ? m.err(errText(error)) : (m.ok("Aula concluída."), void qc.invalidateQueries({ queryKey: ["c-done", c?.id] }), void qc.invalidateQueries({ queryKey: ["c-prog", c?.id] })); };
  const issue = async () => { const { error } = await supabase.rpc("issue_certificate", { p_course: c!.id }); error ? m.err(errText(error)) : (m.ok("Certificado emitido."), void qc.invalidateQueries({ queryKey: ["c-cert", c?.id] })); };

  if (course.isLoading) return <PortalShell title="Carregando…"><State loading /></PortalShell>;
  if (!c) return <PortalShell title="Curso indisponível"><p className="text-navy-400">Você não tem acesso a este curso (ou ele foi encerrado). <Link className="underline" to="/academy">Voltar</Link></p></PortalShell>;
  return (
    <PortalShell title={c.title}>
      <Msg m={msg} />
      <div className="mb-6"><div className="flex justify-between text-sm mb-1"><span>Progresso</span><span className="tabular">{prog.data?.percent ?? 0}% ({prog.data?.done ?? 0}/{prog.data?.total ?? 0})</span></div>
        <div className="h-2 bg-muted" role="progressbar" aria-valuenow={prog.data?.percent ?? 0} aria-valuemin={0} aria-valuemax={100}><div className="h-2 bg-accent" style={{ width: `${prog.data?.percent ?? 0}%` }} /></div></div>
      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <nav aria-label="Aulas"><ul className="border border-border bg-card divide-y divide-border">{lessons.data?.map((l) => <li key={l.id}><button onClick={() => setCur(l.id)} className={`w-full text-left p-3 text-sm flex gap-2 ${l.id === lesson?.id ? "bg-muted" : ""}`}><span aria-hidden>{done.data?.has(l.id) ? "✓" : "○"}</span>{l.title}</button></li>)}</ul></nav>
        <article>
          {lesson ? (<>
            <h2 className="text-2xl mb-3">{lesson.title}</h2>
            {lesson.starts_at && <p className="text-sm text-navy-400 mb-3">Encontro em {new Date(lesson.starts_at).toLocaleString("pt-BR")}</p>}
            {lesson.storage_path && signed.data && (lesson.kind === "video" ? <video controls controlsList="nodownload" className="w-full mb-4 bg-black" src={signed.data} /> : <a className={btnGhost + " inline-block mb-4"} href={signed.data} target="_blank" rel="noopener noreferrer">Abrir arquivo</a>)}
            {lesson.external_url && safeUrl(lesson.external_url) && <p className="mb-4"><a className="underline text-accent" href={lesson.external_url} target="_blank" rel="noopener noreferrer">Abrir material externo</a></p>}
            {(lesson.body ?? "").split(/\n{2,}/).map((p, i) => <p key={i} className="mb-3 whitespace-pre-line">{p}</p>)}
            {lesson.kind !== "live" && <button className="btn-primary !py-2 mt-2" onClick={complete} disabled={done.data?.has(lesson.id)}>{done.data?.has(lesson.id) ? "Concluída" : "Marcar como concluída"}</button>}
          </>) : <p className="text-navy-400">Ainda não há aulas publicadas.</p>}
          {(quizzes.data?.length ?? 0) > 0 && <section className="mt-10"><h3 className="text-xl mb-2">Avaliações</h3><ul className="space-y-3">{quizzes.data!.map((q) => <Quiz key={q.id} id={q.id} title={q.title} pass={q.pass_score} />)}</ul></section>}
          <section className="mt-10"><h3 className="text-xl mb-2">Certificado</h3>
            {cert.data ? <p className="bg-card border border-accent p-4">Certificado <strong>{cert.data.code}</strong> emitido em {fmtDate(cert.data.issued_at)}.</p> : <><p className="text-sm text-navy-400 mb-2">Exige a conclusão das aulas e a aprovação nas avaliações.</p><button className={btnGhost} onClick={issue}>Emitir certificado</button></>}</section>
          <Community courseId={c.id} />
        </article>
      </div>
    </PortalShell>
  );
};

const Quiz = ({ id, title, pass }: { id: string; title: string; pass: number }) => {
  const [open, setOpen] = useState(false); const [answers, setAnswers] = useState<Record<string, number>>({}); const [res, setRes] = useState<{ score: number; passed: boolean } | null>(null); const [err, setErr] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["quiz", id], enabled: open, queryFn: async () => (await supabase.rpc("quiz_for_student", { p_quiz: id })).data as { questions: { id: string; prompt: string; options: string[] }[] } });
  const submit = async (e: FormEvent) => { e.preventDefault(); const { data, error } = await supabase.rpc("quiz_submit", { p_quiz: id, p_answers: answers }); error ? setErr(errText(error)) : setRes(data as { score: number; passed: boolean }); };
  return (<li className="bg-card border border-border p-4"><div className="flex justify-between"><span>{title} <span className="text-sm text-navy-400">(mínimo {pass}%)</span></span><button className="text-accent text-sm" onClick={() => setOpen(!open)}>{open ? "Fechar" : "Fazer avaliação"}</button></div>
    {open && q.data && <form onSubmit={submit} className="mt-4 space-y-4">{q.data.questions.map((qq, i) => <fieldset key={qq.id}><legend className="mb-1">{i + 1}. {qq.prompt}</legend>{qq.options.map((o, j) => <label key={j} className="flex gap-2 text-sm py-0.5"><input type="radio" name={qq.id} checked={answers[qq.id] === j} onChange={() => setAnswers({ ...answers, [qq.id]: j })} />{o}</label>)}</fieldset>)}
      <button className="btn-primary !py-2">Enviar respostas</button>{err && <p role="alert" className="text-destructive text-sm">{err}</p>}
      {res && <p role="status" className={res.passed ? "text-navy-900" : "text-destructive"}>Nota: {res.score}% — {res.passed ? "aprovado(a)" : "não aprovado(a). Você pode tentar novamente."}</p>}</form>}</li>);
};

const Community = ({ courseId }: { courseId: string }) => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [body, setBody] = useState("");
  const posts = useQuery({ queryKey: ["c-posts", courseId], queryFn: async () => (await supabase.from("community_posts").select("id, body, created_at, author_name").eq("course_id", courseId).is("parent_id", null).order("created_at", { ascending: false }).limit(50)).data as unknown as { id: string; body: string; created_at: string; author_name: string | null }[] });
  const send = async (e: FormEvent) => { e.preventDefault(); if (!body.trim()) return; const { error } = await supabase.rpc("community_post", { p_course: courseId, p_body: body }); error ? m.err(errText(error)) : (setBody(""), void qc.invalidateQueries({ queryKey: ["c-posts", courseId] })); };
  return (<section className="mt-10"><h3 className="text-xl mb-2">Comunidade</h3><Msg m={msg} />
    <form onSubmit={send} className="flex gap-2 mb-4"><label className="sr-only" htmlFor="cb">Sua mensagem</label><textarea id="cb" rows={2} className={inputCls} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} /><button className={btnGhost}>Publicar</button></form>
    <ul className="space-y-2">{posts.data?.map((p) => <li key={p.id} className="bg-card border border-border p-3"><p className="text-xs text-navy-400">{p.author_name ?? "Aluno"} · {fmtDate(p.created_at)}</p><p className="whitespace-pre-line">{p.body}</p></li>)}</ul></section>);
};
