import { Link } from "react-router-dom";
import { useOrg } from "@/org/OrgProvider";
import { Badge, PageHead } from "@/lib/ui";

/** Prospecção B2B — Fase 1: casca do aplicativo (módulo, rota, permissão e menu). NENHUMA tela mostra número, empresa, contato ou saldo inventado:
 *  cada uma diz com clareza o que ainda não existe e em que fase chega. A autorização real é do banco (RLS/funções) — esconder ou mostrar aqui é só visual. */
export type ProspeccaoKey = "visao-geral" | "nova-pesquisa" | "pesquisas" | "empresas" | "decisores" | "oportunidades" | "creditos" | "exportacoes" | "configuracoes";

interface Info { title: string; hint: string; phase: string; will: string[] }
const PROSPECCAO_INFO: Record<ProspeccaoKey, Info> = {
  "visao-geral": { title: "Visão geral", hint: "Saldo de créditos, pesquisas recentes e empresas liberadas.", phase: "Fase 4–5", will: ["Saldo, reservas e consumo de créditos", "Pesquisas recentes e empresas liberadas no período", "Taxa de enriquecimento e empresas enviadas ao CRM"] },
  "nova-pesquisa": { title: "Nova pesquisa", hint: "Filtros por atividade, cidade e porte, com prévia gratuita da quantidade.", phase: "Fase 3", will: ["Filtros combináveis (localização, atividade/CNAE, características da empresa, contatos, decisores)", "Prévia gratuita: confirmado × estimado × não verificado", "Resumo antes de liberar: novas × já adquiridas × custo em créditos"] },
  pesquisas: { title: "Minhas pesquisas", hint: "Pesquisas salvas para repetir, duplicar e comparar.", phase: "Fase 3", will: ["Salvar, duplicar e reexecutar pesquisas", "Ver a variação de resultados entre atualizações da base"] },
  empresas: { title: "Empresas adquiridas", hint: "Empresas já liberadas, com dados oficiais e origem.", phase: "Fase 5", will: ["Tabela das empresas liberadas (nunca cobradas duas vezes pelo mesmo CNPJ)", "Painel da empresa: dados oficiais, decisores, contatos, presença digital e CRM", "Adicionar ao CRM em massa"] },
  decisores: { title: "Decisores e contatos", hint: "Sócios e administradores, e contatos com fonte, data e confiança.", phase: "Fase 6", will: ["Sócios e administradores do QSA com potencial de decisão (regra transparente)", "Contatos classificados: telefone cadastral, WhatsApp confirmado, e-mail geral, e-mail verificado", "Cada contato com fonte, data, método, confiança e status"] },
  oportunidades: { title: "Oportunidades digitais", hint: "Pesquisas prontas, como empresas sem site confirmado ou recém-abertas.", phase: "Fase 6", will: ["Empresas sem site CONFIRMADO (site não encontrado ≠ ausência confirmada)", "Recém-abertas e telefone sem domínio identificado"] },
  creditos: { title: "Créditos", hint: "Carteira de créditos da organização: saldo, extrato e compra de pacotes.", phase: "Fase 4 (carteira) e 8 (pagamentos)", will: ["Saldo disponível, reservado e consumido, com extrato por lançamento", "Compra de pacotes por PIX/cartão só depois de confirmação do pagamento no servidor"] },
  exportacoes: { title: "Exportações", hint: "Arquivos gerados em segundo plano, com histórico e expiração.", phase: "Fase 5", will: ["Exportação assíncrona das empresas adquiridas", "Histórico, link com validade curta e registro de auditoria"] },
  configuracoes: { title: "Configurações do aplicativo", hint: "Regras de aquisição, validade e limites.", phase: "Fase 5", will: ["Política de novo enriquecimento e validade da aquisição", "Limites e provedores habilitados"] },
};

const ProspeccaoPage = ({ page }: { page: ProspeccaoKey }) => {
  const { moduleOn } = useOrg();
  const info = PROSPECCAO_INFO[page];
  if (!moduleOn("prospeccao_b2b")) {
    return (
      <div data-testid="prospeccao-bloqueado">
        <PageHead eyebrow="Prospecção B2B" title="Aplicativo não habilitado" hint="Este aplicativo não está habilitado para a sua organização." />
        <div className="hp-card p-5 text-sm">A habilitação é feita pela administração da plataforma. Fale com quem gerencia a sua conta. <Link className="underline" to="/admin">Voltar ao Hub</Link></div>
      </div>
    );
  }
  return (
    <div data-testid={`prospeccao-${page}`}>
      <PageHead eyebrow="Prospecção B2B" title={info.title} hint={info.hint} actions={<Badge tone="warning">Em construção</Badge>} />
      <section className="hp-card p-5" aria-label="Situação desta tela">
        <p className="text-sm font-semibold">Esta tela ainda não está disponível.</p>
        <p className="text-[13px] text-muted-foreground mt-1">Ela será entregue na <b>{info.phase}</b>, depois da aprovação de cada etapa. Nenhum número, empresa, contato ou saldo é exibido enquanto não existir o dado real.</p>
        <p className="text-[13px] font-semibold mt-4">O que chega aqui:</p>
        <ul className="list-disc pl-5 mt-1 text-[13px] text-muted-foreground space-y-1">{info.will.map((w) => <li key={w}>{w}</li>)}</ul>
      </section>
    </div>
  );
};
export default ProspeccaoPage;
