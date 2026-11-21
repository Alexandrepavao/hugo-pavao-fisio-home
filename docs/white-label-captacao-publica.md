# White label — captação pública por organização

Acesso por organização: [white-label-autenticacao-organizacao.md](white-label-autenticacao-organizacao.md). Migration **143**; testes **N23** (SQL, 31) e **N40** (E2E, Delta). Estado: **Dev apenas**.

## O que mudou

Quatro entradas públicas tinham a organização **HP escrita no código**; o formulário público aceitava o id de qualquer organização. Agora toda entrada pública resolve a organização por um **slug validado no servidor** (`private.public_org`):

| Entrada (anon) | Antes | Agora |
|---|---|---|
| `quiz_start` (avaliação) | HP fixa | `p_org_slug`; lead, pessoa e oportunidade **na organização do endereço** |
| `quiz_whatsapp_number` | número da HP | número **da organização** (nenhum cadastrado → o quiz não oferece WhatsApp) |
| `get_public_page` | só páginas da HP | páginas da organização do endereço |
| `submit_public_form` | qualquer id de formulário | formulário **tem de ser da organização do endereço** (sem slug = HP) |
| `onboarding_submit_patient` | HP fixa | organização do endereço |

Regras no servidor:
- **Sem slug = HP** (rotas atuais idênticas). Slug presente → só organização **ativa**; inexistente/suspensa/arquivada/em preparação respondem igual.
- O destino do dado **nunca** vem do payload: lead, resposta e oportunidade nascem na organização resolvida. ID de formulário de outra organização → "formulário indisponível" (com e sem slug).
- Captação exige o módulo **CRM habilitado** na organização (desligado → "captação indisponível", sem rastro).
- Limites de abuso **por organização** (`quiz_start:<org>:…`): uma organização não consome a cota de outra. Honeypot e reenvio idempotente (mesma chave do dia) continuam: repetir o envio **retoma** o lead (`resumed`) / devolve `duplicate`, sem duplicar pessoa, lead, oportunidade nem resposta.
- Anônimo **não lista** leads, respostas nem pessoas (`permission denied`); a superfície anônima é só: `org_public_by_slug`, `quiz_*` de captação, `get_public_page`, `track_page_visit`, `submit_public_form`, `onboarding_*`.
- Atribuição preservada: `utm_*`, campanha, origem (`quiz:atendimento`, `page_id`), `ref` de indicação e referrer vão para a oportunidade como antes.

## Marca, conteúdo e consentimento

- Rotas `/empresa/<slug>/avaliacao`, `/onboarding-paciente` e `/<página>`: cabeçalho e rodapé **da organização** (nunca menu, logotipo, WhatsApp, endereço ou CNPJ da HP).
- **Textos de consentimento** citam a organização (nome do aplicativo) e a versão guardada com o aceite é outra (`contact-v1-org`, `health-v1-org`, `marketing-v1-org`, `onboarding-v1-org`) — nunca se confunde o texto aceito. **Os textos por organização precisam de revisão jurídica própria** (pendência comercial).
- Mensagem de sucesso e próximo passo: a do formulário (`success_message`, definida no editor) / hand-off de WhatsApp só se a organização cadastrou número (Configurações ▸ Captação).
- Jornada "Seja parceiro" (parceria) **não** é oferecida a outras organizações (é da HP).

## Configurações iniciais por modelo (sem copiar nada da HP)

O modelo Fisioterapia v1 cria funil de pacientes, motivos de perda, categorias financeiras e configurações. **Não** copia páginas, formulários, campanhas, pessoas, números de WhatsApp nem conteúdo da HP. A organização cria **suas** páginas/formulários no editor (Pages) e cadastra **seu** número de WhatsApp.

## Limitações conhecidas

- Páginas do editor e quiz usam o vocabulário e o conteúdo-base do produto (perguntas do quiz de fisioterapia); personalizar perguntas por organização **não** existe.
- Blocos de página (`hero` etc.) mostram o nome da organização; imagens e textos são do editor da organização.
- Domínio público por organização (DNS) depende da verificação de posse — não implementada; o acesso é por `/empresa/<slug>`.
- Parte dos rótulos do financeiro ainda cita "HP" em telas administrativas (ex.: "Parte da HP", "Linha de negócio (HP Fisioterapia / HP Academy)"); não afeta dados.
