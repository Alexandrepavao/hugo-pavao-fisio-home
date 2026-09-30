import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { validateSlug } from "@/lib/reserved-slugs";
import { fmtDate } from "@/lib/format";
import { btnDanger, btnGhost, promptText, errText, inputCls, Msg, PageHead, State, Table, Tabs, Td, useMsg } from "@/lib/ui";

interface Course { id: string; title: string; slug: string; kind: string; status: string; product_id: string | null; org_id: string; certificate_min_progress: number }
interface Lesson { id: string; title: string; kind: string; position: number; published: boolean; body: string | null; external_url: string | null; storage_path: string | null }
const KIND: Record<string, string> = { course: "Curso", mentoring: "Mentoria", program: "Programa" };
const STAT: Record<string, string> = { draft: "Rascunho", published: "Publicado", archived: "Arquivado" };

const AcademyAdmin = () => {
  const [tab, setTab] = useState("cursos");
  return (<div>
    <PageHead eyebrow="HP Academy" title="Cursos e mentorias" hint="O acesso do aluno é verificado no servidor a cada consulta: liberar, expirar ou revogar tem efeito imediato (não é só esconder menu)." />
    <Tabs tabs={[["cursos", "Cursos"], ["trilhas", "Trilhas"]]} value={tab} onChange={setTab} />
    {tab === "cursos" && <Courses />}
    {tab === "trilhas" && <Tracks />}
  </div>);
};

const Courses = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [sel, setSel] = useState<string | null>(null);
  const [title, setTitle] = useState(""); const [slug, setSlug] = useState(""); const [kind, setKind] = useState("course"); const [prod, setProd] = useState("");
  const courses = useQuery({ queryKey: ["courses"], queryFn: async () => (await supabase.from("courses").select("id, title, slug, kind, status, product_id, org_id, certificate_min_progress").order("created_at", { ascending: false })).data as Course[] });
  const products = useQuery({ queryKey: ["prods-edu"], queryFn: async () => (await supabase.from("products").select("id, name, kind").in("kind", ["course", "mentoring"])).data ?? [] });
  const create = async (e: FormEvent) => {
    e.preventDefault(); const se = validateSlug(slug); if (se || !title.trim()) return m.err(se ?? "Informe o título.");
    const { data: u } = await supabase.auth.getUser(); const { data: o } = await supabase.from("organizations").select("id").single();
    const { error } = await supabase.from("courses").insert({ org_id: o?.id, title: title.trim(), slug, kind, product_id: prod || null, created_by: u.user?.id });
    if (error) m.err(errText(error)); else { m.ok("Curso criado como rascunho."); setTitle(""); setSlug(""); void qc.invalidateQueries({ queryKey: ["courses"] }); }
  };
  const course = courses.data?.find((c) => c.id === sel);
  return (<>
    <Msg m={msg} />
    <form onSubmit={create} className="hp-card p-5 mb-6 grid gap-3 sm:grid-cols-5 items-end" noValidate>
      <div className="sm:col-span-2"><label htmlFor="ct" className="block text-xs mb-1">Título</label><input id="ct"   value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      <div><label htmlFor="cs" className="block text-xs mb-1">Endereço</label><input id="cs"   value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} /></div>
      <div><label htmlFor="ck" className="block text-xs mb-1">Tipo</label><select id="ck"   value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      <div><label htmlFor="cp" className="block text-xs mb-1">Produto (acesso por compra)</label><select id="cp"   value={prod} onChange={(e) => setProd(e.target.value)}><option value="">Nenhum</option>{products.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
      <button className="hp-btn hp-btn-primary sm:col-span-5 sm:w-fit">Criar curso</button></form>
    <State loading={courses.isLoading} error={courses.error} empty={courses.data?.length === 0} emptyText="Nenhum curso criado." />
    {courses.data && courses.data.length > 0 && <Table head={["Curso", "Tipo", "Estado", ""]}>{courses.data.map((c) => <tr key={c.id}><Td>{c.title}</Td><Td>{KIND[c.kind]}</Td><Td>{STAT[c.status]}</Td>
      <Td><button className={btnGhost + " hp-btn-sm"} onClick={() => setSel(c.id === sel ? null : c.id)}>{c.id === sel ? "Fechar" : "Gerenciar"}</button></Td></tr>)}</Table>}
    {course && <CourseManager course={course} onChanged={() => qc.invalidateQueries({ queryKey: ["courses"] })} />}
  </>);
};

