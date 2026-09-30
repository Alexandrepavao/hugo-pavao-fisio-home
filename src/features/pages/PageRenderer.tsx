import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import { resolveCtaHref, safeUrl, videoEmbed, type Block } from "./blocks";

export interface PublicForm {
  id: string; name: string; success_message: string;
  fields: { key: string; label: string; type: "text" | "email" | "phone" | "textarea" | "select"; required?: boolean; options?: string[] }[];
}
type Obj = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" ? v : "");
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);
const input = "w-full border border-input bg-card px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-ring";

export const utmFromLocation = (): Record<string, string> => {
  const out: Record<string, string> = {};
  try {
    const stored = sessionStorage.getItem("hp_utm");
    if (stored) Object.assign(out, JSON.parse(stored));
    const q = new URLSearchParams(window.location.search);
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach((k) => { const v = q.get(k); if (v) out[k] = v.slice(0, 150); });
    sessionStorage.setItem("hp_utm", JSON.stringify(out));
  } catch { /* storage indisponível */ }
  return out;
};

const PublicFormBlock = ({ form, title, preview }: { form?: PublicForm; title: string; preview?: boolean }) => {
  const [values, setValues] = useState<Record<string, string>>({});
  const [honey, setHoney] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  if (!form) return <section id="formulario" className="section"><div className="container-hp max-w-xl"><p className="text-navy-400">Formulário não configurado.</p></div></section>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (preview) return setMsg("Pré-visualização: o envio está desativado.");
    setState("sending"); setMsg("");
    const { data, error } = await supabase.rpc("submit_public_form", {
      p_form_id: form.id, p_answers: values, p_utm: utmFromLocation(), p_honeypot: honey, p_referrer: document.referrer || null,
    });
    if (error) {
      setState("error");
      setMsg(error.message.includes("rate_limited") ? "Muitas tentativas. Aguarde alguns minutos." : /Preencha|inválid|Informe|Texto/.test(error.message) ? error.message : "Não foi possível enviar. Tente novamente em instantes.");
      return;
    }
    setState("done"); setMsg((data as { message?: string })?.message ?? form.success_message);
  };

  return (
    <section id="formulario" className="section bg-muted/40">
      <div className="container-hp max-w-xl">
        <h2 className="text-3xl text-navy-900 mb-6">{title || form.name}</h2>
        {state === "done" ? (
          <p role="status" className="bg-card border border-accent p-6 text-navy-900">{msg}</p>
        ) : (
          <form onSubmit={submit} className="space-y-4 bg-card border border-border p-6" noValidate>
            {form.fields.map((f) => (
              <div key={f.key}>
                <label htmlFor={`f-${f.key}`} className="block text-sm text-navy-700 mb-1">{f.label}{f.required ? " *" : ""}</label>
                {f.type === "textarea" ? (
                  <textarea id={`f-${f.key}`} rows={3} className={input} value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
                ) : f.type === "select" ? (
                  <select id={`f-${f.key}`} className={input} value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}>
                    <option value="">Selecione…</option>{(f.options ?? []).map((o) => <option key={o}>{o}</option>)}
                  </select>
                ) : (
                  <input id={`f-${f.key}`} className={input} type={f.type === "email" ? "email" : f.type === "phone" ? "tel" : "text"}
                    autoComplete={f.key === "name" ? "name" : f.type === "email" ? "email" : f.type === "phone" ? "tel" : "off"}
                    value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
                )}
              </div>
            ))}
            {/* honeypot: invisível para pessoas */}
            <div aria-hidden className="absolute -left-[9999px]"><label>Não preencha<input tabIndex={-1} autoComplete="off" value={honey} onChange={(e) => setHoney(e.target.value)} /></label></div>
            {msg && <p role="alert" className="text-sm text-destructive">{msg}</p>}
            <button type="submit" disabled={state === "sending"} className="btn-primary w-full disabled:opacity-60">{state === "sending" ? "Enviando…" : "Enviar"}</button>
            <p className="text-xs text-navy-400">Usaremos seus dados apenas para retornar seu contato.</p>
          </form>
        )}
      </div>
    </section>
  );
};

