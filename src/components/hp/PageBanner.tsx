import logo from "@/assets/hp-logo.png";
import type { HpApp } from "./apps";
import type { PageMeta } from "./pageMeta";

/** Identidade exibida no banner. Hoje só existe a marca HP; quando a organização ativa tiver marca própria (white label: nome, logotipo e cores), é AQUI que ela entra — a cor de fundo já
 *  vem do token `--primary` (que a marca da organização sobrescreve) e nada no banner é fixo em HP além deste fallback. */
export interface BannerBrand { name: string; logoSrc: string; /** logotipo escuro sobre transparente: o banner o exibe em branco */ monochrome?: boolean }
export const DEFAULT_BANNER_BRAND: BannerBrand = { name: "HP Fisioterapia", logoSrc: logo, monochrome: true };

/** Banner único de cada página, em largura total da área de conteúdo. Texto HTML real (título = único h1 da página); a imagem é só identidade de marca. */
const PageBanner = ({ app, meta, brand = DEFAULT_BANNER_BRAND }: { app: HpApp; meta: PageMeta; brand?: BannerBrand }) => {
  const hub = meta.variant === "hub";
  return (
    <section className="hp-banner" data-variant={hub ? "hub" : "page"} data-testid="page-banner" aria-labelledby="titulo-secao">
      <img src={brand.logoSrc} alt="" aria-hidden className="hp-banner-mark" data-mono={brand.monochrome ? "1" : undefined} />
      <div className="hp-banner-text">
        {!hub && <p className="hp-banner-eyebrow" data-testid="banner-app">{app.label}</p>}
        <h1 id="titulo-secao" data-testid="banner-title">{meta.title}</h1>
        {meta.description && <p className="hp-banner-desc" data-testid="banner-desc" title={meta.description}>{meta.description}</p>}
      </div>
      <img src={brand.logoSrc} alt={brand.name} className="hp-banner-logo" data-mono={brand.monochrome ? "1" : undefined} />
    </section>
  );
};

export default PageBanner;