interface Track { id: string; slug: string; title: string; description: string | null; status: string; position: number }
const TRACK_ST: Record<string, string> = { draft: "Rascunho", published: "Publicado" };

/** Trilhas: agrupam cursos já cadastrados em uma sequência recomendada. Nunca inventa curso/aula — só ordena o que já existe. */
const Tracks = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [sel, setSel] = useState<string | null>(null);
  const [title, setTitle] = useState(""); const [slug, setSlug] = useState(""); const [desc, setDesc] = useState("");
  const tracks = useQuery({ queryKey: ["tracks"], queryFn: async () => (await supabase.from("learning_tracks").select("id, slug, title, description, status, position").order("position")).data as Track[] });
  const allCourses = useQuery({ queryKey: ["courses-for-tracks"], queryFn: async () => (await supabase.from("courses").select("id, title, status").order("title")).data as { id: string; title: string; status: string }[] });
  const linked = useQuery({ queryKey: ["track-courses", sel], enabled: !!sel, queryFn: async () => (await supabase.from("learning_track_courses").select("course_id, position, course:courses(id, title, status)").eq("track_id", sel).order("position")).data as unknown as { course_id: string; position: number; course: { id: string; title: string; status: string } }[] });

  const create = async (e: FormEvent) => {
    e.preventDefault(); const se = validateSlug(slug); if (se || !title.trim()) return m.err(se ?? "Informe o título.");
    const { data: u } = await supabase.auth.getUser(); const { data: o } = await supabase.from("organizations").select("id").single();
    const { error } = await supabase.from("learning_tracks").insert({ org_id: o?.id, slug, title: title.trim(), description: desc || null, position: (tracks.data?.length ?? 0) + 1, created_by: u.user?.id });
    if (error) m.err(errText(error)); else { m.ok("Trilha criada como rascunho."); setTitle(""); setSlug(""); setDesc(""); void qc.invalidateQueries({ queryKey: ["tracks"] }); }
  };
  const toggleStatus = async (t: Track) => {
    const next = t.status === "draft" ? "published" : "draft";
    const { error } = await supabase.from("learning_tracks").update({ status: next }).eq("id", t.id);
    if (error) m.err(errText(error)); else { m.ok(next === "published" ? "Trilha publicada." : "Trilha voltou a rascunho."); void qc.invalidateQueries({ queryKey: ["tracks"] }); }
  };
  const addCourse = async (trackId: string, courseId: string) => {
    if (!courseId) return;
    const { error } = await supabase.from("learning_track_courses").insert({ track_id: trackId, course_id: courseId, position: (linked.data?.length ?? 0) + 1 });
    if (error) m.err(errText(error)); else void qc.invalidateQueries({ queryKey: ["track-courses", trackId] });
  };
  const removeCourse = async (trackId: string, courseId: string) => {
    const { error } = await supabase.from("learning_track_courses").delete().eq("track_id", trackId).eq("course_id", courseId);
    if (error) m.err(errText(error)); else void qc.invalidateQueries({ queryKey: ["track-courses", trackId] });
  };

  return (<>
    <Msg m={msg} />
    <p className="text-sm text-muted-foreground mb-3">Estrutura proposta como ponto de partida (rascunho). Publicar uma trilha vazia não expõe conteúdo — vincule cursos reais antes de publicar.</p>
    <form onSubmit={create} className="hp-card p-4 mb-6 grid gap-3 sm:grid-cols-4 items-end" noValidate>
      <div><label htmlFor="tt" className="block text-xs mb-1">Título</label><input id="tt"   value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      <div><label htmlFor="ts" className="block text-xs mb-1">Endereço</label><input id="ts"   value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} /></div>
      <div className="sm:col-span-2"><label htmlFor="td" className="block text-xs mb-1">Descrição</label><input id="td"   value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
      <button className="hp-btn hp-btn-primary sm:col-span-4 sm:w-fit">Criar trilha</button>
    </form>
    <State loading={tracks.isLoading} error={tracks.error} empty={tracks.data?.length === 0} emptyText="Nenhuma trilha criada." />
    {tracks.data && tracks.data.length > 0 && <ul className="grid gap-2">
      {tracks.data.map((t) => (
        <li key={t.id} className="hp-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><p className="font-medium">{t.title}</p>{t.description && <p className="text-sm text-muted-foreground">{t.description}</p>}</div>
            <div className="flex items-center gap-2">
              <span className="hp-badge">{TRACK_ST[t.status]}</span>
              <button className={btnGhost + " hp-btn-sm"} onClick={() => toggleStatus(t)}>{t.status === "draft" ? "Publicar" : "Voltar a rascunho"}</button>
              <button className={btnGhost + " hp-btn-sm"} onClick={() => setSel(sel === t.id ? null : t.id)}>{sel === t.id ? "Fechar" : "Cursos da trilha"}</button>
            </div>
          </div>
          {sel === t.id && (
            <div className="mt-3 border-t border-border pt-3">
              {linked.data && linked.data.length > 0 ? <ul className="mb-3 grid gap-1.5">
                {linked.data.map((l) => <li key={l.course_id} className="flex items-center justify-between text-sm bg-muted/50 px-3 py-2">
                  <span>{l.course.title} {l.course.status !== "published" && <span className="text-muted-foreground">({STAT[l.course.status]})</span>}</span>
                  <button className="text-destructive text-xs" onClick={() => removeCourse(t.id, l.course_id)}>Remover</button></li>)}
              </ul> : <p className="text-sm text-muted-foreground mb-3">Nenhum curso vinculado ainda.</p>}
              <label htmlFor={`add-${t.id}`} className="sr-only">Adicionar curso</label>
              <select id={`add-${t.id}`}   defaultValue="" onChange={(e) => { void addCourse(t.id, e.target.value); e.target.value = ""; }}>
                <option value="" disabled>Adicionar curso existente…</option>
                {allCourses.data?.filter((c) => !linked.data?.some((l) => l.course_id === c.id)).map((c) => <option key={c.id} value={c.id}>{c.title} ({STAT[c.status]})</option>)}
              </select>
            </div>
          )}
        </li>
      ))}
    </ul>}
  </>);
};

