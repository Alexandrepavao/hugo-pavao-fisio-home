# Resultados dos testes (redesign + usabilidade)

Banco **Dev**, servidor local próprio (porta 5181), `--workers=1`. Tudo abaixo foi **executado**; nada foi inferido.

## Verificações estáticas
| Verificação | Resultado |
|---|---|
| `tsc` (typecheck) | limpo |
| `npm run build` | passou |
| `npm run lint` | só os **3 erros que já existiam** em `e2e/release/R06-…spec.ts` (`any`); nenhum novo |
| `vitest` | 183/183 testes passam; o arquivo `supabase/tests/functions/google-sync-plan.test.mjs` aborta com `process.exit` (não foi comparado com a `main`) |

## Testes novos
| Teste | O que prova | Resultado |
|---|---|---|
| **N50** varredura | 60 rotas estáticas do `/admin`: um banner, um `h1`, aplicativo e menu corretos, sem rolagem horizontal em 1440 e 390 px | 0 problemas (passou) |
| **N50b** componentes | seletor de unidades por teclado/foco/fechamento; sidebar contextual (clique, link direto, recarga, voltar/avançar); capturas 1280/768/360/escuro/zoom 200% | 3/3 |
| **N51** jornadas da Gestão | J1 Visão geral → contrato aguardando assinatura → cadastro → voltar; J2 cadastro incompleto → edição; J3 Planilha × Pessoas (mesmo registro); J4 ajuda/tour; J5 celular; J6 papel limitado | 6/6 |
| **N52** ajuda por rota | painel “Ajuda” e tour com ≥ 2 passos reais em todas as 60 rotas | 0 problemas (passou) |

> **N51 é validação automatizada das tarefas, não teste com usuários leigos.**

## Regressão completa (`e2e/release` + `e2e/novos`)
Última rodada completa: **329 passaram, 11 falharam, 37 não rodaram** (blocos seriais após uma falha).

Para classificar, os **mesmos arquivos foram executados na `main` limpa (4830397)** com servidor próprio:

| Falha | Na `main` | Conclusão |
|---|---|---|
| N22 (URLs de retorno Meta), N33 (API ver-como), N35 (rota, 4×6), N34 (demo: “Marina” × “Ana”), R01-passo 4, R05 (preparo), R21 (converter em venda), R27 (aviso de chave duplicada), R32 (aviso de chave duplicada no CRM) | **também falham** | pré-existentes, **não** do redesign |
| N50 / R11 | passaram quando repetidos | `statement timeout` intermitente do Dev em `adm_central` (o Dev é compartilhado com outra sessão); R11 passou **9/9** quando o banco estava quieto |

Regressões **minhas** encontradas e corrigidas nesta rodada (cada uma com causa comprovada):
- **R06 (Kanban)**: o `aria-label` do banner continha `:` e colidia com o seletor `section[aria-label*=':']` do teste (o card era solto na própria coluna). Correção no produto: banner rotulado por `aria-labelledby`.
- **R19 (Conversas)**: o banner empurrava a tela e o campo de mensagem saía da janela. Altura da área de trabalho passou a descontá-lo.
- **R13 (Hub)**: o Hub perdeu o título “Indicadores prioritários” → devolvido (`h2` visualmente oculto).
- **R34 (configurações pessoais)**: corrida pré-existente (digitar antes de a consulta chegar sobrescrevia o valor) — formulário desabilitado enquanto carrega.

Mudanças **intencionais** de interface refletidas nos testes (não são enfraquecimento): `#pf-unit` agora é um botão com lista (`pickUnit`, R01/R04/R05/R14); item de menu “Dashboard” → “Visão geral” (R02); título da página é o único `h1`, no banner (R12, R13, R34); cartões de atenção da Visão geral levam à tela filha filtrada (R07, R11); fórmulas dos cartões em “Sobre este indicador” (R07); Hub recomposto (R12).

## Limitações desta validação
- Sem teste com usuários leigos; sem leitor de tela real; sem navegadores além do Chromium/Edge do Playwright.
- A rodada completa foi feita **antes** do último ajuste do R11 e dos 2 aliases de teste; N50 e R11 foram reexecutados depois (passam). Os 9 testes pré-existentes continuam falhando — **não foram corrigidos aqui**.
- O Dev oscila por `statement timeout` quando está sob carga; resultados “verdes” de R11/N51 dependem do banco estar quieto.
