// Executa testes SQL de supabase/tests contra o projeto DEV (Management API) e imprime o relatório de cada um.
// Cada teste roda em transação que termina em RAISE EXCEPTION 'RELATORIO_...' — nada é gravado.
//   SUPABASE_ACCESS_TOKEN=... node supabase/tests/run-sql.mjs [pasta-ou-arquivos...]      (padrão: supabase/tests/novos)
// Recusa o projeto de produção. Sai com código 1 se algum item [FALHA] aparecer ou se um teste não produzir relatório.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DEV = "fsvtzowcwhvwtluwrhnb"; const PROD = "wfqkjrpqkaarpavjheoj";
const ref = process.env.SUPABASE_PROJECT_REF ?? DEV;
if (ref === PROD) throw new Error("Recusado: este executor nunca roda contra a produção.");
const token = process.env.SUPABASE_ACCESS_TOKEN; if (!token) throw new Error("Defina SUPABASE_ACCESS_TOKEN (conta dona do projeto Dev).");
const targets = process.argv.slice(2).length ? process.argv.slice(2) : ["supabase/tests/novos"];
const files = targets.flatMap((t) => (statSync(t).isDirectory() ? readdirSync(t).filter((f) => f.endsWith(".sql")).sort().map((f) => join(t, f)) : [t]));

let ok = 0, fail = 0, broken = 0;
for (const f of files) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ query: readFileSync(f, "utf8") }) });
  const text = await r.text(); let msg = text; try { msg = JSON.parse(text).message ?? text; } catch { /* texto puro */ }
  const lines = String(msg).split("\n"); const rel = lines.findIndex((l) => l.includes("RELATORIO_"));
  console.log(`\n=== ${f}`);
  if (rel < 0) { broken++; console.log(`SEM RELATÓRIO (HTTP ${r.status}): ${String(msg).slice(0, 600)}`); continue; }
  const items = lines.slice(rel).filter((l) => /^\[(OK|FALHA)/.test(l));
  console.log(lines[rel].replace(/^.*?(RELATORIO_)/, "$1")); for (const l of items) console.log(l);
  ok += items.filter((l) => l.startsWith("[OK]")).length; fail += items.filter((l) => l.startsWith("[FALHA")).length;
}
console.log(`\nTOTAL: ${ok} OK, ${fail} FALHA, ${broken} teste(s) sem relatório`);
process.exit(fail || broken ? 1 : 0);