const CourseManager = ({ course, onChanged }: { course: Course; onChanged: () => void }) => {
  const [tab, setTab] = useState("aulas"); const [msg, m] = useMsg(); const qc = useQueryClient();
  const setStatus = async (s: string) => { const { error } = await supabase.from("courses").update({ status: s }).eq("id", course.id); if (error) m.err(errText(error)); else { m.ok("Estado atualizado."); onChanged(); } };
  const setMinProgress = async (v: number) => {
    if (!Number.isFinite(v) || v < 1 || v > 100) return m.err("Informe um valor entre 1 e 100.");
    const { error } = await supabase.from("courses").update({ certificate_min_progress: v }).eq("id", course.id);
    if (error) return m.err(errText(error)); m.ok("Critério de conclusão atualizado."); onChanged();
  };
  return (<section className="mt-8 border-t border-border pt-6"><h2 className="text-2xl mb-1">{course.title}</h2>
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <button className={btnGhost} onClick={() => setStatus("published")} disabled={course.status === "published"}>Publicar</button><button className={btnGhost} onClick={() => setStatus("draft")} disabled={course.status === "draft"}>Voltar a rascunho</button><button className={btnDanger} onClick={() => setStatus("archived")}>Arquivar</button>
      <label htmlFor={`cmp-${course.id}`} className="text-xs text-muted-foreground ml-2">Conclusão (% mínimo)</label>
      <input id={`cmp-${course.id}`} type="number" min={1} max={100} className="w-16" defaultValue={course.certificate_min_progress}
        onBlur={(e) => { const v = Number(e.target.value); if (v !== course.certificate_min_progress) void setMinProgress(v); }} />
    </div>
    <Msg m={msg} /><Tabs tabs={[["aulas", "Aulas"], ["provas", "Avaliações"], ["acessos", "Acessos"], ["turmas", "Turmas"], ["comunidade", "Comunidade"]]} value={tab} onChange={setTab} />
    {tab === "aulas" && <Lessons course={course} />}{tab === "provas" && <Quizzes course={course} />}{tab === "acessos" && <Access course={course} />}{tab === "turmas" && <Cohorts course={course} />}{tab === "comunidade" && <Community course={course} refresh={() => qc.invalidateQueries({ queryKey: ["posts", course.id] })} />}
  </section>);
};

