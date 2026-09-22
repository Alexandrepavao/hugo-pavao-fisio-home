import { useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, CheckCircle2, Circle, Lock, MessageSquare, Video } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { safeUrl } from "@/features/pages/blocks";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { Badge, EmptyState, errText, Msg, State, Tabs, useMsg } from "@/lib/ui";
import PortalShell from "./PortalShell";

interface Course { id: string; title: string; slug: string; description: string | null; kind: string }
interface Lesson { id: string; title: string; kind: string; body: string | null; external_url: string | null; storage_path: string | null; position: number; starts_at: string | null; module_id: string | null; course_id?: string }
interface Module { id: string; title: string; position: number }
const KIND: Record<string, string> = { course: "Curso", mentoring: "Mentoria", program: "Programa" };

/** Capa gerada localmente (sem imagem externa): faixa azul com a inicial e o tipo. */
const Cover = ({ title, kind }: { title: string; kind: string }) => (
  <div aria-hidden className="relative aspect-[16/9] grid place-items-center overflow-hidden rounded-t-lg" style={{ background: "linear-gradient(135deg, hsl(var(--navy-700)), hsl(var(--navy-900)))" }}>
    <span className="text-white/90 font-bold" style={{ fontFamily: "Manrope, Inter, sans-serif", fontSize: "2.5rem" }}>{title.trim().slice(0, 1).toUpperCase()}</span>
    <span className="absolute left-3 bottom-2 text-[11px] font-medium text-white/70 uppercase tracking-wide">{KIND[kind] ?? kind}</span>
  </div>
);

export const AcademyHome = () => {
  const courses = useQuery({ queryKey: ["my-courses"], queryFn: async () => (await supabase.from("courses").select("id, title, slug, description, kind").eq("status", "published").order("title")).data as Course[] });
  const lessons = useQuery({ queryKey: ["my-lessons-all"], queryFn: async () => (await supabase.from("lessons").select("id, course_id, kind").eq("published", true).neq("kind", "live")).data ?? [] });
  const prog = useQuery({ queryKey: ["my-progress-all"], queryFn: async () => (await supabase.from("lesson_progress").select("lesson_id, course_id, completed_at, last_viewed_at")).data ?? [] });

  const stats = useMemo(() => {
    const total: Record<string, number> = {}; const done: Record<string, number> = {}; const last: Record<string, string> = {};
    (lessons.data ?? []).forEach((l) => { total[l.course_id] = (total[l.course_id] ?? 0) + 1; });
    (prog.data ?? []).forEach((p) => { if (p.completed_at) done[p.course_id] = (done[p.course_id] ?? 0) + 1; if (!last[p.course_id] || p.last_viewed_at > last[p.course_id]) last[p.course_id] = p.last_viewed_at; });
    return { total, done, last };
  }, [lessons.data, prog.data]);
  const pct = (id: string) => (stats.total[id] ? Math.round(((stats.done[id] ?? 0) * 100) / stats.total[id]) : 0);
  const cont = (courses.data ?? []).filter((c) => pct(c.id) > 0 && pct(c.id) < 100).sort((a, b) => (stats.last[b.id] ?? "").localeCompare(stats.last[a.id] ?? ""))[0];

  return (
    <PortalShell title="HP Academy" subtitle="Cursos, mentorias e comunidade para fisioterapeutas e alunos.">
      <State loading={courses.isLoading} error={courses.error} />
      {courses.data?.length === 0 && (
        <EmptyState icon={Lock} title="Você ainda não tem cursos liberados">O acesso é liberado após a confirmação do pagamento, pela sua turma ou pela equipe do HP Group. Se você já pagou e não vê o curso, fale com a equipe — o acesso é conferido no servidor a cada consulta.</EmptyState>
      )}
      {cont && (
        <section aria-label="Continuar de onde parou" className="hp-card p-4 mb-6 flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-xs text-muted-foreground">Continuar de onde parou</p><p className="font-semibold">{cont.title}</p><p className="text-xs text-muted-foreground tabular">{pct(cont.id)}% concluído</p></div>
          <Link to={`/academy/${cont.slug}`} className="hp-btn hp-btn-primary">Continuar</Link>
        </section>
      )}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {courses.data?.map((c) => { const p = pct(c.id); return (
          <li key={c.id} className="hp-card overflow-hidden flex flex-col hover:border-input transition-colors">
            <Cover title={c.title} kind={c.kind} />
            <div className="p-4 flex flex-col gap-2 flex-1">
              <div className="flex items-center gap-2">{p >= 100 ? <Badge tone="success">Concluído</Badge> : p > 0 ? <Badge tone="info">Em andamento</Badge> : <Badge>Novo</Badge>}<span className="text-xs text-muted-foreground tabular">{stats.total[c.id] ?? 0} aulas</span></div>
              <h2 className="!text-[1rem]">{c.title}</h2>
              {c.description && <p className="text-[13px] text-muted-foreground line-clamp-2">{c.description}</p>}
              <div className="mt-auto pt-2"><div className="h-1.5 rounded-full bg-muted overflow-hidden" role="progressbar" aria-label={`Progresso em ${c.title}`} aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}><div className="h-full" style={{ width: `${p}%`, background: "hsl(var(--primary))" }} /></div>
                <Link className="hp-btn hp-btn-outline w-full mt-3" to={`/academy/${c.slug}`}>{p > 0 && p < 100 ? "Continuar" : p >= 100 ? "Revisar" : "Começar"}</Link></div>
            </div>
          </li>); })}
      </ul>
    </PortalShell>
  );
};

