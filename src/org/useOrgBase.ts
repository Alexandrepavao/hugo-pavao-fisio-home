import { useOrg } from "./OrgProvider";
import { publicOrgParam, withOrgBase } from "@/lib/orgScope";

/** Endereço-base da organização desta tela: `to("/login")` → `/empresa/<slug>/login` dentro de uma organização, `/login` na HP. Só caminhos internos (nunca URL externa). */
export const useOrgBase = () => {
  const org = useOrg();
  const slug = publicOrgParam(org.scope.slug);
  return { slug, isScoped: Boolean(slug), to: (p: string) => withOrgBase(slug, p), brandName: org.brandName, isDefaultBrand: org.isDefaultBrand };
};