export const BlockView = ({ block, forms, preview, pageSlug }: { block: Block; forms: PublicForm[]; preview?: boolean; pageSlug?: string }) => {
  const b = block as Obj;
  switch (block.type) {
    case "hero": {
      return (
        <section className="section relative overflow-hidden">
          <div className="hero-glow" />
          <div className="container-hp relative max-w-3xl">
            <p className="eyebrow mb-4">HP Fisioterapia</p>
            <h1 className="text-4xl sm:text-5xl text-navy-900 mb-5">{s(b.title)}</h1>
            <p className="text-lg text-navy-400 mb-8 whitespace-pre-line">{s(b.subtitle)}</p>
            {s(b.cta_label) && <a href="#formulario" className="btn-primary">{s(b.cta_label)}</a>}
          </div>
        </section>
      );
    }
    case "text":
      return (
        <section className="section"><div className="container-hp max-w-3xl">
          {s(b.title) && <h2 className="text-3xl text-navy-900 mb-5">{s(b.title)}</h2>}
          {s(b.body).split(/\n{2,}/).map((p, i) => <p key={i} className="mb-4 text-navy-700 whitespace-pre-line">{p}</p>)}
        </div></section>
      );
    case "image": {
      const src = safeUrl(b.src);
      return src && src.startsWith("http") ? (
        <section className="section !py-10"><figure className="container-hp max-w-4xl">
          <img src={src} alt={s(b.alt)} loading="lazy" className="w-full h-auto" />
          {s(b.caption) && <figcaption className="text-sm text-navy-400 mt-2">{s(b.caption)}</figcaption>}
        </figure></section>
      ) : null;
    }
    case "video": {
      const src = videoEmbed(b.url);
      return src ? (
        <section className="section !py-10"><div className="container-hp max-w-4xl aspect-video">
          <iframe src={src} title={s(b.title) || "Vídeo"} className="w-full h-full border-0" allowFullScreen loading="lazy" referrerPolicy="strict-origin-when-cross-origin" />
        </div></section>
      ) : null;
    }
    case "benefits":
      return (
        <section className="section"><div className="container-hp">
          {s(b.title) && <h2 className="text-3xl text-navy-900 mb-8">{s(b.title)}</h2>}
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {arr(b.items).map((it, i) => <li key={i} className="card-hp"><h3 className="text-xl text-navy-900 mb-2">{s(it.title)}</h3><p className="text-navy-400">{s(it.text)}</p></li>)}
          </ul>
        </div></section>
      );
    case "team":
      return (
        <section className="section"><div className="container-hp">
          {s(b.title) && <h2 className="text-3xl text-navy-900 mb-8">{s(b.title)}</h2>}
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {arr(b.members).map((m, i) => { const ph = safeUrl(m.photo); return (
              <li key={i}>{ph?.startsWith("http") && <img src={ph} alt={s(m.name)} loading="lazy" className="w-full aspect-square object-cover mb-3" />}
                <p className="text-navy-900 font-medium">{s(m.name)}</p><p className="text-sm text-navy-400">{s(m.role)}</p></li>); })}
          </ul>
        </div></section>
      );
    case "faq":
      return (
        <section className="section"><div className="container-hp max-w-3xl">
          {s(b.title) && <h2 className="text-3xl text-navy-900 mb-6">{s(b.title)}</h2>}
          {arr(b.items).map((it, i) => (
            <details key={i} className="border-b border-border py-4"><summary className="cursor-pointer text-navy-900 font-medium">{s(it.q)}</summary><p className="mt-2 text-navy-400 whitespace-pre-line">{s(it.a)}</p></details>
          ))}
        </div></section>
      );
    case "cta": {
      const href = resolveCtaHref(b, { pageSlug, utm: utmFromLocation() });
      return (
        <section className="section bg-primary text-primary-foreground"><div className="container-hp max-w-3xl text-center">
          <h2 className="text-3xl mb-3 !text-primary-foreground">{s(b.title)}</h2><p className="mb-6 opacity-90">{s(b.text)}</p>
          {href && s(b.label) && <a href={href} className="inline-block bg-accent text-accent-foreground px-8 py-4 text-[13px] uppercase tracking-[0.16em]" {...(href.startsWith("http") ? { rel: "noopener noreferrer", target: "_blank" } : {})}>{s(b.label)}</a>}
        </div></section>
      );
    }
    case "form":
      return <PublicFormBlock form={forms.find((f) => f.id === b.form_id) ?? forms[0]} title={s(b.title)} preview={preview} />;
    default:
      return null;
  }
};

export const PageRenderer = ({ blocks, forms, preview, pageSlug }: { blocks: Block[]; forms: PublicForm[]; preview?: boolean; pageSlug?: string }) => (
  <>{blocks.map((b, i) => <BlockView key={i} block={b} forms={forms} preview={preview} pageSlug={pageSlug} />)}</>
);
