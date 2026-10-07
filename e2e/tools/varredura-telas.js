// Varredura de telas SEM código novo no app: cole no console do navegador (ou use javascript_tool no painel do Claude) JÁ LOGADO em /admin.
// Navega por todas as rotas dos apps (navegação do próprio app, sem recarregar) e devolve, por rota: título, redirecionamento, textos de erro e falhas de rede/console.
//   await window.__crawl(['/admin', '/admin/crm', ...])   // ver ROTAS abaixo
// Só prova que a tela abre sem erro; a regra de negócio entre apps é provada por supabase/tests/release (SQL) e e2e/release (E2E) e por supabase/tests/integracao/auditoria-integracao.sql.
(() => {
  const st = { errs: [], inflight: 0 };
  const of = window.fetch;
  window.fetch = async (...a) => {
    st.inflight++; const u = String(a[0]?.url ?? a[0]);
    try {
      const r = await of(...a);
      if (r.status >= 400 && /supabase\.co/.test(u)) { let t = ''; try { t = (await r.clone().text()).slice(0, 140); } catch { /* corpo ilegível */ } st.errs.push(`HTTP ${r.status} ${u.replace(/^https:\/\/[^/]+/, '').slice(0, 80)} ${t}`); }
      return r;
    } catch (e) { st.errs.push('fetch falhou ' + u.slice(0, 80)); throw e; } finally { st.inflight--; }
  };
  const oe = console.error; console.error = (...a) => { st.errs.push('console.error ' + a.map(String).join(' ').slice(0, 160)); oe(...a); };
  addEventListener('error', (e) => st.errs.push('onerror ' + e.message));
  addEventListener('unhandledrejection', (e) => st.errs.push('rejeição ' + String(e.reason?.message ?? e.reason).slice(0, 140)));
  window.__crawl = async (routes) => {
    const out = [];
    for (const r of routes) {
      st.errs = []; history.pushState(null, '', r); dispatchEvent(new PopStateEvent('popstate'));
      const t0 = Date.now(); let quiet = 0;
      while (Date.now() - t0 < 9000) { await new Promise((x) => setTimeout(x, 250)); quiet = st.inflight === 0 ? quiet + 250 : 0; if (quiet >= 900 && Date.now() - t0 > 1200) break; }
      const txt = document.body.innerText; const h = (document.querySelector('main h1, h1') || {}).innerText || '';
      const bad = ['Sem permissão', 'Algo deu errado', 'Something went wrong', 'Erro inesperado', 'não encontrada', '404'].filter((k) => txt.includes(k));
      out.push({ rota: r, final: location.pathname + location.search, h1: h.replace(/\n/g, ' ').slice(0, 50), bad, errs: [...new Set(st.errs)].slice(0, 4) });
    }
    return out;
  };
})();
// ROTAS (gestor): /admin /admin/adm /admin/adm/pendencias /admin/adm/diretorio /admin/pessoas /admin/equipe /admin/configuracoes /admin/auditoria /admin/status
// /admin/financeiro[/vendas|/pagar|/cartoes|/fluxo-caixa|/conciliacao|/recorrencia|/dre|/comissoes|/relatorios|/config] /admin/contas-corporativas
// /admin/crm[/leads|/contatos|/listas|/oportunidades|/tarefas|/metas|/metas/ritmo|/metas/time|/conversas|/mensagens-agendadas|/relatorios|/relatorios/desempenho]
// /admin/paginas /admin/captacao-leads /admin/pesquisas /admin/agenda /admin/acompanhamento /admin/academy /admin/parceiros /admin/meu-dia /admin/meu-resumo
