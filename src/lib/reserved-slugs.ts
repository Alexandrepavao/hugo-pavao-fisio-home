// Endereços reservados: nunca podem ser usados por páginas criadas no editor.
// Mantido em sincronia com a função private.is_reserved_slug() no banco (migration de páginas).
export const RESERVED_SLUGS = [
  "admin", "login", "logout", "academy", "portal", "api", "redefinir-senha", "primeiro-acesso",
  "trabalhe-conosco", "paciente", "parceiro", "pesquisas", "auth", "assets", "static", "favicon.png", "robots.txt",
  "sitemap.xml", ".netlify", "netlify", "supabase", "p", "preview",
] as const;

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateSlug(slug: string): string | null {
  if (!slug) return "Informe um endereço.";
  if (slug.length > 60) return "Use no máximo 60 caracteres.";
  if (!SLUG_PATTERN.test(slug)) return "Use apenas letras minúsculas, números e hífens.";
  if ((RESERVED_SLUGS as readonly string[]).includes(slug)) return "Este endereço é reservado pelo sistema.";
  return null;
}
