// Aplica na PRODUÇÃO (HP Group Core) as migrations que ainda não estão lá, uma a uma, na ordem, parando na primeira falha.
//   npm run migrar:producao                  → só LISTA o que está pendente (não grava nada)
//   npm run migrar:producao -- --aplicar     → faz backup (backup-projeto.mjs) e aplica
// Proteções: (1) backup obrigatório antes de aplicar; (2) migration com DROP/TRUNCATE/DELETE exige confirmação explícita (--aceito-destrutivo);
// (3) as migrations 048–051 (módulo Contábil, só na branch feature/lead-quizzes) nunca são aplicadas por aqui.
// Requer SUPABASE_ACCESS_TOKEN (variável do usuário do Windows).
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PROD = "wfqkjrpqkaarpavjheoj";
const token = process.env.SUPABASE_ACCESS_TOKEN; if (!token) throw new Error("Defina SUPABASE_ACCESS_TOKEN.");
const aplicar = process.argv.includes("--aplicar"); const aceitoDestrutivo = process.argv.includes("--aceito-destrutivo");
const dir = fileURLToPath(new URL("../migrations", import.meta.url));
const api = (path, opt = {}) => fetch(`https://api.supabase.com/v1/projects/${PROD}${path}`, { headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...opt });

const noBanco = new Set(((await (await api("/database/migrations")).json()) ?? []).map((m) => m.name));
if (noBanco.size === 0) throw new Error("não consegui ler o histórico de migrations da produção; nada foi feito.");
const pendentes = readdirSync(dir).filter((f) => /^\d{14}_.*\.sql$/.test(f)).sort().filter((f) => !noBanco.has(f.replace(/\.sql$/, "")) && !/^\d{8}0000(48|49|50|51)_/.test(f));
const risco = (sql) => /\b(drop\s+(table|column|schema|function)|truncate\b|delete\s+from)\b/i.test(sql.replace(/--.*$/gm, ""));

console.log(`Produção tem ${noBanco.size} migrations; pendentes: ${pendentes.length}`);
for (const f of pendentes) console.log(`  - ${f}${risco(readFileSync(join(dir, f), "utf8")) ? "   [CONTÉM DROP/TRUNCATE/DELETE]" : ""}`);
if (!pendentes.length) { console.log("[OK] nada a aplicar."); process.exit(0); }
if (!aplicar) { console.log("\n(simulação: use --aplicar para fazer backup e aplicar)"); process.exit(0); }

const perigosas = pendentes.filter((f) => risco(readFileSync(join(dir, f), "utf8")));
if (perigosas.length && !aceitoDestrutivo) { console.error(`\n[PARADO] ${perigosas.length} migration(s) com DROP/TRUNCATE/DELETE: confirme com o responsável e rode de novo com --aceito-destrutivo.`); process.exit(2); }

console.log("\nBackup da produção antes de aplicar…");
const b = spawnSync(process.execPath, [fileURLToPath(new URL("./backup-projeto.mjs", import.meta.url))], { stdio: "inherit", env: process.env });
if (b.status !== 0) { console.error("[FALHA] backup não concluiu; nenhuma migration foi aplicada."); process.exit(1); }

for (const f of pendentes) {
  const name = f.replace(/\.sql$/, "");
  const r = await api("/database/migrations", { method: "POST", body: JSON.stringify({ query: readFileSync(join(dir, f), "utf8"), name }) });
  const t = await r.text();
  if (r.status >= 300) { console.error(`[FALHA] ${name} (HTTP ${r.status}): ${t.slice(0, 600)}\nAs anteriores ficaram aplicadas; esta foi desfeita (transação).`); process.exit(1); }
  console.log(`[OK] ${name}`);
}
console.log(`\n[OK] ${pendentes.length} migration(s) aplicada(s) na produção.`);
