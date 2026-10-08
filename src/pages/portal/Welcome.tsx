import { Link, useNavigate } from "react-router-dom";
import { BarChart3, CalendarDays, CheckCircle2, Eye, GraduationCap, Handshake, HeartPulse, KeyRound, LayoutDashboard, LineChart, Lock, PlayCircle, Settings, Sunrise, Target, Users, Wallet, type LucideIcon } from "lucide-react";
import { useAuth, type AppRole } from "@/auth/AuthProvider";
import { useMyAccount } from "@/components/hp/useMyAccount";
import { ROLE_LABEL } from "@/components/hp/nav";
import { homeFor, markTourSeen } from "@/lib/tour";
import PortalShell from "./PortalShell";

interface Tip { icon: LucideIcon; title: string; text: string; to?: string; cta?: string }
interface Group { role: AppRole; heading: string; intro: string; tips: Tip[] }

const GROUPS: Group[] = [
  { role: "physio", heading: "Para você, fisioterapeuta", intro: "Tudo o que você precisa para atender e acompanhar seus pacientes está no painel.", tips: [
    { icon: CalendarDays, title: "Sua agenda", text: "Veja os atendimentos do dia e da semana, confirme presença, marque como realizado, falta ou remarcado. Cada mudança fica registrada.", to: "/admin/agenda", cta: "Abrir a agenda" },
    { icon: Sunrise, title: "Meu dia", text: "Suas tarefas, seu calendário e a conexão com o Google Agenda para ver os atendimentos junto com os seus compromissos.", to: "/admin/meu-dia", cta: "Abrir Meu dia" },
    { icon: HeartPulse, title: "Acompanhamento dos pacientes", text: "Somente os pacientes vinculados a você. Registre avaliações (dor, funcionalidade, bem-estar), libere conteúdos e acompanhe a evolução.", to: "/admin/acompanhamento", cta: "Ver meus pacientes" },
    { icon: BarChart3, title: "Meu resumo", text: "Quantos atendimentos você realizou, faltas e cancelamentos, pacientes atendidos e repasses do período.", to: "/admin/meu-resumo", cta: "Ver meu resumo" },
    { icon: KeyRound, title: "Disponibilidade", text: "A sua grade semanal de horários define quando os pacientes podem ser agendados com você. Em caso de dúvida, fale com a gestão.", to: "/admin/agenda", cta: "Ver a agenda" },
  ] },
  { role: "member", heading: "Para você, paciente", intro: "Aqui você acompanha o seu tratamento do começo ao fim, sem depender de ligação.", tips: [
    { icon: Target, title: "Suas sessões", text: "Veja quantas sessões o seu pacote tem, quantas você já fez e quantas ainda faltam, com a validade do pacote.", to: "/paciente", cta: "Ver minhas sessões" },
    { icon: LineChart, title: "Sua evolução", text: "O gráfico mostra a sua dor, a sua funcionalidade e o seu bem-estar ao longo do tempo. Você também pode registrar como está se sentindo.", to: "/paciente", cta: "Ver minha evolução" },
    { icon: CalendarDays, title: "Seus atendimentos", text: "Veja os próximos horários, confirme presença, remarque ou cancele pelo próprio sistema (respeitando os prazos combinados).", to: "/paciente", cta: "Ver meus horários" },
    { icon: PlayCircle, title: "Metas e exercícios", text: "As metas definidas com o seu fisioterapeuta e os vídeos de exercícios liberados para você ficam reunidos aqui.", to: "/paciente", cta: "Abrir" },
    { icon: GraduationCap, title: "Academy", text: "Se você tem cursos ou conteúdos liberados, eles aparecem no menu Academy.", to: "/academy", cta: "Abrir a Academy" },
  ] },
  { role: "partner", heading: "Para você, parceiro(a)", intro: "Acompanhe as suas indicações e os repasses.", tips: [
    { icon: Handshake, title: "Portal do parceiro", text: "Suas indicações, o andamento de cada uma e os repasses ficam no seu portal.", to: "/parceiro", cta: "Abrir o portal" },
  ] },
  { role: "sales", heading: "Para você, do comercial", intro: "Leads, funil e metas.", tips: [
    { icon: Users, title: "CRM", text: "Os seus leads e oportunidades em funis separados por tipo (paciente, fisioterapeuta, Academy e empresa), com tarefas e metas.", to: "/admin/crm", cta: "Abrir o CRM" },
  ] },
  { role: "finance", heading: "Para você, do financeiro", intro: "Vendas, caixa e conciliação.", tips: [
    { icon: Wallet, title: "Financeiro", text: "Contas a receber e a pagar, fluxo de caixa, conciliação bancária e comissões.", to: "/admin/financeiro", cta: "Abrir o Financeiro" },
  ] },
  { role: "teacher", heading: "Para você, professor(a)/mentor(a)", intro: "Cursos e alunos.", tips: [
    { icon: GraduationCap, title: "Academy", text: "Gerencie cursos, aulas e acompanhe o progresso dos alunos.", to: "/admin/academy", cta: "Abrir a Academy" },
  ] },
  { role: "unit_manager", heading: "Para você, gestor(a) de unidade", intro: "A operação da sua unidade.", tips: [
    { icon: LayoutDashboard, title: "Painel", text: "Indicadores, agenda e equipe da sua unidade.", to: "/admin", cta: "Abrir o painel" },
  ] },
];

