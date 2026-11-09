// Aplica migrations (arquivos) no banco DEV, uma a uma, pela Management API — registra no histórico com o nome do arquivo. NUNCA roda na produção.
//   node supabase/tools/aplicar-dev.mjs supabase/migrations/20261109000104_marketing_base.sql [outros.sql ...]
// Pula o que já está no histórico do Dev. Falhou = a migration inteira é desfeita (transação) e o script para.
// Requer SUPABASE_ACCESS_TOKEN (variável do usuário do Windows).
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const DEV = "fsvtzowcwhvwtluwrhnb"; const PROD = "wfqkjrpqkaarpavjheoj";
const ref = process.env.SUPABASE_PROJECT_REF ?? DEV;
if (ref === PROD) throw new Error("Recusado: este script nunca roda contra a produção.");
const token = process.env.SUPABASE_ACCESS_TOKEN; if (!token) throw new Error("Defina SUPABASE_ACCESS_TOKEN.");
const files = process.argv.slice(2); if (!files.length) throw new Error("Informe os arquivos .sql.");
const api = (path, opt = {}) => fetch(`https://api.supabase.com/v1/projects/${ref}${path}`, { headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...opt });

const hist = await (await api("/database/migrations")).json();
const feitos = new Set((hist ?? []).flatMap((m) => [m.name, m.version]));
for (const f of files) {
  const name = basename(f).replace(/\.sql$/, "");
  if (feitos.has(name) || feitos.has(name.split("_")[0])) { console.log(`[PULADA] ${name} (já aplicada)`); continue; }
  const r = await api("/database/migrations", { method: "POST", body: JSON.stringify({ query: readFileSync(f, "utf8"), name }) });
  const t = await r.text();
  if (r.status >= 300) { console.error(`[FALHA] ${name} (HTTP ${r.status}): ${t.slice(0, 1500)}`); process.exit(1); }
  console.log(`[OK] ${name}`);
}
