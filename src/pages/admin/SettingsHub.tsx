import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { brl, parseCents } from "@/lib/format";
import { Badge, btnGhost, errText, Msg, PageHead, State, Table, Td, useMsg } from "@/lib/ui";

type Category = {
  key: string; title: string; description: string;
  status: "ready" | "link" | "pending";
  linkTo?: string; linkLabel?: string;
  pendingNote?: string;
};

const CATEGORIES: Category[] = [
  { key: "org", title: "Organização e unidades", description: "Unidades (nome, cidade, UF, fuso). Dados institucionais gerais (contatos, endereço, horários) ainda não têm campo no sistema.", status: "ready" },
  { key: "team", title: "Equipe e acessos", description: "Convites, papéis e vínculos por unidade — mesma tela de sempre.", status: "link", linkTo: "/admin/equipe", linkLabel: "Abrir Equipe e acessos" },
  { key: "operacao", title: "Operação", description: "Serviços (duração/preço do atendimento) e produtos/pacotes (sessões, validade). Disponibilidade por profissional continua editada na Agenda — é uma grade por pessoa, não um parâmetro geral.", status: "ready" },
  { key: "crm", title: "Comercial e CRM", description: "Funis, etapas do funil e motivos de perda.", status: "ready" },
  { key: "captacao", title: "Captação", description: "Número de WhatsApp por jornada (avaliação/parceria) e, quando aplicável, por unidade.", status: "ready" },
  { key: "financeiro", title: "Financeiro", description: "Contas financeiras, categorias, classificação DRE e centros de custo — mesma tela acessada pelo header de Financeiro.", status: "link", linkTo: "/admin/financeiro/config", linkLabel: "Abrir Financeiro › Configurações" },
  { key: "academy", title: "Academy", description: "Critério de conclusão (% mínimo para certificado) por curso.", status: "link", linkTo: "/admin/academy", linkLabel: "Abrir Academy" },
  { key: "parceiros", title: "Parceiros", description: "Critérios de aprovação, indicações e regras de repasse.", status: "pending", pendingNote: "Aprovação, indicações e repasses já funcionam em Parceiros (fluxo do funil + repasses lançados manualmente), mas os critérios de aprovação são uma decisão administrativa registrada por fora do sistema — não há campo de configuração dedicado para regra automática de repasse (percentual padrão etc.). Precisa de definição de negócio antes de virar tela." },
  { key: "comms", title: "Comunicação e integrações", description: "Remetente, templates, status das integrações e falhas.", status: "pending", pendingNote: "Segredos (Resend, chaves de API) nunca são expostos ao frontend nem gravados em tabela de leitura pública — por desenho de segurança, não há endpoint que devolva se uma integração está configurada. Remetente e templates de e-mail são definidos em código (netlify/functions), não editáveis pela interface. Status real: consulte docs/integrations.md e o painel do Supabase/Netlify diretamente." },
  { key: "aparencia", title: "Aparência", description: "Logo e opções de identidade visual efetivamente suportadas.", status: "pending", pendingNote: "A logo é um arquivo estático do código (src/assets/hp-logo.png), não um campo configurável no banco — trocar a logo hoje exige alterar o código-fonte. Nenhuma outra opção de identidade visual é configurável pela interface." },
];

