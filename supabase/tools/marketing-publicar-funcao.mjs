// Publica a Edge Function `marketing-ads` no DEV pela Management API (sem JWT obrigatório: o retorno do OAuth não traz JWT; as ações autenticam dentro da função).
//   node supabase/tools/marketing-publicar-funcao.mjs [marketing-ads | marketing-assistant]   (padrão: marketing-ads)
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DEV = "fsvtzowcwhvwtluwrhnb"; const PROD = "wfqkjrpqkaarpavjheoj";
const ref = process.env.SUPABASE_PROJECT_REF ?? DEV; if (ref === PROD) throw new Error("Recusado: este script nunca publica na produção.");
const token = process.env.SUPABASE_ACCESS_TOKEN; if (!token) throw new Error("Defina SUPABASE_ACCESS_TOKEN.");
const slug = process.argv[2] ?? "marketing-ads"; if (!["marketing-ads", "marketing-assistant"].includes(slug)) throw new Error("Função desconhecida.");
const dir = `supabase/functions/${slug}`;
const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
const form = new FormData();
form.append("metadata", JSON.stringify({ name: slug, entrypoint_path: "index.ts", verify_jwt: slug === "marketing-assistant" }));
for (const f of files) form.append("file", new Blob([readFileSync(join(dir, f), "utf8")], { type: "application/typescript" }), f);
const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/functions/deploy?slug=${slug}`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
const t = await r.text();
if (r.status >= 300) { console.error(`[FALHA] HTTP ${r.status}: ${t.slice(0, 600)}`); process.exit(1); }
const j = JSON.parse(t); console.log(`[OK] função ${slug} publicada no Dev · versão ${j.version ?? "?"} · status ${j.status ?? "?"} · verify_jwt=${j.verify_jwt}`);
