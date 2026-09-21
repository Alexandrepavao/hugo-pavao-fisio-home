// Estado real dos módulos. Atualizar junto com docs/project-status.md.
type Status = "concluido" | "parcial" | "nao_iniciado";

const MODULES: { name: string; status: Status; note: string }[] = [
  { name: "Autenticação e convites", status: "parcial", note: "Login, recuperação e nova senha prontos; envio de convites por função de servidor pendente." },
  { name: "Permissões (RLS)", status: "parcial", note: "Base de organização/unidade/pessoas testada; demais módulos herdam o padrão." },
  { name: "HP Core — Pessoas", status: "parcial", note: "Cadastro, busca e detecção de duplicidade. Mesclagem, importação e tags pendentes." },
  { name: "Auditoria", status: "parcial", note: "Registro em banco ativo; tela de consulta básica." },
  { name: "HP Pages (landing pages)", status: "nao_iniciado", note: "Editor por blocos, formulários e métricas." },
  { name: "HP CRM", status: "nao_iniciado", note: "Funis, oportunidades e tarefas." },
  { name: "Agenda e operação", status: "nao_iniciado", note: "Agenda, pacotes e sessões." },
  { name: "HP Finance", status: "nao_iniciado", note: "Recebíveis, pagamentos e projeção mensal." },
  { name: "HP Academy", status: "nao_iniciado", note: "Cursos, pacientes e comunidades." },
  { name: "Portal de parceiros", status: "nao_iniciado", note: "Inscrição, encaminhamentos e repasses." },
  { name: "Dashboard do gestor", status: "nao_iniciado", note: "Indicadores só serão exibidos com dados reais." },
];

const LABEL: Record<Status, string> = { concluido: "Concluído", parcial: "Parcial", nao_iniciado: "Não iniciado" };
const STYLE: Record<Status, string> = {
  concluido: "bg-primary text-primary-foreground",
  parcial: "bg-accent/15 text-accent border border-accent/40",
  nao_iniciado: "bg-muted text-navy-400",
};

const Overview = () => (
  <div>
    <p className="eyebrow mb-2">Painel</p>
    <h1 className="text-3xl text-navy-900 mb-2">Visão geral</h1>
    <p className="text-navy-400 mb-8 max-w-2xl">
      Estado real de cada módulo do HP Group Hub. Nenhum indicador aparece aqui até existir dado real para calculá-lo.
    </p>
    <ul className="grid gap-3 sm:grid-cols-2">
      {MODULES.map((m) => (
        <li key={m.name} className="bg-card border border-border p-5">
          <div className="flex items-start justify-between gap-3 mb-2">
            <h2 className="text-lg text-navy-900">{m.name}</h2>
            <span className={`text-[11px] uppercase tracking-wider px-2 py-1 shrink-0 ${STYLE[m.status]}`}>{LABEL[m.status]}</span>
          </div>
          <p className="text-[14px] text-navy-400 leading-snug">{m.note}</p>
        </li>
      ))}
    </ul>
  </div>
);

export default Overview;
