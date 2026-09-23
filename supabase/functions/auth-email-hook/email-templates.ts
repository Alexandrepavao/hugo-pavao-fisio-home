// Templates de e-mail de autenticação do HP Group Hub — identidade HP, PT-BR, HTML responsivo + texto simples.
// Cópia intencional de netlify/functions/lib/email-templates.mts: Supabase Edge Functions empacotam cada
// função a partir do seu próprio diretório (não conseguem importar arquivos do lado do Netlify/Node em
// tempo de deploy), então o mesmo conteúdo vive nos dois lugares. Ao mudar a marca/copy, atualizar os dois.

const LOGO_URL = "https://hpfisioterapia.com.br/hp-logo.jpg";
const NAVY = "#14283D";
const NAVY_DEEP = "#0d1a2b";
const GOLD = "#A6873F";
const CREAM = "#FAF8F3";

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

/** Envelope visual comum: cabeçalho com logo, corpo, botão de ação opcional, rodapé. Tabelas para compatibilidade com clientes de e-mail. */
export function renderShell(opts: { preheader: string; heading: string; bodyHtml: string; ctaLabel?: string; ctaUrl?: string; footNote?: string }): string {
  const { preheader, heading, bodyHtml, ctaLabel, ctaUrl, footNote } = opts;
  const cta = ctaLabel && ctaUrl
    ? `<tr><td align="center" style="padding:8px 0 28px 0">
         <a href="${esc(ctaUrl)}" style="background:${GOLD};color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-weight:bold;font-size:15px;padding:14px 32px;border-radius:8px;display:inline-block">${esc(ctaLabel)}</a>
       </td></tr>
       <tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#8a94a3;padding-bottom:24px;word-break:break-all">
         Se o botão não funcionar, copie e cole este link no navegador:<br>
         <a href="${esc(ctaUrl)}" style="color:${GOLD}">${esc(ctaUrl)}</a>
       </td></tr>`
    : "";
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(heading)}</title></head>
<body style="margin:0;padding:0;background:${CREAM};font-family:Arial,Helvetica,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM}">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e0d5">
<tr><td align="center" style="background:${NAVY_DEEP};padding:28px 24px">
  <img src="${LOGO_URL}" width="120" alt="HP Fisioterapia" style="display:block;border:0;max-width:120px;height:auto">
</td></tr>
<tr><td style="padding:32px 32px 8px 32px">
  <h1 style="margin:0 0 16px 0;font-family:Arial,Helvetica,sans-serif;font-size:20px;color:${NAVY};font-weight:700">${esc(heading)}</h1>
  <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#2d3a4a">${bodyHtml}</div>
</td></tr>
<table role="presentation" width="100%"><tr><td style="padding:0 32px">${cta}</td></tr></table>
<tr><td style="padding:0 32px 28px 32px;border-top:1px solid #efe9dc;padding-top:20px">
  <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#8a94a3">
    ${footNote ? esc(footNote) + "<br>" : ""}HP Group — hpfisioterapia.com.br
  </p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

export function renderPlainText(opts: { heading: string; bodyText: string; ctaLabel?: string; ctaUrl?: string; footNote?: string }): string {
  const { heading, bodyText, ctaLabel, ctaUrl, footNote } = opts;
  const cta = ctaLabel && ctaUrl ? `\n${ctaLabel}: ${ctaUrl}\n` : "";
  return `${heading}\n\n${bodyText}\n${cta}\n${footNote ? footNote + "\n" : ""}HP Group — hpfisioterapia.com.br`;
}

export type AuthEmailType = "signup" | "invite" | "recovery" | "email_change" | "magiclink" | "reauthentication";

