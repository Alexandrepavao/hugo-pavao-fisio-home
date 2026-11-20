import { useOrg } from "./OrgProvider";

/** Cabeçalho mínimo das páginas públicas de uma organização que NÃO é a HP: só a marca dela (nunca o menu, o logotipo ou o WhatsApp da HP). */
const ScopeHeader = () => {
  const org = useOrg();
  return (
    <header className="border-b border-border bg-card">
      <div className="container-hp flex h-16 items-center gap-3" data-testid="cabecalho-organizacao">
        {org.logoUrl ? <img src={org.logoUrl} alt={org.brandName} className="h-9 w-auto object-contain" /> : null}
        <span className="font-display text-lg font-semibold text-navy-900">{org.brandName}</span>
      </div>
    </header>
  );
};

/** Rodapé mínimo das páginas públicas de uma organização que NÃO é a HP: nome (e e-mail de suporte público, se houver); nunca endereço, redes ou CNPJ da HP. */
export const ScopeFooter = () => {
  const org = useOrg();
  return (
    <footer className="border-t border-border mt-10" data-testid="rodape-organizacao">
      <div className="container-hp py-6 text-sm text-navy-400">© {new Date().getFullYear()} {org.brandName}{org.brand?.support_email ? ` · ${org.brand.support_email}` : ""}</div>
    </footer>
  );
};

export default ScopeHeader;