const Lessons = ({ course }: { course: Course }) => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [t, setT] = useState(""); const [k, setK] = useState("text"); const [body, setBody] = useState(""); const [url, setUrl] = useState(""); const [file, setFile] = useState<File | null>(null); const [busy, setBusy] = useState(false);
  const list = useQuery({ queryKey: ["lessons", course.id], queryFn: async () => (await supabase.from("lessons").select("id, title, kind, position, published, body, external_url, storage_path").eq("course_id", course.id).order("position")).data as Lesson[] });
  const add = async (e: FormEvent) => {
    e.preventDefault(); if (!t.trim()) return m.err("Informe o título."); setBusy(true);
    let storage_path: string | null = null;
    if (file) { storage_path = `${course.id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_")}`; const up = await supabase.storage.from("academy-private").upload(storage_path, file); if (up.error) { setBusy(false); return m.err("Falha no envio do arquivo (privado)."); } }
    const { error } = await supabase.from("lessons").insert({ org_id: course.org_id, course_id: course.id, module_id: moduleId || null, title: t.trim(), kind: k, body: body || null, external_url: url || null, storage_path, position: (list.data?.length ?? 0) + 1 });
    setBusy(false); if (error) return m.err(errText(error)); m.ok("Aula criada (não publicada)."); setT(""); setBody(""); setUrl(""); setFile(null); void qc.invalidateQueries({ queryKey: ["lessons", course.id] });
  };
  const [moduleId, setModuleId] = useState(""); const [newModule, setNewModule] = useState("");
  const modules = useQuery({ queryKey: ["modules", course.id], queryFn: async () => (await supabase.from("course_modules").select("id, title, position").eq("course_id", course.id).order("position")).data ?? [] });
  const addModule = async () => { if (!newModule.trim()) return; const { error } = await supabase.from("course_modules").insert({ org_id: course.org_id, course_id: course.id, title: newModule.trim(), position: (modules.data?.length ?? 0) + 1 }); if (error) m.err(errText(error)); else { m.ok("Módulo criado."); setNewModule(""); void qc.invalidateQueries({ queryKey: ["modules", course.id] }); } };
  const toggle = async (l: Lesson) => { const { error } = await supabase.from("lessons").update({ published: !l.published }).eq("id", l.id); error ? m.err(errText(error)) : void qc.invalidateQueries({ queryKey: ["lessons", course.id] }); };
  return (<><Msg m={msg} />
    <form onSubmit={add} className="hp-card p-4 mb-4 grid gap-3 sm:grid-cols-2" noValidate>
      <div><label htmlFor="lt" className="block text-xs mb-1">Título da aula</label><input id="lt"   value={t} onChange={(e) => setT(e.target.value)} /></div>
      <div><label htmlFor="lk" className="block text-xs mb-1">Tipo</label><select id="lk"   value={k} onChange={(e) => setK(e.target.value)}><option value="text">Texto</option><option value="video">Vídeo</option><option value="file">Arquivo</option><option value="live">Ao vivo / encontro</option></select></div>
      <div className="sm:col-span-2"><label htmlFor="lb" className="block text-xs mb-1">Conteúdo (texto)</label><textarea id="lb" rows={3}   value={body} onChange={(e) => setBody(e.target.value)} /></div>
      <div><label htmlFor="lm" className="block text-xs mb-1">Módulo</label><select id="lm"   value={moduleId} onChange={(e) => setModuleId(e.target.value)}><option value="">Sem módulo</option>{modules.data?.map((mo) => <option key={mo.id} value={mo.id}>{mo.title}</option>)}</select>
        <div className="flex gap-2 mt-2"><input aria-label="Novo módulo"   placeholder="Novo módulo" value={newModule} onChange={(e) => setNewModule(e.target.value)} /><button type="button" className={btnGhost} onClick={addModule}>Criar</button></div></div>
      <div><label htmlFor="lu" className="block text-xs mb-1">Link externo (https://…)</label><input id="lu"   value={url} onChange={(e) => setUrl(e.target.value)} /></div>
      <div><label htmlFor="lf" className="block text-xs mb-1">Arquivo/vídeo privado (bucket protegido)</label><input id="lf" type="file"   onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
      <button disabled={busy} className="hp-btn hp-btn-primary sm:col-span-2 sm:w-fit disabled:opacity-60">{busy ? "Enviando…" : "Adicionar aula"}</button></form>
    <State loading={list.isLoading} error={list.error} empty={list.data?.length === 0} emptyText="Sem aulas." />
    {list.data && list.data.length > 0 && <Table head={["#", "Aula", "Tipo", "Arquivo privado", "Estado", ""]}>{list.data.map((l) => <tr key={l.id}><Td>{l.position}</Td><Td>{l.title}</Td><Td>{l.kind}</Td><Td>{l.storage_path ? "Sim" : "—"}</Td><Td>{l.published ? "Publicada" : "Rascunho"}</Td><Td><button className="text-accent text-sm" onClick={() => toggle(l)}>{l.published ? "Despublicar" : "Publicar"}</button></Td></tr>)}</Table>}</>);
};

