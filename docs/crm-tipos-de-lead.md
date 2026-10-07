# CRM: tipos de lead, listas com tipo, empresas (B2B) e várias oportunidades por lead

> Migration `20260930000083_crm_lead_types_lists_companies.sql` (aplicada no Dev) · testes: SQL `supabase/tests/release/S22_tipos_de_lead_listas_empresas.sql` (39 itens) e E2E `e2e/release/R27-tipos-de-lead-listas-empresas.spec.ts` (6) + `R25` (quiz → Academy).

## Os quatro tipos de lead

O tipo de um lead é o **tipo do funil** (`pipelines.kind`) onde a oportunidade está. A tela sempre mostra o nome do tipo (não o nome interno do funil):

| Tipo (nome na tela) | `kind` | Quem é | Funil interno |
|---|---|---|---|
| **Paciente** | `patients` | quer receber atendimento | Pacientes |
| **Fisioterapeuta · Equipe** | `partners` | fisioterapeuta que quer fazer parte da equipe HP | Parceiros |
| **Fisioterapeuta · HP Academy** | `education` | fisioterapeuta que quer a HP Academy (futuramente) | Mentorias e cursos |
| **Empresa · B2B** | `companies` | empresa/estabelecimento para parceria B2B | Empresas |

Onde isso aparece: **Pipeline** (quatro cartões com a contagem de abertas, pessoas, valor e “sem retorno” de cada tipo; clicar abre o funil; o funil e a oportunidade abertos ficam na URL: `?funil=…&abrir=…`), **Painel comercial** (bloco “Oportunidades por tipo de lead”, foto de agora), **Gestão de leads** (coluna “Tipo” e filtro por tipo), **Listas**, **importação CSV**, **ficha da oportunidade** e os filtros de funil dos relatórios. A contagem vem de `crm_pipeline_overview()` (security invoker: cada pessoa vê o que o escopo dela permite).

## Um lead, várias oportunidades

Uma pessoa pode ter **uma oportunidade aberta por funil** e quantas precisar em funis diferentes (a regra “uma aberta por pessoa e funil” já existia em `crm_create_opportunity`). Cada oportunidade tem a **própria etapa**: avançar a de equipe não move a da Academy.

Na ficha da oportunidade, a seção **“<Nome> em todos os funis”** lista todas as oportunidades da pessoa (selo do tipo, etapa atual, “Esta” na que está aberta), permite **mudar a etapa de cada uma separadamente** (perder exige motivo, como no Pipeline), abrir a de outro funil (“Abrir”) e **adicionar a pessoa a outro funil**. O funil de empresas fica fora desse “adicionar” (precisa de uma empresa: use *Nova oportunidade* no funil de empresas).

Entradas automáticas: o quiz de parceria cria a oportunidade de **equipe**; se o fisioterapeuta responde **“Sim” ou “Quero entender melhor”** à pergunta do programa de clínica própria, `quiz_complete` cria também uma oportunidade na **HP Academy** (origem `quiz:academy`, uma só, mesmo concluindo duas vezes; o interesse e o prazo ficam no histórico). “Não neste momento” não cria. A tag “Potencial Academy” segue valendo para todo lead de parceria (comportamento anterior, não alterado).

## Listas com tipo

- `crm_lead_lists.kind` ∈ `patients | partners | education | companies`; **obrigatório em toda lista nova ou editada** (restrição `NOT VALID`: listas antigas ficam “Sem tipo” até alguém classificar, direto na tabela). A tela exige a escolha ao criar; há filtro por tipo com contagem.
- **Importação CSV:** ao escolher uma lista com tipo, o **funil passa a ser o do tipo da lista e fica travado**; assim não dá para subir fisioterapeutas num funil de pacientes. Listas de empresas não aparecem na importação de pessoas. O botão “Importar CSV” existe na página de Listas (geral e por lista).
- **Lista de empresas** guarda empresas (`crm_lead_list_companies`), não pessoas: busca de empresa já cadastrada ou “Nova empresa” ali mesmo. As demais listas continuam guardando pessoas (`crm_lead_list_members`).

## Empresas (B2B)

- **Cadastro:** Gestão › Cadastro › **Empresas** (mesma planilha administrativa, aba **Empresas (PJ)**, botão **Nova empresa**). A planilha tem as abas **Todos · Pessoas físicas · Empresas (PJ)** com contagem, e as duas controlam o mesmo parâmetro `tipo` da URL (o filtro “Tipo” continua nos Filtros).
- **“Nova empresa”** (`CompanyDialog`): nome (razão social), fantasia, CNPJ validado, e-mail, telefone, cidade/UF, unidade e **contato** (pessoa do cadastro central, com cargo; vira representante principal). Não duplica: mesmo CNPJ devolve a empresa existente; mesmo nome (sem diferenciar maiúsculas) pede a decisão (“Usar a empresa existente” ou “Criar mesmo assim”); contato com nome parecido também pede decisão.
- **Permissão:** quem cria pelo CRM (`crm_company_create`, `crm_company_link_contact`) é gestor, administrador operacional, gestor de unidade e comercial (na própria unidade); essas funções não abrem o cadastro administrativo completo (documentos, dados sensíveis). Fisioterapeuta, paciente e anônimo são recusados. A empresa nasce com origem “CRM (B2B)”.
- **Oportunidade B2B:** no funil de empresas, *Nova oportunidade* pede a **empresa** (busca ou cadastro) e o **contato** (o contato principal da empresa já vem escolhido). `opportunities.legal_entity_id` guarda a empresa; a pessoa continua sendo o contato (`person_id`). O card mostra a **empresa** e “Contato: …”. **Uma oportunidade aberta por empresa e funil**, mesmo com outro contato.

## Limites conhecidos (não declarados como resolvidos)

- Os nomes internos dos funis (“Parceiros”, “Mentorias e cursos”) não foram renomeados no banco; a interface mostra os nomes dos tipos.
- Não há importação CSV de empresas direto para uma lista: importe as empresas em Planilha administrativa › “Importar PJ (CSV)” e adicione-as à lista de empresas.
- Listas antigas continuam sem tipo até serem classificadas; a importação não força funil para elas.
- `R17` e `R18` (importação e listas) foram **ajustados** para a regra do tipo, mas **não reexecutados**: dependem do token de gestão do Dev, que hoje não tem permissão de leitura de banco. Idem `R19`, `R21`–`R23` e os testes de cartão. Verde nesta rodada: `S22` (SQL, rodado direto no Dev), `R25`, `R27`, `R24`, `R07`, `R02`, `R12`, `R13` (menu) e o filtro da planilha do `R14`.
- Oportunidade da HP Academy criada pelo quiz vale só para quizzes concluídos depois da migration 083.
