# Preview do app iOS da HP Group

> **Isto NÃO é um aplicativo iOS nativo.** É um protótipo navegável (React, no navegador) que simula como seria o app, com duas experiências — **Paciente** e **Fisioterapeuta** — sobre os mesmos dados de demonstração. Não há build nativo, Xcode, App Store, login real, API do Hub, migration nem deploy.

## Como abrir

```bash
npm run dev -- --port 5182 --strictPort --host 127.0.0.1
```

Abra `http://127.0.0.1:5182/preview-ios`. Atalhos por parâmetro:

| Parâmetro | Valores | Efeito |
|---|---|---|
| `entrar=1` | — | pula a tela de entrada |
| `role` | `patient` (padrão), `physio` | experiência inicial |
| `size` | `se`, `std`, `max` | iPhone SE 375×667, iPhone 15 393×852, Pro Max 430×932 |
| `theme` | `light`, `dark` | tema |
| `text` | `1`, `1.15`, `1.3` | tamanho do texto (acessibilidade) |
| `now` | `AAAA-MM-DDTHH:MM` | "agora" fixo da demonstração (usado nos testes) |

- **Desktop (≥ 901 px e ≥ 640 px de altura):** moldura de iPhone + painel lateral (experiência, tamanho da tela, tema, texto, *Restaurar demonstração*).
- **Celular:** app em tela cheia, sem moldura, com áreas seguras (`env(safe-area-inset-*)`), altura pela `visualViewport` (teclado) e sem rolagem horizontal.
- A rota não existe em produção (`VITE_APP_ENV=production` mostra a página 404).

## O que funciona de verdade (no navegador)

Estado único compartilhado (`store.ts`, persistido em `localStorage` na chave `hp-ios-preview-demo-v1`; recriado quando o dia muda). Qualquer ação de um lado aparece no outro:

- **Fisio atribui/ajusta rotina** → o paciente vê na hora (Hoje, Exercícios).
- **Paciente executa** (cronômetro, Concluído / Fiz parcialmente / Não consegui, dificuldade, dúvida) → o fisio vê em Feedbacks e em Pendências. "Demonstração aberta" e "declarou que fez" são registros separados; nunca se afirma execução comprovada.
- **Fisio responde e registra evolução** (mensagem compartilhada + nota interna + medidas) → o paciente vê só a parte compartilhada e a resposta mais recente.
- **Reavaliação** define o próximo passo (concluir / manter / recomendar outro protocolo); nada é renovado automaticamente; a recomendação só aparece ao paciente quando o fisio a registra, com motivo.
- **Agenda e saldo do paciente:** contratadas / realizadas / descontadas / disponíveis; cancelar mostra a consequência **antes** (< 24 h desconta); confirmar presença ≠ atendimento realizado.
- **Ganhos do fisio:** 4 faixas separadas (estimativa, apurados, liberados, pagos), com detalhamento por valor, ajustes e estornos. Regra fictícia: R$ 100 por sessão elegível (12 × R$ 100 = R$ 1.200 no exemplo). Confirmar um atendimento gera um repasse "apurado". O fisio não vê receita da HP nem ganhos de outros fisios.
- **Jornada do paciente:** encontros realizados, evolução de medidas e metas individuais são três coisas separadas — nunca "% de recuperação" a partir de sessões. Medidas relatadas × avaliadas aparecem distintas.

## O que é SIMULADO

- Login/entrada, pessoas, valores, fotos, datas — tudo fictício e rotulado.
- Vídeos: há ilustração animada e um estado explícito "vídeo indisponível". `PrivateVideoSlot` está pronto para receber vídeo privado (Bunny) depois.
- Google Calendar: estado de demonstração, sem sincronização falsa.
- Notificações, push, pagamentos reais, assinaturas: não existem aqui.

## Estrutura (`src/preview-ios/`)

| Arquivo | Papel |
|---|---|
| `types.ts` | **Contratos de dados** (Paciente, Protocolo, Atendimento, Rotina, Registro, Medida, Meta, Repasse…). Base para trocar por contratos da Hub API. |
| `seed.ts` | Dados fictícios (`buildSeed`). |
| `store.ts` | Estado, ações (`act.*`) e seletores (saldo, ganhos, pendências, linha do tempo). Trocar pela Hub API = reimplementar `act`/seletores sobre RPC/REST, mantendo os tipos. |
| `ui.tsx`, `ios.css` | Componentes e estilo iOS (escopo `.ios-root`): navegação em pilha por aba, sheets, alertas, toasts, calendário, gráfico. |
| `patient.tsx`, `physio.tsx` | Telas de cada experiência. |
| `PreviewIos.tsx` | Moldura, painel, modo celular. |
| `store.test.ts` | Testes unitários dos seletores. |

Testes: `npx vitest run src/preview-ios` e `npx playwright test e2e/novos/N20-preview-ios.spec.ts --workers=1`.

## Reaproveitável em um app nativo × a adaptar

- **Reaproveitável:** contratos (`types.ts`), regras de negócio puras (saldo, consequência de cancelamento, ganhos, pendências, linha do tempo), textos e decisões de produto, hierarquia de telas e fluxos.
- **A adaptar/refazer:** UI (React DOM → SwiftUI ou React Native), navegação, gráficos, cronômetro em segundo plano, vídeo privado, push, autenticação, armazenamento seguro, persistência (`localStorage` → API), acessibilidade nativa (Dynamic Type, VoiceOver).

## Integrações que ficam para depois

Hub API e autenticação reais (RLS/RPC já existentes nos portais), vídeo privado Bunny, Google Calendar, push/e-mail, build nativo e publicação.