const Quizzes = ({ course }: { course: Course }) => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [title, setTitle] = useState("Avaliação final"); const [pass, setPass] = useState("70");
  const [quizId, setQuizId] = useState(""); const [prompt, setPrompt] = useState(""); const [opts, setOpts] = useState("Opção A\nOpção B\nOpção C"); const [correct, setCorrect] = useState("1");
  const quizzes = useQuery({ queryKey: ["quizzes", course.id], queryFn: async () => (await supabase.from("quizzes").select("id, title, pass_score").eq("course_id", course.id)).data ?? [] });
  const qs = useQuery({ queryKey: ["qq", quizId], enabled: !!quizId, queryFn: async () => (await supabase.from("quiz_questions").select("id, prompt, position").eq("quiz_id", quizId).order("position")).data ?? [] });
  const addQuiz = async (e: FormEvent) => { e.preventDefault(); const { error } = await supabase.from("quizzes").insert({ org_id: course.org_id, course_id: course.id, title, pass_score: Number(pass) }); if (error) m.err(errText(error)); else { m.ok("Avaliação criada."); void qc.invalidateQueries({ queryKey: ["quizzes", course.id] }); } };
  const addQ = async (e: FormEvent) => { e.preventDefault(); const o = opts.split("\n").map((x) => x.trim()).filter(Boolean); const c = Number(correct) - 1; if (!quizId || !prompt.trim() || o.length < 2 || c < 0 || c >= o.length) return m.err("Selecione a avaliação, escreva a pergunta, ≥2 opções e uma resposta correta válida.");
    const { error } = await supabase.from("quiz_questions").insert({ org_id: course.org_id, quiz_id: quizId, prompt: prompt.trim(), options: o, correct_index: c, position: (qs.data?.length ?? 0) + 1 });
    if (error) m.err(errText(error)); else { m.ok("Questão adicionada (o gabarito nunca é enviado ao aluno)."); setPrompt(""); void qc.invalidateQueries({ queryKey: ["qq", quizId] }); } };
  return (<><Msg m={msg} />
    <form onSubmit={addQuiz} className="hp-card p-4 mb-4 flex flex-wrap gap-3 items-end"><div><label htmlFor="qt" className="block text-xs mb-1">Título</label><input id="qt"   value={title} onChange={(e) => setTitle(e.target.value)} /></div><div><label htmlFor="qp" className="block text-xs mb-1">Nota mínima (%)</label><input id="qp"   value={pass} onChange={(e) => setPass(e.target.value)} /></div><button className={btnGhost}>Criar avaliação</button></form>
    <div className="mb-3"><label htmlFor="qs" className="block text-xs mb-1">Adicionar questão a</label><select id="qs" className={inputCls + " max-w-xs"} value={quizId} onChange={(e) => setQuizId(e.target.value)}><option value="">Selecione…</option>{quizzes.data?.map((q) => <option key={q.id} value={q.id}>{q.title}</option>)}</select></div>
    {quizId && <form onSubmit={addQ} className="hp-card p-4 grid gap-3" noValidate>
      <div><label htmlFor="qq" className="block text-xs mb-1">Pergunta</label><input id="qq"   value={prompt} onChange={(e) => setPrompt(e.target.value)} /></div>
      <div><label htmlFor="qo" className="block text-xs mb-1">Opções (uma por linha)</label><textarea id="qo" rows={4}   value={opts} onChange={(e) => setOpts(e.target.value)} /></div>
      <div><label htmlFor="qc" className="block text-xs mb-1">Nº da opção correta</label><input id="qc" className={inputCls + " max-w-[8rem]"} value={correct} onChange={(e) => setCorrect(e.target.value)} /></div>
      <button className={btnGhost + " w-fit"}>Adicionar questão</button><p className="text-sm text-muted-foreground">{qs.data?.length ?? 0} questão(ões) nesta avaliação.</p></form>}</>);
};

