// Dados de DEMONSTRAÇÃO do Marketing — SOMENTE no banco Dev. Tudo leva "DEMO" no nome e sai com um comando.
//   node supabase/tools/marketing-demo.mjs seed      (remove o que já existir e cria de novo)
//   node supabase/tools/marketing-demo.mjs remove    (apaga tudo que é DEMO)
//   node supabase/tools/marketing-demo.mjs status    (conta o que existe)
// Precisa de SUPABASE_ACCESS_TOKEN (conta dona do projeto Dev). Recusa qualquer outro projeto, inclusive a produção.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEV = "fsvtzowcwhvwtluwrhnb"; const PROD = "wfqkjrpqkaarpavjheoj";
const ref = process.env.SUPABASE_PROJECT_REF ?? DEV;
if (ref !== DEV || ref === PROD) throw new Error("Recusado: os dados de demonstração só existem no projeto Dev.");
const token = process.env.SUPABASE_ACCESS_TOKEN; if (!token) throw new Error("Defina SUPABASE_ACCESS_TOKEN (conta dona do projeto Dev).");
const dir = join(dirname(fileURLToPath(import.meta.url)), "marketing-demo");
const sql = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${DEV}/database/query`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ query }) });
  const text = await r.text(); if (r.status >= 300) throw new Error(`HTTP ${r.status}: ${text.slice(0, 1500)}`); return JSON.parse(text);
};
const status = async () => (await sql(`select
  (select count(*) from public.mkt_ad_accounts where name like 'DEMO %')::int contas,
  (select count(*) from public.mkt_campaigns where name like 'DEMO %')::int campanhas,
  (select count(*) from public.people where full_name like 'Lead DEMO %')::int leads,
  (select count(*) from public.sales where person_id in (select id from public.people where full_name like 'Lead DEMO %'))::int vendas,
  (select count(*) from public.mkt_spend_daily where account_id in (select id from public.mkt_ad_accounts where name like 'DEMO %'))::int dias_de_gasto`))[0];

const cmd = process.argv[2];
if (cmd === "status") console.log(await status());
else if (cmd === "remove") { await sql(readFileSync(join(dir, "remove.sql"), "utf8")); console.log("removido:", await status()); }
else if (cmd === "seed") {
  await sql(readFileSync(join(dir, "remove.sql"), "utf8"));
  await sql(readFileSync(join(dir, "seed.sql"), "utf8"));
  console.log("criado (Dev):", await status());
} else { console.log("uso: node supabase/tools/marketing-demo.mjs seed | remove | status"); process.exit(1); }
