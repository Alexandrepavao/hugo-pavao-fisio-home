# Backup e restauração (plano Free do Supabase)

O projeto de produção (`HP Group Core`) está no plano **Free**: **não há backup automático nem PITR**. Enquanto o plano não mudar, a proteção dos dados é a exportação manual abaixo. No plano Pro o backup diário é automático (Billing da organização no painel do Supabase); o PITR é um complemento pago à parte.

## Quando exportar
- **Antes** de cadastrar dados reais pela primeira vez, **antes de cada migration em produção** e **no fim de cada dia de uso** (ou semanalmente, se o movimento for baixo).
- Antes de qualquer operação em lote (importação de planilha, mesclagem de pessoas, limpeza).

## Como exportar
```powershell
$env:SUPABASE_ACCESS_TOKEN = [Environment]::GetEnvironmentVariable("SUPABASE_ACCESS_TOKEN","User")
node supabase/tools/backup-projeto.mjs
```
Gera `D:\Claude\backups-hp-group\<data-hora>-producao-core\` (fora do repositório; o script **recusa** pasta dentro dele). É **somente leitura**: nada é gravado no banco.

| Arquivo | Conteúdo |
|---|---|
| `tabela-<nome>.json` | todas as linhas de cada tabela pública com dados |
| `restaurar.sql` | reinsere tudo em ordem de dependência, sem disparar auditoria/eventos, e acerta as sequências |
| `auth-users.json` | logins (e-mail e datas) — **nunca senha** |
| `storage-objects.json` | lista dos arquivos do Storage (**não** o conteúdo) |
| `migrations.json` | versão do schema no momento do backup |
| `manifest.json` / `LEIA-ME.txt` | contagens por tabela e SHA-256 de cada arquivo |

**Os arquivos têm dados reais de pessoas:** guarde-os em disco do computador (ideal: cópia criptografada fora dele), nunca no Git nem em pasta pública de nuvem.

Outro projeto: `--ref <id>`; outra pasta: `--out <pasta>`.

## Como restaurar
1. O schema precisa existir na versão do backup (`migrations.json`): num projeto novo, aplique as migrations do repositório até ela.
2. As tabelas precisam estar **vazias**.
3. Recrie os logins: `restaurar.sql` não toca em `auth.users` (senhas não são exportadas). As contas voltam por convite/primeiro acesso; `user_accounts.user_id` precisa existir em `auth.users` para o `restaurar.sql` entrar.
4. Rode `restaurar.sql` inteiro de uma vez (SQL Editor do Supabase ou Management API): é uma transação, então em caso de erro nada é gravado.
5. Arquivos do Storage: reenvie pelos originais (só a lista é exportada).

## O que foi provado
Em 08/10/2026, no Dev: exportação → esvaziar as 20 tabelas com dados → `restaurar.sql` → **20 de 20 tabelas com as mesmas contagens** (transação desfeita no fim). Nunca foi feito um teste de restauração em produção, e a restauração depende de o schema estar igual ao do backup.

## Limites (honestidade)
- É cópia **lógica** dos dados de um instante, não um backup físico: o que mudar depois da exportação se perde numa restauração. Sem PITR, a janela de perda é o intervalo entre exportações.
- Não protege contra erro de schema (use as migrations) nem restaura senhas, sessões, configuração do Auth, segredos das Edge Functions, variáveis do Netlify ou arquivos do Storage.
- Se o Supabase tiver uma falha própria, o backup físico do plano Pro seria a defesa; no Free não existe.