const SettingsHub = () => {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div>
      <PageHead eyebrow="Sistema" title="Configurações" hint="Central de configurações do sistema, por categoria. Só o que já tem suporte real no backend aparece como gerenciável — o resto é uma pendência documentada, nunca uma tela que finge funcionar." />
      <ul className="grid gap-3">
        {CATEGORIES.map((c) => (
          <li key={c.key} className="hp-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-medium text-foreground">{c.title}</h2>
                  {c.status === "ready" && <Badge tone="success">Gerenciável</Badge>}
                  {c.status === "link" && <Badge tone="info">Tela existente</Badge>}
                  {c.status === "pending" && <Badge tone="warning">Pendente</Badge>}
                </div>
                <p className="text-[13px] text-muted-foreground mt-1 max-w-2xl">{c.description}</p>
              </div>
              {c.status === "ready" && (
                <button type="button" className={btnGhost + " hp-btn-sm shrink-0"} onClick={() => setOpen(open === c.key ? null : c.key)}>{open === c.key ? "Fechar" : "Gerenciar"}</button>
              )}
              {c.status === "link" && c.linkTo && <Link to={c.linkTo} className={btnGhost + " hp-btn-sm shrink-0"}>{c.linkLabel}</Link>}
            </div>
            {c.status === "pending" && <p className="text-[12px] text-muted-foreground mt-3 border-t border-border pt-3">{c.pendingNote}</p>}
            {c.status === "ready" && open === c.key && (
              <div className="mt-4 border-t border-border pt-4">
                {c.key === "org" && <UnitsSettings />}
                {c.key === "captacao" && <QuizWhatsAppSettings />}
                {c.key === "operacao" && <OperationSettings />}
                {c.key === "crm" && <CrmSettings />}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

interface Unit { id: string; name: string; slug: string; city: string | null; state: string | null; timezone: string; active: boolean }

const UnitsSettings = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg();
  const [name, setName] = useState(""); const [slug, setSlug] = useState(""); const [city, setCity] = useState(""); const [state, setState] = useState("");
  const list = useQuery({ queryKey: ["settings-units"], queryFn: async () => (await supabase.from("units").select("id, name, slug, city, state, timezone, active").order("name")).data as Unit[] });

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) return m.err("Informe nome e endereço (slug) da unidade.");
    const { data: org } = await supabase.from("organizations").select("id").single();
    const { error } = await supabase.from("units").insert({ org_id: org?.id, name: name.trim(), slug: slug.trim().toLowerCase(), city: city || null, state: state || null });
    if (error) return m.err(errText(error));
    m.ok("Unidade criada."); setName(""); setSlug(""); setCity(""); setState("");
    void qc.invalidateQueries({ queryKey: ["settings-units"] });
  };
  const update = async (u: Unit, patch: Partial<Unit>) => {
    const { error } = await supabase.from("units").update(patch).eq("id", u.id);
    if (error) return m.err(errText(error));
    void qc.invalidateQueries({ queryKey: ["settings-units"] });
  };

  return (
    <div>
      <Msg m={msg} />
      <form onSubmit={create} className="grid gap-3 sm:grid-cols-5 items-end mb-4" noValidate>
        <div className="sm:col-span-2"><label htmlFor="un-name" className="block text-xs mb-1">Nome</label><input id="un-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Sede — São Paulo" /></div>
        <div><label htmlFor="un-slug" className="block text-xs mb-1">Endereço (slug)</label><input id="un-slug" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="sao-paulo" /></div>
        <div><label htmlFor="un-city" className="block text-xs mb-1">Cidade</label><input id="un-city" value={city} onChange={(e) => setCity(e.target.value)} /></div>
        <div><label htmlFor="un-state" className="block text-xs mb-1">UF</label><input id="un-state" value={state} onChange={(e) => setState(e.target.value)} maxLength={2} /></div>
        <button className={btnGhost + " sm:col-span-5 w-fit"}>Criar unidade</button>
      </form>
      <State loading={list.isLoading} error={list.error} empty={list.data?.length === 0} emptyText="Nenhuma unidade cadastrada." />
      {list.data && list.data.length > 0 && (
        <Table head={["Nome", "Cidade/UF", "Fuso", "Estado", ""]}>
          {list.data.map((u) => (
            <tr key={u.id}>
              <Td><input defaultValue={u.name} onBlur={(e) => e.target.value.trim() && e.target.value !== u.name && update(u, { name: e.target.value.trim() })} aria-label={`Nome de ${u.name}`} /></Td>
              <Td>
                <div className="flex gap-1">
                  <input defaultValue={u.city ?? ""} placeholder="Cidade" className="w-24" onBlur={(e) => e.target.value !== (u.city ?? "") && update(u, { city: e.target.value || null })} aria-label={`Cidade de ${u.name}`} />
                  <input defaultValue={u.state ?? ""} placeholder="UF" maxLength={2} className="w-14" onBlur={(e) => e.target.value !== (u.state ?? "") && update(u, { state: e.target.value || null })} aria-label={`UF de ${u.name}`} />
                </div>
              </Td>
              <Td>{u.timezone}</Td>
              <Td>{u.active ? "Ativa" : "Inativa"}</Td>
              <Td><button className={btnGhost + " hp-btn-sm"} onClick={() => update(u, { active: !u.active })}>{u.active ? "Desativar" : "Ativar"}</button></Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
};

interface WaNumber { id: string; journey: "atendimento" | "parceria"; unit_id: string | null; phone: string; active: boolean }

const QuizWhatsAppSettings = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg();
  const [journey, setJourney] = useState<"atendimento" | "parceria">("atendimento"); const [unit, setUnit] = useState(""); const [phone, setPhone] = useState("");
  const units = useQuery({ queryKey: ["settings-units-2"], queryFn: async () => (await supabase.from("units").select("id, name").eq("active", true).order("name")).data ?? [] });
  const list = useQuery({ queryKey: ["quiz-wa-numbers"], queryFn: async () => (await supabase.from("quiz_whatsapp_numbers").select("id, journey, unit_id, phone, active").order("journey")).data as WaNumber[] });
  const unitName = (id: string | null) => (id ? units.data?.find((u) => u.id === id)?.name ?? "—" : "Padrão da organização (todas as unidades)");

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) return m.err("Informe o número completo, com DDI e DDD (ex.: 5511999998888).");
    const { data: org } = await supabase.from("organizations").select("id").single();
    const { error } = await supabase.from("quiz_whatsapp_numbers").insert({ org_id: org?.id, journey, unit_id: unit || null, phone: digits });
    if (error) return m.err(errText(error));
    m.ok("Número salvo."); setPhone("");
    void qc.invalidateQueries({ queryKey: ["quiz-wa-numbers"] });
  };
  const toggle = async (w: WaNumber) => {
    const { error } = await supabase.from("quiz_whatsapp_numbers").update({ active: !w.active }).eq("id", w.id);
    if (error) return m.err(errText(error));
    void qc.invalidateQueries({ queryKey: ["quiz-wa-numbers"] });
  };

  return (
    <div>
      <Msg m={msg} />
      <p className="text-xs text-muted-foreground mb-3">Número usado no botão "Continuar pelo WhatsApp" ao final dos quizzes de captação. Um registro sem unidade vale como padrão para todas as unidades; um registro com unidade tem prioridade sobre o padrão.</p>
      <form onSubmit={create} className="grid gap-3 sm:grid-cols-4 items-end mb-4" noValidate>
        <div><label htmlFor="wa-journey" className="block text-xs mb-1">Jornada</label>
          <select id="wa-journey" value={journey} onChange={(e) => setJourney(e.target.value as "atendimento" | "parceria")}><option value="atendimento">Atendimento</option><option value="parceria">Parceria</option></select></div>
        <div><label htmlFor="wa-unit" className="block text-xs mb-1">Unidade (opcional)</label>
          <select id="wa-unit" value={unit} onChange={(e) => setUnit(e.target.value)}><option value="">Padrão (todas)</option>{units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
        <div><label htmlFor="wa-phone" className="block text-xs mb-1">Número (com DDI e DDD)</label><input id="wa-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="5511999998888" /></div>
        <button className={btnGhost + " w-fit"}>Salvar número</button>
      </form>
      <State loading={list.isLoading} error={list.error} empty={list.data?.length === 0} emptyText="Nenhum número configurado — os quizzes concluem normalmente, mas o botão do WhatsApp não aparece." />
      {list.data && list.data.length > 0 && (
        <Table head={["Jornada", "Unidade", "Número", "Estado", ""]}>
          {list.data.map((w) => (
            <tr key={w.id}>
              <Td>{w.journey === "atendimento" ? "Atendimento" : "Parceria"}</Td>
              <Td>{unitName(w.unit_id)}</Td>
              <Td className="tabular">{w.phone}</Td>
              <Td>{w.active ? "Ativo" : "Inativo"}</Td>
              <Td><button className={btnGhost + " hp-btn-sm"} onClick={() => toggle(w)}>{w.active ? "Desativar" : "Ativar"}</button></Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
};

interface ServiceRow { id: string; name: string; duration_min: number; price_cents: number; active: boolean }
interface ProductRow { id: string; kind: string; name: string; price_cents: number; sessions_count: number | null; validity_days: number | null; active: boolean }
const PRODUCT_KIND: Record<string, string> = { service: "Serviço avulso", course: "Curso", mentoring: "Mentoria", package: "Pacote", plan: "Plano/assinatura" };

const OperationSettings = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg();
  const [sName, setSName] = useState(""); const [sDur, setSDur] = useState("50"); const [sPrice, setSPrice] = useState("");
  const [pKind, setPKind] = useState("package"); const [pName, setPName] = useState(""); const [pPrice, setPPrice] = useState(""); const [pSessions, setPSessions] = useState(""); const [pValidity, setPValidity] = useState(""); const [pService, setPService] = useState("");

  const services = useQuery({ queryKey: ["settings-services"], queryFn: async () => (await supabase.from("services").select("id, name, duration_min, price_cents, active").order("name")).data as ServiceRow[] });
  const products = useQuery({ queryKey: ["settings-products"], queryFn: async () => (await supabase.from("products").select("id, kind, name, price_cents, sessions_count, validity_days, active").order("name")).data as ProductRow[] });

  const createService = async (e: FormEvent) => {
    e.preventDefault();
    const dur = Number(sDur); const cents = parseCents(sPrice || "0,00");
    if (!sName.trim()) return m.err("Informe o nome do serviço.");
    if (!Number.isFinite(dur) || dur < 5 || dur > 480) return m.err("Duração deve ser entre 5 e 480 minutos.");
    if (cents == null) return m.err("Preço inválido.");
    const { data: org } = await supabase.from("organizations").select("id").single();
    const { error } = await supabase.from("services").insert({ org_id: org?.id, name: sName.trim(), duration_min: dur, price_cents: cents });
    if (error) return m.err(errText(error));
    m.ok("Serviço criado."); setSName(""); setSDur("50"); setSPrice("");
    void qc.invalidateQueries({ queryKey: ["settings-services"] });
  };
  const updateService = async (s: ServiceRow, patch: Partial<ServiceRow>) => {
    const { error } = await supabase.from("services").update(patch).eq("id", s.id);
    if (error) return m.err(errText(error));
    void qc.invalidateQueries({ queryKey: ["settings-services"] });
  };

  const createProduct = async (e: FormEvent) => {
    e.preventDefault();
    const cents = parseCents(pPrice || "0,00");
    if (!pName.trim()) return m.err("Informe o nome do produto/pacote.");
    if (cents == null) return m.err("Preço inválido.");
    const sessions = pSessions ? Number(pSessions) : null;
    const validity = pValidity ? Number(pValidity) : null;
    if (pSessions && (!Number.isFinite(sessions) || (sessions ?? 0) <= 0)) return m.err("Sessões inválidas.");
    if (pValidity && (!Number.isFinite(validity) || (validity ?? 0) <= 0)) return m.err("Validade inválida.");
    if (pKind === "package" && (!sessions || !pService)) return m.err("Pacote exige serviço vinculado e número de sessões.");
    const { data: org } = await supabase.from("organizations").select("id").single();
    const { error } = await supabase.from("products").insert({ org_id: org?.id, kind: pKind, name: pName.trim(), price_cents: cents, sessions_count: sessions, validity_days: validity, service_id: pKind === "package" ? pService : null });
    if (error) return m.err(errText(error));
    m.ok("Produto criado."); setPName(""); setPPrice(""); setPSessions(""); setPValidity(""); setPService("");
    void qc.invalidateQueries({ queryKey: ["settings-products"] });
  };
  const toggleProduct = async (p: ProductRow) => {
    const { error } = await supabase.from("products").update({ active: !p.active }).eq("id", p.id);
    if (error) return m.err(errText(error));
    void qc.invalidateQueries({ queryKey: ["settings-products"] });
  };

  return (
    <div>
      <Msg m={msg} />
      <h3 className="text-sm font-medium mb-2">Serviços (duração e preço do atendimento avulso)</h3>
      <form onSubmit={createService} className="grid gap-3 sm:grid-cols-4 items-end mb-4" noValidate>
        <div className="sm:col-span-2"><label htmlFor="sv-name" className="block text-xs mb-1">Nome</label><input id="sv-name" value={sName} onChange={(e) => setSName(e.target.value)} placeholder="Ex.: Avaliação fisioterapêutica" /></div>
        <div><label htmlFor="sv-dur" className="block text-xs mb-1">Duração (min)</label><input id="sv-dur" type="number" min={5} max={480} value={sDur} onChange={(e) => setSDur(e.target.value)} /></div>
        <div><label htmlFor="sv-price" className="block text-xs mb-1">Preço (R$)</label><input id="sv-price" inputMode="decimal" value={sPrice} onChange={(e) => setSPrice(e.target.value)} placeholder="0,00" /></div>
        <button className={btnGhost + " sm:col-span-4 w-fit"}>Criar serviço</button>
      </form>
      <State loading={services.isLoading} error={services.error} empty={services.data?.length === 0} emptyText="Nenhum serviço cadastrado." />
      {services.data && services.data.length > 0 && (
        <Table head={["Nome", "Duração", "Preço", "Estado", ""]}>
          {services.data.map((s) => (
            <tr key={s.id}>
              <Td><input defaultValue={s.name} onBlur={(e) => e.target.value.trim() && e.target.value !== s.name && updateService(s, { name: e.target.value.trim() })} aria-label={`Nome de ${s.name}`} /></Td>
              <Td><input type="number" min={5} max={480} className="w-16" defaultValue={s.duration_min} onBlur={(e) => { const v = Number(e.target.value); v && v !== s.duration_min && updateService(s, { duration_min: v }); }} aria-label={`Duração de ${s.name}`} /> min</Td>
              <Td><input className="w-24" defaultValue={brl(s.price_cents).replace("R$ ", "")} onBlur={(e) => { const c = parseCents(e.target.value); c != null && c !== s.price_cents && updateService(s, { price_cents: c }); }} aria-label={`Preço de ${s.name}`} /></Td>
              <Td>{s.active ? "Ativo" : "Inativo"}</Td>
              <Td><button className={btnGhost + " hp-btn-sm"} onClick={() => updateService(s, { active: !s.active })}>{s.active ? "Desativar" : "Ativar"}</button></Td>
            </tr>
          ))}
        </Table>
      )}

      <h3 className="text-sm font-medium mb-2 mt-6">Produtos e pacotes</h3>
      <form onSubmit={createProduct} className="grid gap-3 sm:grid-cols-6 items-end mb-4" noValidate>
        <div><label htmlFor="pr-kind" className="block text-xs mb-1">Tipo</label><select id="pr-kind" value={pKind} onChange={(e) => setPKind(e.target.value)}>{Object.entries(PRODUCT_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div className="sm:col-span-2"><label htmlFor="pr-name" className="block text-xs mb-1">Nome</label><input id="pr-name" value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Ex.: Pacote 10 sessões" /></div>
        <div><label htmlFor="pr-price" className="block text-xs mb-1">Preço (R$)</label><input id="pr-price" inputMode="decimal" value={pPrice} onChange={(e) => setPPrice(e.target.value)} placeholder="0,00" /></div>
        {pKind === "package" && (
          <div><label htmlFor="pr-svc" className="block text-xs mb-1">Serviço vinculado</label><select id="pr-svc" value={pService} onChange={(e) => setPService(e.target.value)}><option value="">Selecione…</option>{services.data?.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        )}
        <div><label htmlFor="pr-sess" className="block text-xs mb-1">Sessões {pKind === "package" ? "(obrigatório)" : "(pacote)"}</label><input id="pr-sess" type="number" min={1} value={pSessions} onChange={(e) => setPSessions(e.target.value)} /></div>
        <div><label htmlFor="pr-val" className="block text-xs mb-1">Validade (dias)</label><input id="pr-val" type="number" min={1} value={pValidity} onChange={(e) => setPValidity(e.target.value)} /></div>
        <button className={btnGhost + " sm:col-span-6 w-fit"}>Criar produto</button>
      </form>
      <p className="text-xs text-muted-foreground mb-3">Regras finas de consumo (falta consome sessão, prazo de cancelamento tardio) usam os valores padrão do sistema ao criar por aqui; para ajustá-las num produto específico, use o banco diretamente — essa tela cobre o que é preenchido com mais frequência.</p>
      <State loading={products.isLoading} error={products.error} empty={products.data?.length === 0} emptyText="Nenhum produto cadastrado." />
      {products.data && products.data.length > 0 && (
        <Table head={["Nome", "Tipo", "Preço", "Sessões", "Estado", ""]}>
          {products.data.map((p) => (
            <tr key={p.id}>
              <Td>{p.name}</Td><Td>{PRODUCT_KIND[p.kind] ?? p.kind}</Td><Td>{brl(p.price_cents)}</Td><Td>{p.sessions_count ?? "—"}</Td>
              <Td>{p.active ? "Ativo" : "Inativo"}</Td>
              <Td><button className={btnGhost + " hp-btn-sm"} onClick={() => toggleProduct(p)}>{p.active ? "Desativar" : "Ativar"}</button></Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
};

interface PipelineRow { id: string; name: string; kind: string; active: boolean }
interface StageRow { id: string; name: string; position: number; kind: string }
interface LossRow { id: string; name: string; active: boolean }
const PIPELINE_KIND: Record<string, string> = { patients: "Pacientes", education: "Educação", partners: "Parceiros", companies: "Empresas", custom: "Personalizado" };

const CrmSettings = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg();
  const [plName, setPlName] = useState(""); const [plKind, setPlKind] = useState("custom");
  const [selPipe, setSelPipe] = useState("");
  const [stName, setStName] = useState(""); const [stKind, setStKind] = useState("open");
  const [reasonName, setReasonName] = useState("");

  const pipelines = useQuery({ queryKey: ["settings-pipelines"], queryFn: async () => (await supabase.from("pipelines").select("id, name, kind, active").order("name")).data as PipelineRow[] });
  const stages = useQuery({ queryKey: ["settings-stages", selPipe], enabled: !!selPipe, queryFn: async () => (await supabase.from("pipeline_stages").select("id, name, position, kind").eq("pipeline_id", selPipe).order("position")).data as StageRow[] });
  const reasons = useQuery({ queryKey: ["settings-loss"], queryFn: async () => (await supabase.from("loss_reasons").select("id, name, active").order("name")).data as LossRow[] });

  const createPipeline = async (e: FormEvent) => {
    e.preventDefault(); if (!plName.trim()) return m.err("Informe o nome do funil.");
    const { data: org } = await supabase.from("organizations").select("id").single();
    const { error } = await supabase.from("pipelines").insert({ org_id: org?.id, name: plName.trim(), kind: plKind });
    if (error) return m.err(errText(error));
    m.ok("Funil criado."); setPlName(""); void qc.invalidateQueries({ queryKey: ["settings-pipelines"] });
  };
  const togglePipeline = async (p: PipelineRow) => {
    const { error } = await supabase.from("pipelines").update({ active: !p.active }).eq("id", p.id);
    if (error) return m.err(errText(error));
    void qc.invalidateQueries({ queryKey: ["settings-pipelines"] });
  };
  const createStage = async (e: FormEvent) => {
    e.preventDefault(); if (!selPipe) return m.err("Selecione um funil."); if (!stName.trim()) return m.err("Informe o nome da etapa.");
    const { data: org } = await supabase.from("organizations").select("id").single();
    const { error } = await supabase.from("pipeline_stages").insert({ org_id: org?.id, pipeline_id: selPipe, name: stName.trim(), kind: stKind, position: (stages.data?.length ?? 0) + 1 });
    if (error) return m.err(errText(error));
    m.ok("Etapa criada."); setStName(""); void qc.invalidateQueries({ queryKey: ["settings-stages", selPipe] });
  };
  const createReason = async (e: FormEvent) => {
    e.preventDefault(); if (!reasonName.trim()) return m.err("Informe o motivo.");
    const { data: org } = await supabase.from("organizations").select("id").single();
    const { error } = await supabase.from("loss_reasons").insert({ org_id: org?.id, name: reasonName.trim() });
    if (error) return m.err(errText(error));
    m.ok("Motivo criado."); setReasonName(""); void qc.invalidateQueries({ queryKey: ["settings-loss"] });
  };
  const toggleReason = async (r: LossRow) => {
    const { error } = await supabase.from("loss_reasons").update({ active: !r.active }).eq("id", r.id);
    if (error) return m.err(errText(error));
    void qc.invalidateQueries({ queryKey: ["settings-loss"] });
  };

  return (
    <div>
      <Msg m={msg} />
      <h3 className="text-sm font-medium mb-2">Funis</h3>
      <form onSubmit={createPipeline} className="grid gap-3 sm:grid-cols-4 items-end mb-4" noValidate>
        <div className="sm:col-span-2"><label htmlFor="pl-name" className="block text-xs mb-1">Nome</label><input id="pl-name" value={plName} onChange={(e) => setPlName(e.target.value)} placeholder="Ex.: Convênios" /></div>
        <div><label htmlFor="pl-kind" className="block text-xs mb-1">Tipo</label><select id="pl-kind" value={plKind} onChange={(e) => setPlKind(e.target.value)}>{Object.entries(PIPELINE_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <button className={btnGhost + " sm:col-span-4 w-fit"}>Criar funil</button>
      </form>
      <State loading={pipelines.isLoading} error={pipelines.error} empty={pipelines.data?.length === 0} emptyText="Nenhum funil cadastrado." />
      {pipelines.data && pipelines.data.length > 0 && (
        <Table head={["Nome", "Tipo", "Estado", "", ""]}>
          {pipelines.data.map((p) => (
            <tr key={p.id}>
              <Td>{p.name}</Td><Td>{PIPELINE_KIND[p.kind] ?? p.kind}</Td><Td>{p.active ? "Ativo" : "Inativo"}</Td>
              <Td><button className={btnGhost + " hp-btn-sm"} onClick={() => setSelPipe(selPipe === p.id ? "" : p.id)}>{selPipe === p.id ? "Fechar etapas" : "Ver etapas"}</button></Td>
              <Td><button className={btnGhost + " hp-btn-sm"} onClick={() => togglePipeline(p)}>{p.active ? "Desativar" : "Ativar"}</button></Td>
            </tr>
          ))}
        </Table>
      )}

      {selPipe && (
        <div className="mt-4 border-t border-border pt-4">
          <h4 className="text-sm font-medium mb-2">Etapas — {pipelines.data?.find((p) => p.id === selPipe)?.name}</h4>
          <form onSubmit={createStage} className="grid gap-3 sm:grid-cols-4 items-end mb-3" noValidate>
            <div className="sm:col-span-2"><label htmlFor="st-name" className="block text-xs mb-1">Nome da etapa</label><input id="st-name" value={stName} onChange={(e) => setStName(e.target.value)} placeholder="Ex.: Proposta enviada" /></div>
            <div><label htmlFor="st-kind" className="block text-xs mb-1">Tipo</label><select id="st-kind" value={stKind} onChange={(e) => setStKind(e.target.value)}><option value="open">Em andamento</option><option value="won">Ganha</option><option value="lost">Perdida</option></select></div>
            <button className={btnGhost + " w-fit"}>Adicionar etapa</button>
          </form>
          <State loading={stages.isLoading} error={stages.error} empty={stages.data?.length === 0} emptyText="Nenhuma etapa cadastrada." />
          {stages.data && stages.data.length > 0 && (
            <Table head={["#", "Nome", "Tipo"]}>
              {stages.data.map((s) => <tr key={s.id}><Td>{s.position}</Td><Td>{s.name}</Td><Td>{s.kind === "won" ? "Ganha" : s.kind === "lost" ? "Perdida" : "Em andamento"}</Td></tr>)}
            </Table>
          )}
        </div>
      )}

      <h3 className="text-sm font-medium mb-2 mt-6">Motivos de perda</h3>
      <form onSubmit={createReason} className="grid gap-3 sm:grid-cols-4 items-end mb-4" noValidate>
        <div className="sm:col-span-3"><label htmlFor="rs-name" className="block text-xs mb-1">Motivo</label><input id="rs-name" value={reasonName} onChange={(e) => setReasonName(e.target.value)} placeholder="Ex.: Preço" /></div>
        <button className={btnGhost + " w-fit"}>Adicionar motivo</button>
      </form>
      <State loading={reasons.isLoading} error={reasons.error} empty={reasons.data?.length === 0} emptyText="Nenhum motivo cadastrado." />
      {reasons.data && reasons.data.length > 0 && (
        <Table head={["Motivo", "Estado", ""]}>
          {reasons.data.map((r) => <tr key={r.id}><Td>{r.name}</Td><Td>{r.active ? "Ativo" : "Inativo"}</Td><Td><button className={btnGhost + " hp-btn-sm"} onClick={() => toggleReason(r)}>{r.active ? "Desativar" : "Ativar"}</button></Td></tr>)}
        </Table>
      )}
    </div>
  );
};

export default SettingsHub;
