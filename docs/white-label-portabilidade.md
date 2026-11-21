# White label — portabilidade e exportação de dados

Arquitetura: [white-label-arquitetura.md](white-label-arquitetura.md).

> **O que isto é:** uma exportação **estruturada e autorizada dos DADOS de uma organização**, com manifesto, contagens e integridade. **O que isto NÃO é:** não entrega o aplicativo, o repositório, o banco inteiro nem uma infraestrutura independente. Exportar dados **não** significa que o banco exportado funcione sozinho como aplicativo; a migração para infraestrutura própria é um **serviço separado**, descrito (e não implementado) abaixo.

## 1. Inventário por organização

`platform_export_tables` (recalculável por `private.export_registry_refresh()`) classifica as **258 tabelas** do schema `public`:

| Classe | Qtde | Como entra |
|---|---|---|
| `org` | 178 | Tabelas com `org_id`: `where org_id = <organização>`. |
| `child` | 31 | Sem `org_id`, herdam a organização por chave estrangeira a uma tabela da organização (até 4 níveis). |
| `excluded` | 49 | **Fora**, com motivo registrado no manifesto (ver §3). |

Também há o **inventário de arquivos** (buckets `accounting-private`, `org-brand`, `legal-documents`, `representation-docs` — primeira pasta = `org_id`).

## 2. Como o gestor exporta

*Administração ▸ Organização ▸ Exportação de dados ▸ Gerar exportação* (só **gestor** da organização ativa; a plataforma **não** exporta dados de clínica).

1. A Edge Function `org-export` (JWT) chama `org_export_request` (confere papel `manager` na organização ativa e **registra** em `org_exports`, `platform_audit` e `audit_log`).
2. Com a chave de serviço (que **nunca** vai ao navegador), `org_export_run` monta **tudo numa única instrução SQL ⇒ um único snapshot consistente**, mesmo com alterações simultâneas.
3. A função cria o `.zip`, envia ao bucket privado `org-exports/<org>/<id>.zip`, registra tamanho/SHA-256/contagens e devolve uma **URL assinada de 10 minutos** (o download é registrado: `org_export_download_logged`, contador `downloads`). Exportações expiram em **7 dias**; "Baixar de novo" gera novo link (também auditado).
4. Só o gestor **da mesma organização** consegue baixar; gestor de outra organização recebe `404`; usuário sem papel recebe `403`.

## 3. Conteúdo do pacote

```
manifest.json     versão do pacote, org_id, export_id, data, versão do schema (última migration),
                  nº de tabelas, total de linhas, contagem por tabela, SHA-256 de cada arquivo,
                  lista do que ficou de fora (e o porquê), notas
data/<tabela>.ndjson   um objeto JSON por linha (UUIDs e relações preservados)
files.json        inventário de arquivos privados (bucket, caminho, tamanho) — SEM os binários
LEIA-ME.txt       como conferir a integridade (recalcular SHA-256 e comparar com o manifesto)
```

**Nunca entram**: senhas, tokens, chaves, segredos (colunas com `token|secret|password|api_key|encrypted|…` são removidas); dados de **outras organizações** (inclusive o próprio `org_id` de outras, verificado em teste); administração da plataforma (`platform_*`, `provisioning_*`); filas/caches/logs técnicos; **finanças pessoais** dos usuários (`pf_*`, dados do usuário e não da empresa); catálogos globais; conteúdo de terceiros. Arquivos do Storage: só **inventário** — os binários saem por link assinado sob demanda.

## 4. Limites e comportamento sob carga

- **Consistência**: garantida (snapshot único). **Custo**: organizações muito grandes (memória/tempo da instrução única) são **recusadas** com mensagem clara (`organizacao_grande`); nesse caso a plataforma faz uma exportação assistida em lotes (**não implementada**).
- O pacote é montado em memória na Edge Function (limite de memória/tempo da função); não testado acima de poucas milhares de linhas.
- Download privado, expirante e auditado; nenhum link público permanente.

## 5. Prova (E2E N38)

Exportação da Clínica Alfa: pacote baixado e **verificado** — SHA-256 do `.zip` confere; `manifest.org_id` = Alfa; todo arquivo de dados confere com o hash do manifesto; `people.ndjson` contém o paciente da Alfa e **não** o da Beta; nenhum `org_id` da Beta no pacote; nenhuma ocorrência de `encrypted_password`/`refresh_token`/`service_role`/`access_token`; `excluded` preenchido; gestor da Beta não baixa o pacote da Alfa (`404`); gestor da HP não exporta a Alfa (≥ 400); auditoria registrada.

## 6. Futuro: migração assistida para um Supabase dedicado (NÃO implementado)

Cenário: um cliente quer infraestrutura própria. O caminho **desenhado**, não construído:

1. **Congelar** a organização (modo somente leitura, aviso ao cliente).
2. **Exportar** com o pacote acima (dados + inventário de arquivos) e baixar os arquivos do Storage por URL assinada.
3. **Provisionar** um projeto Supabase novo do cliente (**ele contrata e é o dono**), aplicar **o mesmo conjunto de migrations** (a versão do schema vem no manifesto) e carregar os NDJSON respeitando a ordem de dependências (as chaves/UUIDs são preservados).
4. **Recriar** usuários de Auth (convite/redefinição de senha; **senhas e tokens não são exportados**) e reconfigurar integrações com **credenciais do próprio cliente**.
5. **Publicar** o aplicativo apontando para o novo projeto (mesma base de código, variáveis do cliente) e validar com o checklist de isolamento.
6. **Desligar** a organização na plataforma compartilhada e manter o pacote de exportação por um prazo combinado.

O que **não** se promete: repositório entregue, atualizações centrais depois da saída, equivalência de desempenho, migração "com um clique". **Não** se distribuem credenciais administrativas do Supabase da plataforma aos clientes em nenhuma etapa.

## 7. Pendências

Exportação em lotes para organizações grandes; exportação dos binários de Storage em pacote; migração de modelo (v1→v2) por organização; retenção configurável dos pacotes; teste de restauração ponta a ponta num projeto Supabase de teste.