export const CourseView = () => {
  const { slug = "" } = useParams(); const qc = useQueryClient(); const [msg, m] = useMsg(); const [cur, setCur] = useState<string | null>(null); const [tab, setTab] = useState("aula");
  const course = useQuery({ queryKey: ["course", slug], queryFn: async () => (await supabase.from("courses").select("id, title, slug, description, kind").eq("slug", slug).maybeSingle()).data as Course | null });
  const c = course.data;
  const modules = useQuery({ queryKey: ["c-modules", c?.id], enabled: !!c, queryFn: async () => (await supabase.from("course_modules").select("id, title, position").eq("course_id", c!.id).order("position")).data as Module[] });
  const lessons = useQuery({ queryKey: ["c-lessons", c?.id], enabled: !!c, queryFn: async () => (await supabase.from("lessons").select("id, title, kind, body, external_url, storage_path, position, starts_at, module_id").eq("course_id", c!.id).eq("published", true).order("position")).data as Lesson[] });
  const done = useQuery({ queryKey: ["c-done", c?.id], enabled: !!c, queryFn: async () => new Set(((await supabase.from("lesson_progress").select("lesson_id").eq("course_id", c!.id).not("completed_at", "is", null)).data ?? []).map((r) => r.lesson_id)) });
  const prog = useQuery({ queryKey: ["c-prog", c?.id], enabled: !!c, queryFn: async () => ((await supabase.rpc("course_progress", { p_course: c!.id })).data as { total: number; done: number; percent: number }[] | null)?.[0] });
  const quizzes = useQuery({ queryKey: ["c-quiz", c?.id], enabled: !!c, queryFn: async () => (await supabase.from("quizzes").select("id, title, pass_score").eq("course_id", c!.id)).data ?? [] });
  const cert = useQuery({ queryKey: ["c-cert", c?.id], enabled: !!c, queryFn: async () => (await supabase.from("certificates").select("code, issued_at").eq("course_id", c!.id).maybeSingle()).data });
  const list = lessons.data ?? [];
  const nextPending = list.find((l) => l.kind !== "live" && !done.data?.has(l.id));
  const lesson = list.find((l) => l.id === (cur ?? nextPending?.id ?? list[0]?.id));
  const signed = useQuery({ queryKey: ["signed", lesson?.storage_path], enabled: !!lesson?.storage_path, staleTime: 50 * 60_000, queryFn: async () => (await supabase.storage.from("academy-private").createSignedUrl(lesson!.storage_path!, 3600)).data?.signedUrl ?? null });

  const groups = useMemo(() => {
    const mods = modules.data ?? []; const out: { id: string; title: string; items: Lesson[] }[] = mods.map((mo) => ({ id: mo.id, title: mo.title, items: list.filter((l) => l.module_id === mo.id) })).filter((g) => g.items.length);
    const loose = list.filter((l) => !l.module_id || !mods.some((mo) => mo.id === l.module_id)); if (loose.length) out.unshift({ id: "_", title: mods.length ? "Geral" : "Aulas", items: loose });
    return out;
  }, [modules.data, list]);

  const complete = async () => { if (!lesson) return; const { error } = await supabase.rpc("lesson_complete", { p_lesson: lesson.id }); error ? m.err(errText(error)) : (m.ok("Aula concluída."), void qc.invalidateQueries({ queryKey: ["c-done", c?.id] }), void qc.invalidateQueries({ queryKey: ["c-prog", c?.id] }), void qc.invalidateQueries({ queryKey: ["my-progress-all"] })); };
  const issue = async () => { const { error } = await supabase.rpc("issue_certificate", { p_course: c!.id }); error ? m.err(errText(error)) : (m.ok("Certificado emitido."), void qc.invalidateQueries({ queryKey: ["c-cert", c?.id] })); };

  if (course.isLoading) return <PortalShell title="Carregando…"><State loading /></PortalShell>;
  if (!c) return <PortalShell title="Acesso não disponível"><EmptyState icon={Lock} title="Você não tem acesso a este curso" action={<Link className="hp-btn hp-btn-outline mt-2" to="/academy">Voltar aos cursos</Link>}>Ele pode não estar liberado para você, ter expirado ou ter sido encerrado. O acesso é conferido no servidor — esconder o menu não seria suficiente, por isso não há como abrir o conteúdo por outro caminho.</EmptyState></PortalShell>;
  const pctNow = prog.data?.percent ?? 0;
  return (
    <PortalShell title={c.title} subtitle={c.description ?? undefined} actions={<Link className="hp-btn hp-btn-outline" to="/academy">Todos os cursos</Link>}>
      <Msg m={msg} />
      <div className="mb-5"><div className="flex justify-between text-xs text-muted-foreground mb-1"><span>Seu progresso</span><span className="tabular">{pctNow}% ({prog.data?.done ?? 0}/{prog.data?.total ?? 0} aulas)</span></div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden" role="progressbar" aria-valuenow={pctNow} aria-valuemin={0} aria-valuemax={100}><div className="h-full" style={{ width: `${pctNow}%`, background: "hsl(var(--primary))" }} /></div></div>
      <div className="grid gap-5 lg:grid-cols-[19rem_1fr] items-start">
        <nav aria-label="Conteúdo do curso" className="hp-card overflow-hidden lg:sticky lg:top-20">
          {groups.length === 0 && <p className="p-4 text-sm text-muted-foreground">Ainda não há aulas publicadas.</p>}
          {groups.map((g) => (
            <section key={g.id}><h2 className="!text-[0.75rem] uppercase tracking-wide text-muted-foreground px-4 pt-3 pb-1 font-semibold">{g.title}</h2>
              <ul>{g.items.map((l) => { const isDone = done.data?.has(l.id); const active = l.id === lesson?.id; return (
                <li key={l.id}><button onClick={() => { setCur(l.id); setTab("aula"); }} aria-current={active ? "true" : undefined} className={`w-full text-left px-4 py-2 text-sm flex items-start gap-2 ${active ? "bg-muted font-medium" : "hover:bg-muted/60"}`}>
                  {isDone ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" style={{ color: "hsl(var(--success))" }} aria-label="Concluída" /> : l.kind === "live" ? <Video size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden /> : <Circle size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-label="Pendente" />}
                  <span>{l.title}{l.starts_at && <span className="block text-xs text-muted-foreground">{fmtDateTime(l.starts_at)}</span>}</span></button></li>); })}</ul></section>))}
        </nav>
        <article className="min-w-0">
          <Tabs tabs={[["aula", "Aula"], ["comunidade", "Comunidade"], ["avaliacao", "Avaliações e certificado"]]} value={tab} onChange={setTab} />
          {tab === "aula" && (lesson ? (
            <div className="hp-card p-5">
              <h2 className="!text-[1.125rem] mb-3">{lesson.title}</h2>
              {lesson.storage_path && (signed.data ? (lesson.kind === "video" ? <video controls controlsList="nodownload" className="w-full mb-4 rounded bg-black" src={signed.data} /> : <a className="hp-btn hp-btn-outline mb-4" href={signed.data} target="_blank" rel="noopener noreferrer">Abrir material</a>) : <p className="text-sm text-muted-foreground mb-3" role="status">Preparando acesso protegido ao material…</p>)}
              {lesson.external_url && safeUrl(lesson.external_url) && <p className="mb-3 text-sm"><a className="underline text-accent" href={lesson.external_url} target="_blank" rel="noopener noreferrer">Abrir material externo</a> <span className="text-xs text-muted-foreground">(link externo, sem proteção de acesso)</span></p>}
              {(lesson.body ?? "").split(/\n{2,}/).map((p, i) => <p key={i} className="mb-3 whitespace-pre-line">{p}</p>)}
              {lesson.kind !== "live" && <button className="hp-btn hp-btn-primary mt-2" onClick={complete} disabled={done.data?.has(lesson.id)}>{done.data?.has(lesson.id) ? "Aula concluída" : "Marcar como concluída"}</button>}
            </div>) : <EmptyState icon={BookOpen} title="Nenhuma aula publicada ainda">Volte em breve — a equipe está preparando o conteúdo.</EmptyState>)}
          {tab === "comunidade" && <Community courseId={c.id} />}
          {tab === "avaliacao" && (
            <div className="grid gap-3">
              {(quizzes.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Este curso não tem avaliações.</p> : quizzes.data!.map((q) => <Quiz key={q.id} id={q.id} title={q.title} pass={q.pass_score} />)}
              <div className="hp-card p-4"><h3 className="mb-1">Certificado</h3>
                {cert.data ? <p>Certificado <b>{cert.data.code}</b> emitido em {fmtDate(cert.data.issued_at)}.</p> : <><p className="text-sm text-muted-foreground mb-2">Exige a conclusão das aulas e a aprovação nas avaliações.</p><button className="hp-btn hp-btn-outline" onClick={issue}>Emitir certificado</button></>}</div>
            </div>)}
        </article>
      </div>
    </PortalShell>
  );
};

const Quiz = ({ id, title, pass }: { id: string; title: string; pass: number }) => {
  const [open, setOpen] = useState(false); const [answers, setAnswers] = useState<Record<string, number>>({}); const [res, setRes] = useState<{ score: number; passed: boolean } | null>(null); const [err, setErr] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["quiz", id], enabled: open, queryFn: async () => (await supabase.rpc("quiz_for_student", { p_quiz: id })).data as { questions: { id: string; prompt: string; options: string[] }[] } });
  const submit = async (e: FormEvent) => { e.preventDefault(); const { data, error } = await supabase.rpc("quiz_submit", { p_quiz: id, p_answers: answers }); error ? setErr(errText(error)) : setRes(data as { score: number; passed: boolean }); };
  return (<div className="hp-card p-4"><div className="flex justify-between items-center gap-3"><span>{title} <span className="text-xs text-muted-foreground">(mínimo {pass}%)</span></span><button className="hp-btn hp-btn-outline hp-btn-sm" onClick={() => setOpen(!open)}>{open ? "Fechar" : "Fazer avaliação"}</button></div>
    {open && q.data && <form onSubmit={submit} className="mt-4 grid gap-4">{q.data.questions.map((qq, i) => <fieldset key={qq.id}><legend className="mb-1 font-medium">{i + 1}. {qq.prompt}</legend>{qq.options.map((o, j) => <label key={j} className="flex gap-2 text-sm py-0.5 !font-normal"><input type="radio" name={qq.id} checked={answers[qq.id] === j} onChange={() => setAnswers({ ...answers, [qq.id]: j })} />{o}</label>)}</fieldset>)}
      <button className="hp-btn hp-btn-primary w-fit">Enviar respostas</button>{err && <p role="alert" className="text-destructive text-sm">{err}</p>}
      {res && <p role="status" className={res.passed ? "" : "text-destructive"}>Nota: {res.score}% — {res.passed ? "aprovado(a)" : "não aprovado(a). Você pode tentar novamente."}</p>}</form>}</div>);
};

