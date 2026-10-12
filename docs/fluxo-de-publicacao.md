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
node supabase/tools/promover.mjs --pr=<n> --ate-preview    # roda TODAS as verificações + preview; para aqui ("passou, pronto para produção")
node supabase/tools/promover.mjs --pr=<n>                  # idem e, se tudo passar, publica em produção
npm run migrar:producao                       # lista migrations pendentes na produção (não grava)
node supabase/tools/migrar-producao.mjs --aplicar          # backup + aplica as pendentes
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

**Mudança só de documentação** (`docs/` e `*.md` na raiz): o `promover` não faz build, testes, preview nem deploy (o site não muda); só confere Git/PR e mescla. Por isso o commit publicado no domínio (`/version.json`) pode ficar atrás da `main` quando as últimas mudanças foram só de documentação, o que é esperado.

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
- O preview usa o **banco Dev**, que foi limpo em 07/10. Para ter o que testar à mão (profissional com agenda, serviço, pacote, 8 pacientes, uma venda paga, uma conta a pagar e uma oportunidade), rode **`npm run seed:dev`**: tudo marcado "(exemplo)", só cria o que falta (pode rodar de novo) e **só funciona contra o Dev** (recusa outro banco). Dados do Dev nunca vão para produção.
- A suíte E2E completa (`@release`) mede o estado real: em 12/10 passou inteira depois dos ajustes (os testes criam o que precisam; só o `R02` compara com dados existentes e é por isso que o `seed:dev` existe). No PowerShell, `--grep "@release"` precisa de aspas (o `@` é um operador do PowerShell).
- O primeiro login de quem não é da gestão abre o tutorial (`/boas-vindas`); os testes de jornada dispensam o tutorial pelo helper `uiLogin` (opção `{ tutorial: "manter" }` para testá-lo).
- O `promover` descarta as capturas de tela que os testes regeneram em `docs/screenshots` (são resultado de teste, não código) antes de trocar para a `main`; se algo falhar **depois** do merge, ele avisa que o PR já foi mesclado e mostra o comando para concluir o deploy. (Na primeira promoção real, em 12/10, o deploy parou aí e foi concluído à mão; esta correção veio em seguida.)
- O preview não envia e-mails reais de confirmação em nenhum teste automatizado (os testes interceptam a criação da senha).
