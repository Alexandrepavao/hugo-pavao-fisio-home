# Fluxo de publicação: preview → produção

Regra de trabalho acordada com o responsável (08/10/2026): **toda mudança passa primeiro pelo preview; se os testes passam, vai para produção.** Quem executa é o Claude Code (ou qualquer pessoa) pelos comandos abaixo.

## Os três ambientes
| | Onde | Banco | Quem vê |
|---|---|---|---|
| **Local** | `npm run dev` (porta 5180) | Dev (`fsvtzowcwhvwtluwrhnb`) | quem está na máquina |
| **Preview** | `https://preview--hp-group-hub.netlify.app` (site Netlify `hp-group-hub`) | **Dev** (dados de teste) | equipe, com **login Netlify** (retorna 401 sem login) |
| **Produção** | `https://hpfisioterapia.com.br` (site `hp-group-hub-producao`) | **Core** (`wfqkjrpqkaarpavjheoj`), dados reais | público |

O preview usa o **mesmo perfil da produção (`v1`)**, só trocando o banco: é o que vai ao ar. A `vite.config.ts` recusa qualquer build de produção com banco Dev (e vice-versa).

**Endereço principal do site de preview** (`https://hp-group-hub.netlify.app`): mostra só uma página fechada "Ambiente de testes" (`supabase/tools/placeholder-preview/`, com `noindex` e `robots.txt` bloqueando), publicada em 08/10/2026 no lugar de um build antigo de 24/09 que estava aberto, sem login e ligado ao Dev. O login da equipe só protege os endereços de **rascunho** (como `preview--…`); o endereço principal do site é público por padrão no Netlify, então ele nunca deve receber o app. Para republicar a página: `cd supabase/tools/placeholder-preview` e `netlify deploy --prod --dir . --site 2c2d11bc-f62c-42b7-bae6-4cf3b6f35756`.

## Comandos
```powershell
npm run preview:publicar                      # publica o que está na pasta no preview (rascunho, nunca no domínio)
npm run promover -- --pr=<n> --ate-preview    # roda TODAS as verificações + preview; para aqui ("passou, pronto para produção")
npm run promover -- --pr=<n>                  # idem e, se tudo passar, publica em produção
npm run migrar:producao                       # lista migrations pendentes na produção (não grava)
npm run migrar:producao -- --aplicar          # backup + aplica as pendentes
npm run backup:producao                       # exporta os dados da produção (docs/backup-e-restauracao.md)
```
Opções do `promover`: `--e2e=arquivo1,arquivo2` (E2E específicos), `--e2e-completo` (toda a suíte `@release`), `--aceito-destrutivo` (confirma migration com DROP/TRUNCATE/DELETE).

## O que significa "passou" (todas as etapas, parando na primeira falha)
1. Git limpo, branch enviada ao GitHub e PR aberto contra a `main`, sem conflito.
2. `typecheck` e `lint` (nos arquivos alterados) sem erro; `build` ok.
3. Testes SQL de release no Dev: **0 falha e 0 teste sem relatório**.
4. Testes E2E: os criados/alterados pela branch **+** o de login e rotas (`01-auth-and-routes`), ou os pedidos em `--e2e`, ou a suíte `@release` inteira (`--e2e-completo`).
5. Preview publicado e conferido (`version.json`: ambiente `preview`, perfil `v1`, banco Dev).

## O que a promoção faz em produção (só depois de tudo acima)
Backup → migrations pendentes (uma a uma) → merge do PR → deploy a partir da `main` → conferência no domínio (commit publicado, ambiente `production`, banco de produção). Ao final imprime como voltar o site ao deploy anterior.

## Regras que continuam valendo (nada disto é automático)
- **Migration com `DROP`, `TRUNCATE` ou `DELETE`** não é aplicada sem confirmação explícita do responsável.
- **DNS, preços e dados reais** (apagar/alterar cadastros, vendas, pagamentos): sempre confirmação explícita.
- Mudança que o responsável pedir para **"segurar no preview"** fica no preview até ele liberar.
- Nunca promover com teste falhando, "instável" sem causa investigada ou verificação pulada: se um teste falha, o resultado é **NÃO PROMOVIDO** e a causa é registrada.
- Produção continua exigindo backup antes de migration (o plano Free do Supabase não tem backup automático).

## Voltar atrás (rollback)
- **Site:** painel Netlify › `hp-group-hub-producao` › Deploys › deploy anterior › *Publish deploy* (o `promover` mostra o id do anterior). Leva segundos.
- **Banco:** as migrations são aditivas por regra; a correção é uma nova migration. Em último caso, restaurar dos dados exportados em `D:\Claude\backups-hp-group` (ver `docs/backup-e-restauracao.md`: restaura dados, não o schema).

## Limites conhecidos
- O preview usa o **banco Dev**, que está sem dados de exemplo (foi limpo em 07/10): para testar fluxos que dependem de serviços, profissionais e agenda é preciso cadastrá-los ali ou usar os testes E2E, que criam o que precisam. Dados do Dev nunca vão para produção.
- A suíte E2E completa depende de dados de base no Dev (serviços, produtos, profissionais, agenda); sem eles parte dela falha por falta de fixture, não por defeito do código. Por isso a verificação padrão usa os testes da própria mudança + login/rotas.
- O preview não envia e-mails reais de confirmação em nenhum teste automatizado (os testes interceptam a criação da senha).
