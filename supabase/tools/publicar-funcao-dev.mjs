// Publica uma Edge Function (pasta supabase/functions/<slug>) no DEV pela Management API — NUNCA na produção. COM verify_jwt (padrão para funções chamadas pelo navegador).
//   node supabase/tools/publicar-funcao-dev.mjs patient-invite
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DEV = "fsvtzowcwhvwtluwrhnb"; const PROD = "wfqkjrpqkaarpavjheoj";
const ref = process.env.SUPABASE_PROJECT_REF ?? DEV; if (ref === PROD) throw new Error("Recusado: este script nunca publica na produção.");
const token = process.env.SUPABASE_ACCESS_TOKEN; if (!token) throw new Error("Defina SUPABASE_ACCESS_TOKEN.");
const slug = process.argv[2]; if (!slug || !/^[a-z0-9-]+$/.test(slug)) throw new Error("Informe o nome da função (ex.: patient-invite).");
const dir = `supabase/functions/${slug}`;
const form = new FormData();
form.append("metadata", JSON.stringify({ name: slug, entrypoint_path: "index.ts", verify_jwt: true }));
for (const f of readdirSync(dir).filter((f) => f.endsWith(".ts"))) form.append("file", new Blob([readFileSync(join(dir, f), "utf8")], { type: "application/typescript" }), f);
const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/functions/deploy?slug=${slug}`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
const t = await r.text();
if (r.status >= 300) { console.error(`[FALHA] HTTP ${r.status}: ${t.slice(0, 600)}`); process.exit(1); }
const j = JSON.parse(t); console.log(`[OK] função ${slug} publicada no Dev · versão ${j.version ?? "?"} · status ${j.status ?? "?"} · verify_jwt=${j.verify_jwt}`);
