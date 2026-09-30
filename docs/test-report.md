# Relatório de testes

Legenda: **SQL** = teste no banco Dev, transação desfeita (`supabase/tests/*.sql`) · **UI** = verificação manual no navegador (Dev) · **Unit** = vitest · **Real** = integração externa de verdade.
Nenhuma linha "Real" existe ainda: **nenhuma integração externa foi validada**.

## Banco (SQL) — isolamento, permissões e regras de negócio
| Arquivo | Escopo | Resultado |
|---|---|---|
| 001_rls_isolation | Isolamento por unidade, escalada, revogação, `anon` | ✅ 16/16 |
| 002_bootstrap_managers | E-mail verificado da lista → gestor (uso único); metadados falsos ignorados; e-mail fora da lista sem acesso; allowlist inacessível | ✅ 7/7 |
| 003_pages_forms | Blocos/slug/`<script>` recusados, publicação, desativação (mensagem/redirect/espera), formulário público (idempotência, honeypot, rate limit, contato compartilhado → nova pessoa + revisão), isolamento por unidade | ✅ 30/30 |
| 004_agenda_packages | Sem sobreposição (profissional/paciente), disponibilidade, bloqueios, remarcação atômica, consumo de sessão (presença/falta/cancelamento tardio/antecipado), sem duplo consumo, ajustes, permissões | ✅ 26/26 |
| 005_sales_finance | Venda→contrato→parcelas exatas (centavos), confirmação idempotente, recebimento parcial, idempotência de pagamento, excedente recusado, estorno parcial e comissão proporcional, cancelamento, papéis, jornadas de checkup e mentoria, projeção de mensalidades (5 regras) | ✅ 33/33 (1 falha inicial era artefato do teste; corrigido e o comportamento confirmado à parte) |
| 006_academy_care | Acesso por compra/regra de pagamento integral/manual/validade, revogação por estorno com efeito imediato (aulas e Storage), gabarito oculto, nota calculada no servidor, certificado, comunidade/moderação, vínculo assistencial, gestor sem acesso clínico, revogação do vínculo | ✅ 42/42 |
| 007_partners_relationship | Aprovação via funil, indicação rastreável, visão mínima do parceiro, repasses, pesquisas, k-anonimato corporativo; `anon` só nas 3 RPCs públicas | ✅ 15/16 na 1ª execução; a falha (5 RPCs novas executáveis por `anon`) foi corrigida na migration 010 e confirmada por consulta (`anon` = 3 funções). O arquivo completo não foi reexecutado após a correção |
| 008_dashboard | "Indisponível" sem dados, cálculo sobre dados reais, escopo por perfil/unidade | ✅ 12/12 |
| Advisors de segurança (Dev) | Após 001–002: sem alertas. Após 008: 41 avisos de `SECURITY DEFINER` executável por `anon` → **corrigidos** (010) | ✅ ver nota |

Nota sobre advisors: os avisos remanescentes de "funções `SECURITY DEFINER` executáveis por usuários autenticados" são intencionais (RPCs de negócio que validam papel/escopo dentro da função). A verificação final dos advisors deve ser refeita após aplicar em produção.

## Front-end
| Verificação | Tipo | Resultado |
|---|---|---|
| `tsc`, `eslint` (0 erros), `vite build` | local | ✅ |
| `vitest`: centavos/BRL, slugs reservados, links/vídeos seguros, CSV | Unit | ✅ 11/11 |
| Login como gestor → `/app` → painel; dashboard com "Indisponível" | UI | ✅ |
| Jornada Checkup: criar página por modelo → publicar → `/checkup?utm_…` → formulário → lead no CRM (origem `page:checkup`, campanha, etapa "Novo contato", responsável e tarefa de 1º contato) | UI + banco | ✅ |
| Rastreio de visita | UI | ❌→✅ falha encontrada (o builder do `supabase-js` não dispara sem `.then`); **corrigida**; reteste da visita pela interface pendente |
| Aluna: redirecionamento por perfil (`/app`→`/paciente`), Academy, aula concluída, progresso 50%, certificado bloqueado até concluir | UI | ✅ (bug de corrida "papéis carregando" encontrado e corrigido) |
| Recuperação de link inválido/expirado | UI | ✅ |
| **API direta** com token de aluna: `people`=só a própria; outras 14 tabelas 0 linhas; RPCs administrativas 403; auto-promoção a gestor 403; inserir acesso 403 | API | ✅ |

## Etapa ADM + Contábil (2026-09-29) — testes NOVOS, separados da regressão
Como rodar: `SUPABASE_ACCESS_TOKEN=… npm run test:sql:novos` (SQL, só Dev, transação desfeita) · `npm run test:novos` (Unit) · `npm run test:e2e:novos` (E2E, tag `@novo`, pasta `e2e/novos/`). Regressão: `npm run test:regressao` e `npm run test:e2e:regressao`.

| Arquivo | Escopo | Resultado |
|---|---|---|
| supabase/tests/novos/N01_adm_importacao_pj | validação por linha, CNPJ repetido no arquivo, reimportação sem duplicar, sem sobrescrita silenciosa, atualização só por decisão e só dos campos do diff, arquivado, auditoria, permissão | ✅ 18/18 |
| N02_adm_colunas_permissoes | preferência por usuário, reordenar/ocultar/restaurar, colunas sensíveis barradas no servidor (salvar/listar/exportar), papel rebaixado, RLS, auditoria da exportação | ✅ 21/21 |
| N03_contabil_permissoes | acesso ao app, isolamento entre unidades, RLS de escrita direta, concessões de fechar/reabrir (papel sozinho não basta), revogação de papel, pseudônimo, bucket privado, acesso a documento auditado | ✅ 38/38 |
| N04_contabil_jornada | livro sem duplicar, caixa ≠ competência, classificação/sugestão/dispensa, comprovantes, revisão → fechamento com bloqueios, competência fechada imutável, alteração posterior sinalizada (e o que não sinaliza), aceitar, reabrir com justificativa e auditoria, refechar, exportação | ✅ 59/59 |
| src/lib/pjImport.novo.test.ts · accExport.novo.test.ts | mapeamento de colunas, linhas físicas, modelo; CSV por base, neutralização de fórmulas, LEIAME/provisório, manifesto SHA-256 | ✅ 20/20 |
| e2e/novos N10–N13 | importação PJ na interface; colunas/permissão de campo; jornada completa do Contábil (incl. ZIP inspecionado, contador, comercial, aluno); navegação Hub⇄apps, cards→telas filtradas, celular | ✅ 9/9 |
| Regressão E2E 01–09 | inalterada | ✅ 32/32 |
| Regressão SQL 001–023 | reexecutada no Dev acumulado | ⚠️ 269 OK / 28 FALHA / 4 sem relatório — pressupostos de banco vazio e `anon`=3 RPCs (hoje há as `quiz_*`); ver `docs/project-status.md`. Não provado contra base limpa |

## Não executado / não validado
Recuperação de senha e primeiro acesso **com e-mail real**; envio Resend; webhooks/eventos repetidos vindos de provedor real; concorrência entre conexões simultâneas (só a restrição de exclusão foi comprovada dentro de uma sessão); E2E automatizado (Playwright); acessibilidade por leitor de tela; testes no deploy publicado atrás do login Netlify; produção.
