# Onboarding de fisioterapeutas e pacientes · "Primeiro acesso"

Migration **086** (`supabase/migrations/20261008000086_onboarding.sql`) · testes: SQL `S25`, E2E `R29` (fisioterapeuta) e `R30` (paciente).

## Fluxos
| | Fisioterapeuta | Paciente |
|---|---|---|
| Endereço | `/onboarding-fisio?convite=<token>` | `/onboarding-paciente` |
| Quem pode abrir | só quem recebe o **link único** gerado pelo gestor (Operação › Agenda › Profissionais e disponibilidade › "Convidar fisioterapeuta por link") | qualquer pessoa (rota aberta) |
| Dados | pessoais (nome, nascimento, CPF, RG), contato e endereço, CREFITO, especialidades, formação, regiões, PF ou PJ (CNPJ), PIX/banco | pessoais (nome, nascimento, CPF), contato e endereço (+ ponto de referência), contato de emergência, motivo do atendimento (saúde) |
| Cadastro | Pessoa PF (tipo *equipe*); com CNPJ também **empresa PJ** + a pessoa como representante legal; **profissional ativo** na unidade do convite | Pessoa PF (tipo *paciente*) + ficha (`person_intake`) |
| Acesso | convite `physio` na unidade; o formulário cria a senha (Auth) e o papel nasce quando o e-mail é confirmado | convite `member`; idem |
| Primeiro login | tutorial do fisioterapeuta (`/boas-vindas`) | tutorial do paciente (sessões, evolução, agendamentos) |

PF × PJ é decidido pelos dados: com CNPJ informado (e válido) o cadastro é de pessoa jurídica; sem, pessoa física. O CPF é sempre exigido (é da pessoa que atende).

## Segurança (decisões)
- **Link do fisioterapeuta:** token aleatório de 24 bytes mostrado **uma vez** ao gestor; no banco fica só o hash (a coluna nem é legível pela API). Uso único, 1–60 dias (padrão 14), cancelável. E-mail do convite fica travado no formulário. Não emite link para e-mail que já tem conta confirmada.
- **Rota aberta do paciente:** limites por IP e globais, isca anti-robô, `noindex`. Se o e-mail **já existe** no cadastro (ex.: lead do quiz), **nada é escrito** no cadastro existente no envio: os dados ficam retidos (`onboarding_submissions.payload`) e, quando o dono do e-mail confirma o acesso, só campos **vazios** são preenchidos. CPF que já pertence a outra pessoa nunca vira vínculo: nasce um cadastro novo *pendente*, sem CPF, com aviso de duplicidade.
- **Dados sensíveis:** dados de pagamento (`person_bank_info`), ficha de saúde (`person_intake`), perfil profissional e envios só são legíveis pela própria pessoa e por gestor/administrativo (RLS). O fisioterapeuta não vê documentos, financeiro nem fichas de outras pessoas; documentos continuam mascarados para quem não é gestor.
- **Consentimento:** versão do termo (`onboarding-v1`) e data gravadas por envio; dado de saúde só com autorização explícita.
- Tabelas novas sem acesso anônimo; as funções públicas são só: `onboarding_link_info`, `onboarding_submit_physio`, `onboarding_submit_patient`, `first_access_email_status`.

## "Primeiro acesso" só para cadastrados
O formulário chama `first_access_email_status(email)` **antes** de criar a senha:
`not_found` → "Este e-mail não está cadastrado no sistema…"; `registered_no_access` → cadastro existe, acesso ainda não liberado; `has_account` → entre ou recupere a senha; `invited` → segue e cria a senha.
Isso revela se um e-mail está cadastrado (pedido do negócio); por isso há limite por IP (20 consultas/10 min). Quem ignora o formulário e chama a API de cadastro direto continua sem ganhar papel algum: o papel só vem de convite.

## Tutorial (`/boas-vindas`)
Mostra só o que o papel acessa (fisioterapeuta, paciente, parceiro, comercial, financeiro, professor, gestor de unidade, gestão). Abre sozinho no **primeiro login** de quem não é gestão (marca por navegador, `localStorage`) e fica no menu do usuário ("Tutorial do sistema") e no menu do portal.

## Limites conhecidos
- O envio da confirmação de e-mail depende do Resend/hook configurados em cada ambiente; se a criação da senha falhar, o cadastro fica salvo e a tela orienta usar "Primeiro acesso".
- O tutorial é um guia de leitura (não é um tour interativo na própria tela).
- Dados enviados no onboarding aparecem em Pessoas; a ficha de saúde e os dados bancários ainda não têm tela de consulta própria para a gestão (ficam em tabelas protegidas).
- Fisioterapeuta com e-mail que já tem conta no sistema não usa o onboarding: use Profissionais › "Liberar acesso".
