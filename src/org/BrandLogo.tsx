import logo from "@/assets/hp-logo.png";
import { useOrg } from "./OrgProvider";

/** Logotipo das cascas internas: HP (organização padrão) ou a marca da organização (logotipo enviado por ela, ou o monograma com as iniciais).
 *  Enquanto a marca é resolvida mostra um espaço vazio; nunca mostra a marca HP para outra organização. */
const BrandLogo = ({ height }: { height: string }) => {
  const org = useOrg();
  if (org.loading) return <span aria-hidden="true" style={{ height, width: height, display: "inline-block" }} />;
  if (org.isDefaultBrand || !org.brandName) return <img src={logo} alt="HP Fisioterapia" style={{ height, width: "auto" }} />;
  if (org.logoUrl) return <img src={org.logoUrl} alt={org.brandName} style={{ height, width: "auto" }} />;
  return (
    <span role="img" aria-label={org.brandName} className="inline-flex items-center justify-center rounded-md bg-primary/10 font-bold text-primary" style={{ height, minWidth: height, padding: "0 0.35rem", fontSize: "0.8em" }}>
      {org.brandName.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}
    </span>
  );
};

export default BrandLogo;