const Tutorial = ({ g }: { g: Group }) => (
  <section className="mb-8" aria-labelledby={`tour-${g.role}`} data-testid={`tutorial-${g.role}`}>
    <h2 id={`tour-${g.role}`} className="text-lg font-semibold text-foreground">{g.heading}</h2>
    <p className="text-[13.5px] text-muted-foreground mt-1 mb-4 max-w-2xl">{g.intro}</p>
    <ol className="grid gap-3 sm:grid-cols-2">
      {g.tips.map((t, i) => (
        <li key={t.title} className="card-hp !p-4 flex gap-3">
          <span className="grid place-items-center h-9 w-9 shrink-0 rounded-lg bg-primary/10 text-primary"><t.icon size={18} aria-hidden /></span>
          <div className="min-w-0">
            <p className="font-medium text-foreground"><span className="text-muted-foreground mr-1.5">{i + 1}.</span>{t.title}</p>
            <p className="text-[13px] text-muted-foreground mt-0.5">{t.text}</p>
            {t.to && <Link to={t.to} className="text-[13px] font-medium text-accent hover:underline mt-1.5 inline-block">{t.cta ?? "Abrir"} →</Link>}
          </div>
        </li>))}
    </ol>
  </section>
);

/** Tutorial do sistema por perfil: só o que a pessoa de fato acessa. Abre sozinho no primeiro login (exceto gestão) e fica disponível em "Tutorial". */
const Welcome = () => {
  const { user, roles, hasRole } = useAuth(); const nav = useNavigate(); const account = useMyAccount();
  const mine = GROUPS.filter((g) => hasRole(g.role));
  const isManager = hasRole("manager", "ops_admin");
  const name = (account.data?.display_name ?? "").trim().split(" ")[0];
  const start = () => { if (user) markTourSeen(user.id); nav(homeFor(hasRole), { replace: true }); };
  return (
    <PortalShell title={`Bem-vindo(a)${name ? `, ${name}` : ""}!`} subtitle={`Seu perfil: ${[...new Set(roles.map((r) => ROLE_LABEL[r.role]))].join(", ") || "—"}. Este é um passo a passo do que você acessa no sistema.`}
      actions={<button className="hp-btn hp-btn-primary" onClick={start} data-testid="tutorial-comecar">Começar a usar o sistema</button>}>
      <section className="card-hp !p-4 mb-8 flex gap-3" data-testid="tutorial-como-funciona">
        <span className="grid place-items-center h-9 w-9 shrink-0 rounded-lg bg-success/10 text-success"><CheckCircle2 size={18} aria-hidden /></span>
        <div><p className="font-medium text-foreground">Como funciona</p>
          <p className="text-[13px] text-muted-foreground mt-0.5">Você entra com o seu e-mail e a sua senha. O menu à esquerda (ou o ícone de menu no celular) mostra só as áreas liberadas para o seu perfil, e o menu do seu nome, no canto superior, leva às Configurações da conta (nome, dados e senha) e ao botão Sair.</p></div>
      </section>
      {mine.map((g) => <Tutorial key={g.role} g={g} />)}
      {isManager && (
        <section className="mb-8" data-testid="tutorial-gestao">
          <h2 className="text-lg font-semibold text-foreground">Para você, da gestão</h2>
          <p className="text-[13.5px] text-muted-foreground mt-1 mb-4 max-w-2xl">Você enxerga toda a operação. Cada aplicativo tem o seu menu: Gestão, Financeiro, CRM, Pages, Operação, Academy, Parceiros e Produtividade.</p>
          <Link to="/admin" className="hp-btn hp-btn-outline"><LayoutDashboard size={14} aria-hidden className="mr-1.5" />Abrir o painel</Link>
        </section>)}
      <section className="card-hp !p-4 mb-8 flex gap-3" data-testid="tutorial-privacidade">
        <span className="grid place-items-center h-9 w-9 shrink-0 rounded-lg bg-muted text-foreground">{isManager ? <Eye size={18} aria-hidden /> : <Lock size={18} aria-hidden />}</span>
        <div><p className="font-medium text-foreground">{isManager ? "Dados sensíveis" : "Privacidade"}</p>
          <p className="text-[13px] text-muted-foreground mt-0.5 max-w-3xl">
            {isManager
              ? "Como gestor, você vê documentos (CPF/CNPJ), dados de pagamento e informações financeiras. Esses dados ficam ocultos para os demais perfis."
              : hasRole("member")
                ? "Seus dados pessoais e de saúde só aparecem para você e para a equipe autorizada do atendimento. Nenhum outro paciente vê as suas informações."
                : "Por segurança, você NÃO vê dados sensíveis de outras pessoas: documentos (CPF/CNPJ), dados de pagamento e informações financeiras ficam restritos à gestão. Dos pacientes, você acessa apenas os que estão vinculados a você."}
          </p></div>
      </section>
      <div className="flex flex-wrap gap-3">
        <button className="hp-btn hp-btn-primary" onClick={start}>Começar a usar o sistema</button>
        {hasRole("manager", "ops_admin", "unit_manager", "sales", "finance", "physio", "teacher") && <Link to="/admin/conta" className="hp-btn hp-btn-outline"><Settings size={14} aria-hidden className="mr-1.5" />Configurações da conta</Link>}
      </div>
    </PortalShell>
  );
};

export default Welcome;
