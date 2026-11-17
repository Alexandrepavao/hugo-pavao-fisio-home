// Publica a Edge Function `route-planner` pela Management API: no DEV por padrão; na PRODUÇÃO só com `--producao` (decisão explícita, depois da migration do PR). COM verify_jwt (o navegador sempre manda o JWT do usuário).
// O núcleo puro `supabase/functions/_shared/route-core.ts` é incluído como `route-core.ts` (única fonte da verdade: tela e função usam o mesmo código).
//   node supabase/tools/rota-publicar-funcao.mjs               (Dev)
//   node supabase/tools/rota-publicar-funcao.mjs --producao    (produção)
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DEV = "fsvtzowcwhvwtluwrhnb"; const PROD = "wfqkjrpqkaarpavjheoj";
const prod = process.argv.includes("--producao"); const ref = prod ? PROD : (process.env.SUPABASE_PROJECT_REF ?? DEV);
if (ref === PROD && !prod) throw new Error("Recusado: para publicar na produção use --producao explicitamente.");
const token = process.env.SUPABASE_ACCESS_TOKEN; if (!token) throw new Error("Defina SUPABASE_ACCESS_TOKEN.");
const slug = "route-planner"; const dir = `supabase/functions/${slug}`;
const form = new FormData();
form.append("metadata", JSON.stringify({ name: slug, entrypoint_path: "index.ts", verify_jwt: true }));
for (const f of readdirSync(dir).filter((f) => f.endsWith(".ts"))) form.append("file", new Blob([readFileSync(join(dir, f), "utf8")], { type: "application/typescript" }), f);
form.append("file", new Blob([readFileSync("supabase/functions/_shared/route-core.ts", "utf8")], { type: "application/typescript" }), "route-core.ts");
const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/functions/deploy?slug=${slug}`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
const t = await r.text();
if (r.status >= 300) { console.error(`[FALHA] HTTP ${r.status}: ${t.slice(0, 600)}`); process.exit(1); }
const j = JSON.parse(t); console.log(`[OK] função ${slug} publicada no ${prod ? "PRODUÇÃO" : "Dev"} · versão ${j.version ?? "?"} · status ${j.status ?? "?"} · verify_jwt=${j.verify_jwt}`);