const Access = ({ course }: { course: Course }) => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [search, setSearch] = useState(""); const [person, setPerson] = useState<{ id: string; full_name: string } | null>(null); const [until, setUntil] = useState(""); const [reason, setReason] = useState("");
  const found = useQuery({ queryKey: ["ppl-e", search], enabled: search.length >= 2 && !person, queryFn: async () => (await supabase.from("people").select("id, full_name").ilike("full_name", `%${search.replace(/[%_]/g, "")}%`).limit(6)).data ?? [] });
  const ents = useQuery({ queryKey: ["ents", course.id], queryFn: async () => (await supabase.from("entitlements").select("id, source, valid_from, valid_until, revoked_at, revoked_reason, person:people(full_name)").eq("course_id", course.id).order("created_at", { ascending: false })).data as unknown as { id: string; source: string; valid_from: string; valid_until: string | null; revoked_at: string | null; revoked_reason: string | null; person: { full_name: string } }[] });
  const grant = async (e: FormEvent) => { e.preventDefault(); if (!person) return m.err("Selecione a pessoa."); const { error } = await supabase.rpc("entitlement_grant_manual", { p_person: person.id, p_course: course.id, p_valid_until: until ? new Date(until).toISOString() : null, p_reason: reason });
    if (error) m.err(errText(error)); else { m.ok("Acesso liberado (registrado na auditoria)."); setPerson(null); setSearch(""); setReason(""); void qc.invalidateQueries({ queryKey: ["ents", course.id] }); } };
  const revoke = async (id: string) => { const r = await promptText("Revogar acesso", "Motivo da revogação", { multiline: true, confirmLabel: "Revogar", danger: true }); if (!r) return; const { error } = await supabase.rpc("entitlement_revoke", { p_id: id, p_reason: r }); if (error) m.err(errText(error)); else { m.ok("Acesso revogado — vale imediatamente."); void qc.invalidateQueries({ queryKey: ["ents", course.id] }); } };
  const SRC: Record<string, string> = { purchase: "Compra", cohort: "Turma", link: "Vínculo", manual: "Manual" };
  return (<><Msg m={msg} />
    <form onSubmit={grant} className="hp-card p-4 mb-4 grid gap-3 sm:grid-cols-4 items-end" noValidate>
      <div><label htmlFor="gp" className="block text-xs mb-1">Pessoa</label><input id="gp"   value={person ? person.full_name : search} onChange={(e) => { setPerson(null); setSearch(e.target.value); }} />{found.data?.map((p) => <button type="button" key={p.id} className="block w-full text-left p-2 border border-border hover:bg-muted" onClick={() => setPerson(p)}>{p.full_name}</button>)}</div>
      <div><label htmlFor="gu" className="block text-xs mb-1">Válido até (opcional)</label><input id="gu" type="date"   value={until} onChange={(e) => setUntil(e.target.value)} /></div>
      <div><label htmlFor="gr" className="block text-xs mb-1">Motivo (obrigatório)</label><input id="gr"   value={reason} onChange={(e) => setReason(e.target.value)} /></div><button className={btnGhost}>Liberar acesso</button></form>
    <p className="text-sm text-muted-foreground mb-3">Acesso por compra é concedido pelo pagamento confirmado no servidor (regra do produto) e revogado por estorno/cancelamento.</p>
    <State loading={ents.isLoading} error={ents.error} empty={ents.data?.length === 0} emptyText="Ninguém com acesso." />
    {ents.data && ents.data.length > 0 && <Table head={["Pessoa", "Origem", "Válido até", "Estado", ""]}>{ents.data.map((e) => <tr key={e.id}><Td>{e.person.full_name}</Td><Td>{SRC[e.source]}</Td><Td>{e.valid_until ? fmtDate(e.valid_until) : "Sem limite"}</Td><Td>{e.revoked_at ? `Revogado (${e.revoked_reason})` : e.valid_until && new Date(e.valid_until) < new Date() ? "Vencido" : "Ativo"}</Td><Td>{!e.revoked_at && <button className="text-destructive text-sm" onClick={() => revoke(e.id)}>Revogar</button>}</Td></tr>)}</Table>}</>);
};