export function renderAuthEmail(type: AuthEmailType, confirmUrl: string): EmailContent {
  switch (type) {
    case "signup":
      return {
        subject: "Confirme seu e-mail — HP Group Hub",
        html: renderShell({
          preheader: "Confirme seu e-mail para concluir o primeiro acesso.",
          heading: "Confirme seu e-mail",
          bodyHtml: "Para concluir a criação da sua conta no HP Group Hub, confirme este e-mail clicando no botão abaixo.",
          ctaLabel: "Confirmar e-mail",
          ctaUrl: confirmUrl,
          footNote: "Se você não solicitou este acesso, ignore esta mensagem.",
        }),
        text: renderPlainText({
          heading: "Confirme seu e-mail",
          bodyText: "Para concluir a criação da sua conta no HP Group Hub, confirme este e-mail.",
          ctaLabel: "Confirmar e-mail",
          ctaUrl: confirmUrl,
          footNote: "Se você não solicitou este acesso, ignore esta mensagem.",
        }),
      };
    case "invite":
      return {
        subject: "Você foi convidado para o HP Group Hub",
        html: renderShell({
          preheader: "Você foi convidado para acessar o HP Group Hub.",
          heading: "Você foi convidado",
          bodyHtml: "Você foi convidado(a) para acessar o HP Group Hub. Clique no botão abaixo para criar sua senha e confirmar o acesso.",
          ctaLabel: "Criar meu acesso",
          ctaUrl: confirmUrl,
          footNote: "Se você não esperava este convite, ignore esta mensagem.",
        }),
        text: renderPlainText({
          heading: "Você foi convidado",
          bodyText: "Você foi convidado(a) para acessar o HP Group Hub. Use o link para criar sua senha.",
          ctaLabel: "Criar meu acesso",
          ctaUrl: confirmUrl,
          footNote: "Se você não esperava este convite, ignore esta mensagem.",
        }),
      };
    case "recovery":
      return {
        subject: "Redefinir sua senha — HP Group Hub",
        html: renderShell({
          preheader: "Solicitação de redefinição de senha.",
          heading: "Redefinir sua senha",
          bodyHtml: "Recebemos uma solicitação para redefinir a senha da sua conta no HP Group Hub. Clique no botão abaixo para criar uma nova senha.",
          ctaLabel: "Redefinir minha senha",
          ctaUrl: confirmUrl,
          footNote: "Se você não solicitou isto, ignore esta mensagem — sua senha atual continua válida.",
        }),
        text: renderPlainText({
          heading: "Redefinir sua senha",
          bodyText: "Recebemos uma solicitação para redefinir a senha da sua conta no HP Group Hub.",
          ctaLabel: "Redefinir minha senha",
          ctaUrl: confirmUrl,
          footNote: "Se você não solicitou isto, ignore esta mensagem — sua senha atual continua válida.",
        }),
      };
    case "email_change":
      return {
        subject: "Confirme seu novo e-mail — HP Group Hub",
        html: renderShell({
          preheader: "Confirme a alteração do seu e-mail.",
          heading: "Confirme seu novo e-mail",
          bodyHtml: "Recebemos uma solicitação para alterar o e-mail da sua conta no HP Group Hub. Confirme clicando no botão abaixo.",
          ctaLabel: "Confirmar novo e-mail",
          ctaUrl: confirmUrl,
          footNote: "Se você não solicitou isto, entre em contato com a equipe do HP Group.",
        }),
        text: renderPlainText({
          heading: "Confirme seu novo e-mail",
          bodyText: "Recebemos uma solicitação para alterar o e-mail da sua conta no HP Group Hub.",
          ctaLabel: "Confirmar novo e-mail",
          ctaUrl: confirmUrl,
          footNote: "Se você não solicitou isto, entre em contato com a equipe do HP Group.",
        }),
      };
    case "reauthentication":
      return {
        subject: "Confirme sua identidade — HP Group Hub",
        html: renderShell({
          preheader: "Confirmação de identidade necessária.",
          heading: "Confirme sua identidade",
          bodyHtml: "Por segurança, confirme sua identidade para continuar clicando no botão abaixo.",
          ctaLabel: "Confirmar identidade",
          ctaUrl: confirmUrl,
        }),
        text: renderPlainText({ heading: "Confirme sua identidade", bodyText: "Por segurança, confirme sua identidade para continuar.", ctaLabel: "Confirmar", ctaUrl: confirmUrl }),
      };
    case "magiclink":
    default:
      return {
        subject: "Seu link de acesso — HP Group Hub",
        html: renderShell({
          preheader: "Seu link de acesso ao HP Group Hub.",
          heading: "Seu link de acesso",
          bodyHtml: "Clique no botão abaixo para acessar o HP Group Hub.",
          ctaLabel: "Acessar",
          ctaUrl: confirmUrl,
        }),
        text: renderPlainText({ heading: "Seu link de acesso", bodyText: "Clique no link para acessar o HP Group Hub.", ctaLabel: "Acessar", ctaUrl: confirmUrl }),
      };
  }
}
