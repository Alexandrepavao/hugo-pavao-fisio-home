import type { Config, Context } from "https://edge.netlify.com";

/**
 * Metadados sociais das páginas do HP Pages (editor), entregues no HTML CRU — sem depender de o crawler
 * executar JavaScript. O app é uma SPA (Vite/React); sem isto, título/descrição/OG só apareciam depois do
 * React montar e buscar os dados, o que a maioria dos crawlers de rede social nunca executa.
 *
 * Título, descrição, URL canônica, Open Graph, twitter:card e imagem (sempre absoluta — resolvida contra a
 * origem da própria requisição) só são injetados quando a página está PUBLICADA. Rascunho, desativada ou
 * endereço inexistente nunca ganham metadado de conteúdo — em vez disso, ganham `noindex` explícito, para
 * nunca expor nada da página fora do ar a um buscador ou pré-visualização.
 *
 * Todo texto vindo do editor (título, descrição) passa por escape de HTML antes de entrar na resposta —
 * o editor aceita texto livre, e essa é a única barreira contra injeção nesta camada.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const absoluteUrl = (raw: string | undefined, origin: string): string | null => {
  if (!raw) return null;
  try { return new URL(raw, origin).href; } catch { return null; }
};

interface PublicPageResult {
  status: "published" | "waitlist" | "closed" | "redirect" | "not_found";
  page?: { title: string; description?: string; seo?: { title?: string; description?: string; image?: string } };
}

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const slug = url.pathname.replace(/^\/+/, "");
  const res = await context.next();     // HTML de origem (o index.html da SPA) — sempre o ponto de partida

  if (req.method !== "GET" || !slug) return res;

  const supabaseUrl = Netlify.env.get("SUPABASE_URL") ?? Netlify.env.get("VITE_SUPABASE_URL");
  const publishable = Netlify.env.get("VITE_SUPABASE_PUBLISHABLE_KEY");
  if (!supabaseUrl || !publishable) return res;   // sem configuração, não quebra a página — só não enriquece

  let data: PublicPageResult | null = null;
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/rpc/get_public_page`, {
      method: "POST", headers: { apikey: publishable, authorization: `Bearer ${publishable}`, "content-type": "application/json" },
      body: JSON.stringify({ p_slug: slug }),
    });
    if (r.ok) data = (await r.json()) as PublicPageResult;
  } catch { return res; }   // falha ao consultar o banco: entrega a SPA normal, sem inventar metadado

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return res;   // só intercepta HTML (a SPA), nunca assets

  const html = await res.text();
  const headers = new Headers(res.headers);
  headers.delete("content-length");   // o corpo muda de tamanho; deixa o runtime recalcular

  if (!data || data.status !== "published" || !data.page) {
    // rascunho, desativada, redirecionamento ou endereço inexistente: nunca expõe conteúdo — só sinaliza noindex.
    const out = html.replace("</head>", `  <meta name="robots" content="noindex, nofollow" />\n  </head>`);
    return new Response(out, { status: res.status, statusText: res.statusText, headers });
  }

  const p = data.page;
  const title = esc(p.seo?.title || p.title);
  const description = esc(p.seo?.description || p.description || "");
  const canonical = absoluteUrl(`/${slug}`, url.origin)!;
  const image = absoluteUrl(p.seo?.image, url.origin);

  const tags = [
    `<title>${title} | HP Fisioterapia</title>`,
    description && `<meta name="description" content="${description}" />`,
    `<link rel="canonical" href="${canonical}" />`,
    `<meta property="og:title" content="${title}" />`,
    description && `<meta property="og:description" content="${description}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:url" content="${canonical}" />`,
    image && `<meta property="og:image" content="${image}" />`,
    `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}" />`,
    `<meta name="twitter:title" content="${title}" />`,
    description && `<meta name="twitter:description" content="${description}" />`,
    image && `<meta name="twitter:image" content="${image}" />`,
  ].filter(Boolean).join("\n  ");

  // Remove o <title>, a description e TODAS as tags og:*/twitter:* padrão do index.html — senão ficam
  // duplicadas, e a maioria dos crawlers usa a PRIMEIRA ocorrência de cada propriedade (a genérica venceria).
  const out = html
    .replace(/<title>.*?<\/title>/s, "")
    .replace(/<meta name="description"[^>]*\/>\s*/, "")
    .replace(/<meta property="og:[a-z_]+"[^>]*\/>\s*/g, "")
    .replace(/<meta name="twitter:[a-z_]+"[^>]*\/>\s*/g, "")
    .replace("</head>", `  ${tags}\n  </head>`);

  return new Response(out, { status: res.status, statusText: res.statusText, headers });
};

export const config: Config = {
  path: "/*",
  excludedPath: ["/admin/*", "/login", "/logout", "/academy", "/academy/*", "/portal", "/portal/*", "/paciente", "/parceiro",
    "/pesquisas", "/auth/*", "/redefinir-senha", "/primeiro-acesso", "/trabalhe-conosco", "/app", "/assets/*",
    "/lovable-uploads/*", "/favicon.png", "/hp-logo.jpg", "/placeholder.svg", "/robots.txt", "/sitemap.xml", "/.netlify/*"],
};