const Cohorts = ({ course }: { course: Course }) => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [name, setName] = useState(""); const [starts, setStarts] = useState(""); const [ends, setEnds] = useState("");
  const [sel, setSel] = useState(""); const [search, setSearch] = useState("");
  const cohorts = useQuery({ queryKey: ["cohorts", course.id], queryFn: async () => (await supabase.from("cohorts").select("id, name, starts_on, ends_on").eq("course_id", course.id).order("starts_on", { ascending: false })).data ?? [] });
  const members = useQuery({ queryKey: ["cohort-members", sel], enabled: !!sel, queryFn: async () => (await supabase.from("cohort_members").select("person_id").eq("cohort_id", sel)).data?.length ?? 0 });
  const found = useQuery({ queryKey: ["ppl-co", search], enabled: !!sel && search.length >= 2, queryFn: async () => (await supabase.from("people").select("id, full_name").ilike("full_name", `%${search.replace(/[%_]/g, "")}%`).is("merged_into_id", null).limit(6)).data ?? [] });
  const create = async (e: FormEvent) => { e.preventDefault(); if (!name.trim()) return m.err("Informe o nome da turma."); const { error } = await supabase.from("cohorts").insert({ org_id: course.org_id, course_id: course.id, name: name.trim(), starts_on: starts || null, ends_on: ends || null }); if (error) m.err(errText(error)); else { m.ok("Turma criada."); setName(""); void qc.invalidateQueries({ queryKey: ["cohorts", course.id] }); } };
  const add = async (pid: string) => { const { error } = await supabase.rpc("cohort_add_member", { p_cohort: sel, p_person: pid }); if (error) m.err(errText(error)); else { m.ok("Aluno adicionado: acesso por turma concedido até o fim da turma."); setSearch(""); void qc.invalidateQueries({ queryKey: ["cohort-members", sel] }); void qc.invalidateQueries({ queryKey: ["ents", course.id] }); } };
  return (<><Msg m={msg} />
    <form onSubmit={create} className="hp-card p-4 mb-4 grid gap-3 sm:grid-cols-4 items-end" noValidate>
      <div className="sm:col-span-2"><label htmlFor="cn" className="block text-xs mb-1">Nome da turma</label><input id="cn"   value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div><label htmlFor="cs" className="block text-xs mb-1">Início</label><input id="cs" type="date"   value={starts} onChange={(e) => setStarts(e.target.value)} /></div>
      <div><label htmlFor="ce" className="block text-xs mb-1">Fim (encerra o acesso por turma)</label><input id="ce" type="date"   value={ends} onChange={(e) => setEnds(e.target.value)} /></div>
      <button className="hp-btn hp-btn-primary w-fit">Criar turma</button></form>
    <State loading={cohorts.isLoading} error={cohorts.error} empty={cohorts.data?.length === 0} emptyText="Nenhuma turma criada." />
    {cohorts.data && cohorts.data.length > 0 && <div className="grid gap-3 sm:grid-cols-2">{cohorts.data.map((c) => (
      <div key={c.id} className="hp-card p-4"><p className="font-medium">{c.name}</p><p className="text-xs text-muted-foreground mb-2">{c.starts_on ? fmtDate(c.starts_on + "T12:00:00Z") : "sem início"} → {c.ends_on ? fmtDate(c.ends_on + "T12:00:00Z") : "sem fim"}</p>
        <button className={btnGhost + " hp-btn-sm"} onClick={() => setSel(sel === c.id ? "" : c.id)}>{sel === c.id ? "Fechar" : "Adicionar alunos"}</button>
        {sel === c.id && <div className="mt-3"><p className="text-xs text-muted-foreground mb-1">{members.data ?? 0} aluno(s) na turma</p><label htmlFor="cm" className="sr-only">Buscar pessoa</label><input id="cm"   placeholder="Buscar pessoa pelo nome" value={search} onChange={(e) => setSearch(e.target.value)} />
          {found.data?.map((p) => <button type="button" key={p.id} className="block w-full text-left px-3 py-2 border border-border bg-card hover:bg-muted text-sm" onClick={() => add(p.id)}>{p.full_name} — adicionar</button>)}</div>}</div>))}</div>}</>);
};