interface Post { id: string; body: string; created_at: string; author_name: string | null; parent_id: string | null }
const Community = ({ courseId }: { courseId: string }) => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [body, setBody] = useState(""); const [reply, setReply] = useState<string | null>(null); const [rbody, setRbody] = useState("");
  const posts = useQuery({ queryKey: ["c-posts", courseId], queryFn: async () => (await supabase.from("community_posts").select("id, body, created_at, author_name, parent_id").eq("course_id", courseId).order("created_at", { ascending: true }).limit(300)).data as Post[] });
  const send = async (text: string, parent: string | null) => { if (!text.trim()) return; const { error } = await supabase.rpc("community_post", { p_course: courseId, p_body: text, p_parent: parent }); error ? m.err(errText(error)) : (setBody(""), setRbody(""), setReply(null), void qc.invalidateQueries({ queryKey: ["c-posts", courseId] })); };
  const top = (posts.data ?? []).filter((p) => !p.parent_id).reverse(); const kids = (id: string) => (posts.data ?? []).filter((p) => p.parent_id === id);
  return (<section aria-label="Comunidade do curso">
    <p className="text-xs text-muted-foreground mb-3">Espaço de discussão do curso. Não compartilhe dados de pacientes: o acompanhamento individual não acontece aqui.</p><Msg m={msg} />
    <form onSubmit={(e) => { e.preventDefault(); void send(body, null); }} className="hp-card p-3 grid gap-2 mb-4"><label htmlFor="cb" className="sr-only">Nova discussão</label><textarea id="cb" rows={2} placeholder="Compartilhe uma dúvida ou aprendizado…" value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} /><button className="hp-btn hp-btn-primary w-fit">Publicar</button></form>
    {top.length === 0 && <EmptyState icon={MessageSquare} title="Nenhuma discussão ainda">Seja a primeira pessoa a publicar.</EmptyState>}
    <ul className="grid gap-3">{top.map((p) => (
      <li key={p.id} className="hp-card p-4"><p className="text-xs text-muted-foreground">{p.author_name ?? "Aluno"} · {fmtDate(p.created_at)}</p><p className="whitespace-pre-line mt-1">{p.body}</p>
        {kids(p.id).length > 0 && <ul className="mt-3 grid gap-2 border-l-2 border-border pl-3">{kids(p.id).map((k) => <li key={k.id}><p className="text-xs text-muted-foreground">{k.author_name ?? "Aluno"} · {fmtDate(k.created_at)}</p><p className="whitespace-pre-line text-sm">{k.body}</p></li>)}</ul>}
        {reply === p.id ? <form onSubmit={(e) => { e.preventDefault(); void send(rbody, p.id); }} className="mt-3 flex gap-2"><label className="sr-only" htmlFor={`r-${p.id}`}>Resposta</label><input id={`r-${p.id}`} autoFocus value={rbody} onChange={(e) => setRbody(e.target.value)} /><button className="hp-btn hp-btn-outline">Responder</button></form>
          : <button className="text-sm text-accent font-medium mt-2" onClick={() => { setReply(p.id); setRbody(""); }}>Responder</button>}</li>))}</ul>
  </section>);
};
