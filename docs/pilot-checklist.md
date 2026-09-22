# Checklist do piloto — HP Group Hub

> Jornadas por papel, priorizadas pelas sequências de negócio mais importantes. Baseado nos achados de
> `docs/release-readiness.md` (2026-09-22). Nenhum convite real foi enviado por esta sessão — instruções de
> primeiro acesso estão prontas, mas o disparo para pessoas reais depende de autorização específica.

## Gestor
1. Primeiro acesso com e-mail do bootstrap (`contato@hpfisioterapia.com.br` ou `jan.darioush@yahoo.com.br`)
   → login → visão executiva (Início). *Depende de e-mail funcionando ou de link enviado manualmente pelo
   responsável técnico — ver pendência de SMTP em `docs/release-readiness.md`, item 1.*
2. Convidar um membro de equipe (Comercial) → comunicar o convite manualmente (hoje não há e-mail
   automático) → membro completa Primeiro acesso.
3. Acompanhar CRM, Agenda, Financeiro e Academy pela navegação lateral.
4. Ver o painel "Automações" (retentativa de eventos) em Auditoria — confirmar que o job está ativo.

## Comercial/recepção
1. **Checkup → lead → avaliação → contratação → recebimento → acompanhamento**:
   - Publicar/usar uma página de captura existente.
   - Preencher o formulário como um visitante (dados sintéticos identificados, ex. prefixo "PILOTO").
   - Confirmar que a oportunidade aparece no CRM na etapa inicial.
   - Mover a oportunidade pelas etapas até "Ganho"/equivalente.
   - Agendar um atendimento e/ou vender um pacote (ver Financeiro abaixo).
2. Cadastrar uma pessoa manualmente em Pessoas; testar a busca e o cadastro de contato.
   *Mesclagem já validada nesta sessão (ver item 3 da matriz) — segura para uso no piloto.*
   *Importação por planilha: aguardando 1 teste manual de upload real antes de recomendar no piloto (ver
   item 3 da matriz).*
3. Confirmar bloqueio de acesso a telas fora do escopo do papel (ex. Financeiro) — deve mostrar "Sem
   permissão", não erro genérico.

## Financeiro
1. Registrar uma venda manual (pacote/serviço) para a pessoa criada acima → confirmar → registrar
   recebimento.
2. Conferir se a comissão (se aplicável) foi lançada automaticamente.
3. Rodar uma conciliação bancária de teste (upload de extrato sintético) e confirmar que reimportar não
   duplica.
4. Consultar DRE e MRR/ARR do período de teste.
*Lembrar: não há gateway de pagamento real — tudo é registro manual, deliberadamente (ver item 16 da matriz).*

## Fisioterapeuta
1. Ver a própria agenda do dia.
2. Consumir uma sessão de um pacote da pessoa de teste.
3. Reagendar e cancelar um atendimento de teste.
4. Liberar/atualizar um conteúdo de acompanhamento para um paciente de teste (ver item 8, Área do paciente —
   **recomenda-se testar esta jornada com atenção especial**, é o único módulo com jornada positiva ainda não
   exercitada por teste automatizado ponta a ponta).

## Paciente
1. Primeiro acesso (papel `patient`) → login.
2. Ver atendimentos e pacotes próprios.
3. Ver conteúdo de acompanhamento liberado pelo fisioterapeuta (vídeo/arquivo com URL assinada).
4. Enviar mensagem pela área de chat e registrar uma atividade (dor/nota).
5. Confirmar isolamento: não deve ver dados de outro paciente sintético criado no piloto.
*Esta é a jornada com menor cobertura automatizada hoje — validar com atenção antes de convidar pacientes
reais.*

## Aluno do Academy
1. **Matrícula → acesso → aula → progresso**:
   - Conceder acesso a um curso de teste (`entitlement_grant_manual`, já que não há checkout automático).
   - Login do aluno de teste → ver o curso no catálogo.
   - Assistir/concluir uma aula → confirmar progresso salvo.
   - Concluir o curso → confirmar emissão de certificado.
2. Participar da comunidade (postar e responder em uma thread de teste).
3. Confirmar que revogar o acesso (`entitlement_revoke`) bloqueia imediatamente API e UI — **já validado por
   e2e automatizado**, mas vale 1 confirmação manual no piloto real.

## Dependências de e-mail ou integração externa por jornada
| Jornada | Depende de e-mail/integração externa? |
|---|---|
| Primeiro acesso (todos os papéis) | Sim — e-mail de convite/recuperação (SMTP, ver item 1/15 da matriz) ou comunicação manual como alternativa |
| Checkup → lead → CRM | Não |
| Agenda/pacote | Não |
| Venda manual/recebimento | Não (sem gateway real) |
| Academy/progresso | Não |
| Pesquisa/resposta | Não |
| Tarefa/produtividade | Não |
| Contato via WhatsApp | Parcial — só link manual, sem automação (ver item 17 da matriz) |

## Antes de convidar pessoas reais
- Confirmar com o usuário se o e-mail de recuperação chegou de fato na caixa de `jan.darioush@yahoo.com.br`
  (teste feito nesta sessão, ver `docs/integrations.md`).
- Se optar por convite manual (sem e-mail automático): preparar o texto padrão a ser enviado por fora
  ("Você foi convidado(a) para o HP Group Hub — acesse [URL] e use 'Primeiro acesso' com este e-mail:
  [e-mail]").
- Nenhum convite a clientes reais nem redefinição de senha de gestores foi feito nesta sessão.