const Community = ({ course, refresh }: { course: Course; refresh: () => void }) => {
  const [msg, m] = useMsg();
  const posts = useQuery({ queryKey: ["posts", course.id], queryFn: async () => (await supabase.from("community_posts").select("id, body, status, created_at, author_name").eq("course_id", course.id).order("created_at", { ascending: false }).limit(100)).data as unknown as { id: string; body: string; status: string; created_at: string; author_name: string | null }[] });
  const mod = async (id: string, hide: boolean) => { const { error } = await supabase.rpc("community_moderate", { p_post: id, p_hide: hide, p_reason: hide ? "moderação" : null }); if (error) m.err(errText(error)); else { m.ok(hide ? "Ocultado." : "Restaurado."); refresh(); } };
  return (<><Msg m={msg} /><State loading={posts.isLoading} error={posts.error} empty={posts.data?.length === 0} emptyText="Sem comentários." />
    <ul className="space-y-2">{posts.data?.map((p) => <li key={p.id} className="hp-card p-3"><p className="text-sm text-muted-foreground">{p.author_name ?? "Aluno"} · {fmtDate(p.created_at)} {p.status === "hidden" && "· OCULTO"}</p><p className="whitespace-pre-line">{p.body}</p>
      <button className="text-sm text-accent" onClick={() => mod(p.id, p.status === "visible")}>{p.status === "visible" ? "Ocultar" : "Restaurar"}</button></li>)}</ul></>);
};

export default AcademyAdmin;
