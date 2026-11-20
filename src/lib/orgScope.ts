/** Organização pelo ENDEREÇO (rota `/empresa/<slug>/…`). O slug só ESCOLHE qual organização a tela mostra e para qual organização as entradas públicas (quiz, páginas, formulários,
 *  cadastro) enviam o dado. Nunca autoriza nada: o banco valida o slug (organização ativa), o vínculo do usuário e o módulo a cada chamada. Nada de redirecionamento externo:
 *  todo destino interno passa por `withOrgBase`, que só aceita caminhos próprios. */
const SLUG = /^\/empresa\/([a-z0-9-]{1,60})(?:\/|$)/;

export const scopeSlugFromPath = (pathname: string): string | null => SLUG.exec(pathname)?.[1] ?? null;

/** Caminho interno dentro do escopo da organização (ou o próprio caminho, sem escopo). Recusa URL externa e caminhos protocolo-relativos. */
export const withOrgBase = (slug: string | null | undefined, path: string): string => {
  if (!path.startsWith("/") || path.startsWith("//")) return slug ? `/empresa/${slug}` : "/";
  if (!slug) return path;
  return path === "/" ? `/empresa/${slug}` : `/empresa/${slug}${path}`;
};

/** Slug de organização válido para enviar às entradas públicas (RPC); vazio → null (HP, como sempre). */
export const publicOrgParam = (slug: string | null | undefined): string | null => (slug && /^[a-z0-9-]{1,60}$/.test(slug) ? slug : null);
