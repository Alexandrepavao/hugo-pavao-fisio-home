# Guia de operação — HP Group Hub, versão 1

Guia curto para quem administra e para a equipe. Cada seção diz **quem faz**, **onde fica** e **o que o sistema garante sozinho**.

## 1. Entrar, primeiro acesso e senha
- **Login**: `/login` com e-mail e senha. **Sair**: menu do avatar (canto superior direito) → *Sair*.
- **Primeiro acesso** (pessoa convidada ou gestor inicial): `/primeiro-acesso`, com o **mesmo e-mail do convite**. O sistema envia um e-mail de confirmação; o link leva a uma página do HP Group e, depois, ao painel. O papel só é concedido quando o e-mail **confirmado** coincide com o do convite.
- **Esqueci minha senha**: `/login` → *Esqueci minha senha*. Resposta é sempre a mesma (não revela se o e-mail existe). Há um limite de e-mails por hora; se aparecer "muitas tentativas", aguarde alguns minutos.
- Se o e-mail não chegar: confira spam; o gestor pode gerar novo convite e orientar a pessoa por WhatsApp.

## 2. Equipe, papéis e permissões (gestor / administrador operacional)
*Menu → Sistema → Equipe e acessos.* Convide pelo e-mail, escolha o **papel** e a **unidade**.
| Papel | Pode |
|---|---|
| Gestor / Adm. operacional | tudo da organização (não vê conteúdo clínico individual) |
| Gestor de unidade | pessoas, CRM, agenda, financeiro e dashboard **da(s) sua(s) unidade(s)** |
| Comercial | pessoas, CRM e oportunidades **da unidade**; vê as próprias comissões |
| Financeiro | vendas, recebíveis, recebimentos, contas a pagar, estornos da unidade |
| Fisioterapeuta | a própria agenda e o acompanhamento **só de pacientes vinculados** |
| Paciente / Parceiro | apenas a própria área (`/paciente`, `/parceiro`) |
Revogar um papel tem efeito imediato. Tudo que muda permissão fica na **Auditoria** (só gestor).

## 3. Cadastro central (pacientes, parceiros e empresas)
- **Pessoas** (PF) e **ADM** (planilha PF + PJ). Um cadastro por pessoa, com vários vínculos (lead, paciente, parceiro, aluno…). O sistema avisa de **nome ou contato parecido** antes de duplicar.
- **Mesclar duplicados**: em Pessoas. **Importar CSV**: PF (em Pessoas/ADM) e **PJ** (em ADM, só gestor) — sempre com prévia, relatório de erros por linha e sem sobrescrever sem sua decisão.
- Empresa (PJ): CNPJ validado, representantes ligados a pessoas já cadastradas.

## 4. Captação e CRM
- O site e os quizzes (`/avaliacao`, `/seja-parceiro`) criam **uma** pessoa e **uma** oportunidade por contato; repetir o envio não duplica. O lead nasce com **responsável** (distribuição automática) e tarefa de primeiro contato.
- **CRM → Gestão de leads**: troque o responsável, abra o lead, registre contato (aba *Histórico*) e crie tarefas (aba *Tarefas*). **Pipeline**: arraste entre etapas. **Tarefas**: fila do dia.
- Cada troca de etapa/responsável fica no histórico com data e autor. **Converter em venda** leva à tela de vendas já com a pessoa e a oportunidade.

## 5. Agenda e atendimento
*Menu → Operação → Agenda.* Escolha unidade, data, profissional e serviço; busque o paciente; escolha o horário livre (o banco impede sobreposição). Opcional: **usar pacote** e vincular à oportunidade.
- **Remarcar**: informe `AAAA-MM-DD HH:MM`. **Cancelou** (paciente) e **Clínica cancelou** pedem motivo.
- **Compareceu** e **Faltou** só podem ser marcados **depois do horário** do atendimento.
- **Pacotes e sessões** (aba): saldo, total e validade. Regras do produto: comparecimento consome 1 sessão; falta consome se o produto assim definir; cancelamento com menos horas que o limite do produto consome; cancelamento com antecedência e da clínica **não** consome; cada atendimento consome no máximo uma vez. Ajustes manuais exigem motivo e ficam no livro.
- **Acompanhamento** (Fisioterapeuta e gestor de unidade): vínculo assistencial paciente ↔ profissional; conteúdos e mensagens ficam **restritos a quem tem vínculo**. Gestor cria/revoga vínculos, mas não lê o conteúdo clínico.

## 6. Financeiro operacional
*Menu → Financeiro.*
1. **Vendas e recebimentos → Vendas**: nova venda (pessoa, produto, parcelas, 1º vencimento) → **Confirmar** gera contrato, parcelas e (se for pacote) as sessões. Confirmar de novo não duplica.
2. **Recebíveis**: *Receber* aceita **valor parcial**; repetir o envio não duplica; valor acima do saldo é recusado. **Estornar** (total ou parcial, com motivo) reabre a parcela.
3. **Contas a pagar**: cadastro e baixa. **Comissões e repasses**: geradas no recebimento, conforme a regra ativa (proporcionais em estornos).
4. **Configurações** do Financeiro: contas, categorias, classificação, centros de custo.

## 7. Dashboard
*Início.* Indicadores calculados dos registros reais; "Indisponível" significa que não há dado suficiente — nunca é zero inventado. Clique em um cartão para ver **a lista que compõe o número**.

## 8. Configurações essenciais
*Menu → Sistema → Configurações* (gestor): organização e **unidades** (nome, cidade, fuso), **serviços e preços**, **produtos/pacotes** (sessões, validade, regra de falta e de cancelamento tardio), funis e motivos de perda, **números de WhatsApp** por jornada/unidade.

## 9. Boas práticas
- Não compartilhe senha; peça convite para cada pessoa.
- Cadastros de teste: use o prefixo `TESTE` e apague/arquive depois. Nunca use dados de pacientes reais em treinamento.
- Dúvidas de valor: compare o cartão do dashboard com a lista do detalhamento.
