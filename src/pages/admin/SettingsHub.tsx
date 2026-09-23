import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
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
  { key: "operacao", title: "Operação", description: "Disponibilidade, duração dos atendimentos, intervalos, cancelamentos e regras de pacotes.", status: "pending", pendingNote: "Esses dados já existem no banco (disponibilidade, serviços/pacotes), mas cada um é editado no ponto de uso (Agenda, Financeiro › Configurações) — ainda não há uma tela única que reúna todos como parâmetro de configuração. Reunir isso aqui exigiria uma tela nova, fora do escopo desta etapa." },
  { key: "crm", title: "Comercial e CRM", description: "Funis, etapas, origens, responsáveis e regras de distribuição.", status: "pending", pendingNote: "Funis e etapas existem no banco (semeados na fundação do sistema) e a distribuição de responsável já funciona (private.pick_owner), mas não há tela para criar/editar funil, etapa ou origem — hoje isso só é feito por migration. Precisa de uma tela de administração de funil nova." },
  { key: "captacao", title: "Captação", description: "Número de WhatsApp por jornada (avaliação/parceria) e, quando aplicável, por unidade.", status: "ready" },
  { key: "financeiro", title: "Financeiro", description: "Contas financeiras, categorias, classificação DRE e centros de custo — mesma tela acessada pelo header de Financeiro.", status: "link", linkTo: "/admin/financeiro/config", linkLabel: "Abrir Financeiro › Configurações" },
  { key: "academy", title: "Academy", description: "Configurações de turmas, liberação de conteúdo e critérios de conclusão.", status: "pending", pendingNote: "Cursos, trilhas e liberação de acesso já são gerenciados em Academy (matrículas/entitlements), mas não há parâmetros globais separados (ex.: critério padrão de conclusão) — cada curso já define isso individualmente na própria tela do curso. Nenhuma configuração adicional identificada para centralizar aqui hoje." },
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

export default SettingsHub;
