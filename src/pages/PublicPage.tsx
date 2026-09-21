import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import WhatsAppFloat from "@/components/WhatsAppFloat";
import NotFound from "./NotFound";
import { supabase, backendConfigured } from "@/lib/supabase";
import { validateSlug } from "@/lib/reserved-slugs";
import { PageRenderer, utmFromLocation, type PublicForm } from "@/features/pages/PageRenderer";
import type { Block } from "@/features/pages/blocks";

type Result =
  | { status: "published"; page: { id: string; title: string; description?: string; seo?: { title?: string; description?: string; image?: string }; content: Block[]; forms: PublicForm[] } }
  | { status: "waitlist"; page: { title: string; forms: PublicForm[] } }
  | { status: "closed"; message: string; title?: string }
  | { status: "redirect"; redirect_url: string }
  | { status: "not_found" };

const sessionId = () => {
  try {
    let id = sessionStorage.getItem("hp_sid");
    if (!id) { id = crypto.randomUUID(); sessionStorage.setItem("hp_sid", id); }
    return id;
  } catch { return crypto.randomUUID(); }
};

/** Página criada no editor, servida em /:slug (após todas as rotas reservadas). */
const PublicPage = () => {
  const { slug = "" } = useParams();
  const [res, setRes] = useState<Result | null>(null);

  useEffect(() => {
    setRes(null);
    if (!backendConfigured || validateSlug(slug)) { setRes({ status: "not_found" }); return; }
    let alive = true;
    supabase.rpc("get_public_page", { p_slug: slug }).then(({ data, error }) => {
      if (!alive) return;
      const r: Result = error || !data ? { status: "not_found" } : (data as Result);
      setRes(r);
      if (r.status === "published") {
        // O builder do supabase-js só executa quando "consumido" (.then); `void` sozinho não dispara a requisição.
        supabase.rpc("track_page_visit", { p_page_id: r.page.id, p_session: sessionId(), p_utm: utmFromLocation(), p_referrer: document.referrer || null })
          .then(() => undefined, () => undefined);
      }
    });
    return () => { alive = false; };
  }, [slug]);

  useEffect(() => {
    if (res?.status !== "published") return;
    const prev = document.title;
    document.title = `${res.page.seo?.title || res.page.title} | HP Fisioterapia`;
    let meta = document.querySelector('meta[name="description"]');
    const old = meta?.getAttribute("content");
    const desc = res.page.seo?.description || res.page.description;
    if (desc) { if (!meta) { meta = document.createElement("meta"); meta.setAttribute("name", "description"); document.head.appendChild(meta); } meta.setAttribute("content", desc); }
    return () => { document.title = prev; if (meta && old != null) meta.setAttribute("content", old); };
  }, [res]);

  if (!res) return <div className="min-h-screen flex items-center justify-center text-navy-400" role="status">Carregando…</div>;
  if (res.status === "not_found") return <NotFound />;
  if (res.status === "redirect") {
    if (res.redirect_url.startsWith("/")) return <Navigate to={res.redirect_url} replace />;
    window.location.replace(res.redirect_url);
    return null;
  }

  return (
    <div className="min-h-screen">
      <Header />
      <main>
        {res.status === "published" && <PageRenderer blocks={res.page.content} forms={res.page.forms} />}
        {res.status === "closed" && (
          <section className="section"><div className="container-hp max-w-2xl text-center">
            <h1 className="text-3xl text-navy-900 mb-4">{res.title ?? "Página encerrada"}</h1><p className="text-navy-400">{res.message}</p>
          </div></section>
        )}
        {res.status === "waitlist" && (
          <PageRenderer blocks={[{ type: "hero", title: res.page.title, subtitle: "No momento estamos com a lista de espera aberta." }, { type: "form", title: "Entrar na lista de espera", form_id: res.page.forms[0]?.id }]} forms={res.page.forms} />
        )}
      </main>
      <Footer />
      <WhatsAppFloat />
    </div>
  );
};

export default PublicPage;
