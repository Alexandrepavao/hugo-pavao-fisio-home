import { Link } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";

// Estado real dos módulos. Manter alinhado com docs/project-status.md.
// "Funcional (dev)" = implementado e validado no ambiente Dev (banco testado por SQL; telas verificadas). NÃO significa validado em produção.
type Status = "funcional" | "parcial" | "pendente";

const MODULES: { name: string; status: Status; note: string; to?: string }[] = [
  { name: "Autenticação, convites e permissões", status: "parcial", note: "Login, primeiro acesso, recuperação e RLS testados. Envio real de e-mail (Resend/SMTP) ainda NÃO validado.", to: "/admin/equipe" },
  { name: "HP Core — Pessoas", status: "parcial", note: "Cadastro, duplicidade, exportação CSV e convite ao portal. Mesclagem de pessoas e importação com validação pendentes.", to: "/admin/pessoas" },
  { name: "HP Pages e formulários", status: "funcional", note: "Editor por blocos, versões, publicação/agendamento/desativação, formulário → pessoa + oportunidade. Preview social (SEO no servidor) pendente.", to: "/admin/paginas" },
  { name: "HP CRM", status: "funcional", note: "Funis, kanban/lista, tarefas, notas, motivos de perda, distribuição. Regras avançadas de distribuição e importação pendentes.", to: "/admin/crm" },
  { name: "Agenda e pacotes", status: "funcional", note: "Sem sobreposição no banco, remarcação atômica, consumo de sessões com regras. Fila de espera ainda é manual.", to: "/admin/agenda" },
  { name: "HP Finance", status: "parcial", note: "Vendas, parcelas, recebimentos parciais/estornos, contas a pagar, comissões, projeção. Conciliação bancária e regras de comissão (tela) pendentes.", to: "/admin/financeiro" },
  { name: "HP Academy", status: "funcional", note: "Cursos, acesso com validade/revogação, progresso, avaliações, certificados, comunidade. Vídeo de provedor externo com assinatura ainda não definido.", to: "/admin/academy" },
  { name: "Acompanhamento de pacientes", status: "funcional", note: "Vínculo assistencial revogável, conteúdos liberados por profissional, registro de atividade, canal de dúvidas.", to: "/admin/acompanhamento" },
  { name: "Parceiros e relacionamento", status: "parcial", note: "Aprovação via funil, indicações rastreáveis, repasses, pesquisas (banco). Telas de pesquisa e corporativo pendentes.", to: "/admin/parceiros" },
  { name: "Dashboard do gestor", status: "funcional", note: "Indicadores e alertas calculados no banco; 'Indisponível' sem dados de origem. Custo de aquisição/ROI: indisponível (sem dados de mídia).", to: "/admin" },
  { name: "Automações (eventos)", status: "parcial", note: "Eventos idempotentes com histórico e retentativa manual. Agendador automático de retentativas e webhooks de pagamento pendentes." },
  { name: "Integrações externas", status: "pendente", note: "Pagamentos, WhatsApp, e-mail (Resend), vídeo privado de provedor: nenhuma conectada." },
];

const LABEL: Record<Status, string> = { funcional: "Funcional (Dev)", parcial: "Parcial", pendente: "Pendente" };
const STYLE: Record<Status, string> = {
  funcional: "bg-primary text-primary-foreground",
  parcial: "bg-accent/15 text-accent border border-accent/40",
  pendente: "bg-muted text-navy-400",
};

const Overview = () => {
  const { hasRole } = useAuth();
  return (
    <div>
      <p className="eyebrow mb-2">Painel</p>
      <h1 className="text-3xl text-navy-900 mb-2">Estado dos módulos</h1>
      <p className="text-navy-400 mb-8 max-w-2xl">
        “Funcional (Dev)” significa implementado e validado no ambiente de desenvolvimento — <strong>não</strong> validado em produção com dados reais.
        {!hasRole("manager", "ops_admin", "unit_manager") && " Use o menu à esquerda para acessar as áreas do seu perfil."}
      </p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {MODULES.map((m) => (
          <li key={m.name} className="bg-card border border-border p-5">
            <div className="flex items-start justify-between gap-3 mb-2">
              <h2 className="text-lg text-navy-900">{m.to ? <Link to={m.to} className="hover:underline">{m.name}</Link> : m.name}</h2>
              <span className={`text-[11px] uppercase tracking-wider px-2 py-1 shrink-0 ${STYLE[m.status]}`}>{LABEL[m.status]}</span>
            </div>
            <p className="text-[14px] text-navy-400 leading-snug">{m.note}</p>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default Overview;
