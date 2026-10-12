// Promove uma mudança do PREVIEW para a PRODUÇÃO, só se TODAS as verificações passarem (para na primeira falha).
//   node supabase/tools/promover.mjs --pr=<número> [--ate-preview] [--e2e=arquivo1,arquivo2] [--e2e-completo] [--aceito-destrutivo]
//
//   1. confere o Git e o PR (branch enviada, PR aberto contra a main, sem conflito)
//   2. typecheck · lint dos arquivos alterados · build
//   3. testes SQL de release (banco Dev)   — 0 falha, 0 teste sem relatório
//   4. testes E2E: os que a branch criou/alterou + o de login e rotas (ou --e2e=… / --e2e-completo)
//   5. publica o PREVIEW (site hp-group-hub, banco Dev) e confere a versão publicada
//   --ate-preview PARA AQUI (resultado: "passou, pronto para produção").
//   6. PRODUÇÃO: backup → migrations pendentes (parando se tiver DROP/TRUNCATE/DELETE sem --aceito-destrutivo) → merge do PR →
//      deploy a partir da main → confere o domínio (commit, ambiente production, banco de produção)
// Nunca toca em DNS. Requer SUPABASE_ACCESS_TOKEN, NETLIFY_AUTH_TOKEN, HP_QA_PASSWORD (variáveis do usuário do Windows) e `gh` logado.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const SITE_PROD = "324307d8-7697-4f3a-907f-95e572b5b77d"; const PROD_REF = "wfqkjrpqkaarpavjheoj"; const DOMINIO = "https://hpfisioterapia.com.br";
const arg = (n) => process.argv.find((a) => a === `--${n}` || a.startsWith(`--${n}=`)); const val = (n) => arg(n)?.split("=").slice(1).join("=");
const prNum = val("pr"); const ateVer = !!arg("ate-preview"); const completo = !!arg("e2e-completo"); const destrutivo = !!arg("aceito-destrutivo");
if (!prNum || !/^\d+$/.test(prNum)) { console.error("Informe o PR: node supabase/tools/promover.mjs --pr=<número>"); process.exit(1); }
for (const v of ["SUPABASE_ACCESS_TOKEN", "NETLIFY_AUTH_TOKEN", "HP_QA_PASSWORD"]) if (!process.env[v]) { console.error(`Falta a variável ${v}.`); process.exit(1); }

const sh = (cmd, capture = false) => spawnSync(cmd, { shell: true, encoding: "utf8", stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit", env: process.env });
const out = (cmd) => (sh(cmd, true).stdout ?? "").trim();
const feitos = []; let mesclado = false;
const falhar = (nome, msg) => {
  console.error(`\n[FALHA] ${nome}: ${msg}`); console.error(`\nRESULTADO: NÃO PROMOVIDO. Passos concluídos antes: ${feitos.join(" › ") || "nenhum"}.`);
  if (mesclado) console.error(`\nATENÇÃO: o PR #${prNum} JÁ FOI MESCLADO na main; a produção ainda NÃO recebeu esta versão. Para concluir: git checkout main && git pull --ff-only origin main && netlify deploy --prod --site ${SITE_PROD}`);
  process.exit(1);
};
const passo = async (nome, fn) => { console.log(`\n▶ ${nome}`); let nota; try { nota = await fn(); } catch (e) { falhar(nome, e.message); } feitos.push(nome); console.log(`  [OK] ${nome}${nota ? " — " + nota : ""}`); };
const exigir = (r, msg) => { if (r.status !== 0) throw new Error(msg); };

const branch = out("git branch --show-current");
await passo("Git e PR", () => {
  if (!branch || branch === "main") throw new Error("rode a partir da branch da mudança (não da main)");
  const sujo = out("git status --porcelain").split("\n").filter((l) => l && !l.includes(".claude/"));
  if (sujo.length) throw new Error(`há alterações não commitadas (${sujo.length}); faça commit antes`);
  sh("git fetch origin", true);
  const remoto = out(`git rev-parse origin/${branch}`); const local = out("git rev-parse HEAD");
  if (remoto !== local) throw new Error("a branch local não bate com a enviada ao GitHub; faça push");
  const pr = JSON.parse(out(`gh pr view ${prNum} --json state,headRefName,baseRefName,mergeable`));
  if (pr.state !== "OPEN") throw new Error(`o PR #${prNum} não está aberto (${pr.state})`);
  if (pr.baseRefName !== "main" || pr.headRefName !== branch) throw new Error(`o PR #${prNum} é de ${pr.headRefName} → ${pr.baseRefName}, e você está em ${branch}`);
  if (pr.mergeable === "CONFLICTING") throw new Error("o PR tem conflito com a main; resolva antes");
  return `${branch} · PR #${prNum}`;
});

// Mudança SÓ de documentação (docs/ e *.md na raiz): o site não muda, então não gasta build, testes, preview nem deploy; o PR é apenas mesclado.
const alteradosGit = out("git diff --name-only origin/main...HEAD").split("\n").filter(Boolean);
const soDocs = alteradosGit.length > 0 && alteradosGit.every((f) => /^docs\//.test(f) || /^[^/]+\.md$/.test(f));
if (soDocs) console.log("\nMudança SÓ de documentação: sem build, testes, preview nem deploy (o site não muda); o PR será apenas mesclado.");
const passoCodigo = (nome, fn) => (soDocs ? undefined : passo(nome, fn));

await passoCodigo("Typecheck", () => exigir(sh("npm run typecheck"), "o typecheck falhou"));
const alterados = out("git diff --name-only origin/main...HEAD").split("\n").filter(Boolean);
await passoCodigo("Lint dos arquivos alterados", () => {
  const arqs = alterados.filter((f) => /\.(tsx?|mjs|js)$/.test(f) && existsSync(f));
  if (!arqs.length) return "nenhum arquivo de código alterado";
  exigir(sh(`npx eslint ${arqs.map((f) => `"${f}"`).join(" ")}`), "o lint encontrou erros"); return `${arqs.length} arquivo(s)`;
});
await passoCodigo("Build", () => exigir(sh("npm run build"), "o build falhou"));
await passoCodigo("Testes SQL de release (Dev)", () => {
  const r = sh("node supabase/tests/run-sql.mjs supabase/tests/release", true);
  const m = /TOTAL: (\d+) OK, (\d+) FALHA, (\d+) teste\(s\) sem relatório/.exec(r.stdout ?? "");
  if (!m) throw new Error("não consegui ler o resultado dos testes SQL");
  if (m[2] !== "0" || m[3] !== "0") { console.log((r.stdout ?? "").split("\n").filter((l) => /FALHA|SEM RELAT/.test(l)).slice(0, 15).join("\n")); throw new Error(`${m[2]} falha(s) e ${m[3]} teste(s) sem relatório`); }
  return `${m[1]} verificações OK`;
});
await passoCodigo("Testes E2E", () => {
  if (completo) { exigir(sh('npx playwright test --grep "@release" --workers=1'), "há teste E2E falhando"); sh("git checkout -- docs/screenshots", true); return "suíte @release completa"; }
  const explicitos = (val("e2e") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const mudados = alterados.filter((f) => /^e2e\/.*\.spec\.ts$/.test(f) && existsSync(f));
  const lista = [...new Set([...(explicitos.length ? explicitos : mudados), "e2e/01-auth-and-routes.spec.ts"])];
  exigir(sh(`npx playwright test ${lista.map((f) => `"${f}"`).join(" ")} --workers=1`), "há teste E2E falhando");
  sh("git checkout -- docs/screenshots", true);   // os testes regeneram as capturas de tela (resultado de teste, não código); volta ao que está commitado
  return `${lista.length} arquivo(s): ${lista.map((f) => f.split("/").pop()).join(", ")}`;
});
await passoCodigo("Preview (site hp-group-hub, banco Dev)", () => { exigir(sh("node supabase/tools/preview.mjs"), "o preview não foi publicado"); });

if (ateVer && soDocs) { console.log(`\nRESULTADO: PASSOU (mudança só de documentação; nada a testar ou publicar). Para mesclar: node supabase/tools/promover.mjs --pr=${prNum}`); process.exit(0); }
if (ateVer) { console.log(`\nRESULTADO: PASSOU no preview. Pronto para produção (${feitos.length} verificações). Para publicar: node supabase/tools/promover.mjs --pr=${prNum}`); process.exit(0); }

const anterior = (await (await fetch(`https://api.netlify.com/api/v1/sites/${SITE_PROD}`, { headers: { authorization: `Bearer ${process.env.NETLIFY_AUTH_TOKEN}` } })).json()).published_deploy?.id;
await passoCodigo("Produção: backup e migrations", () => {
  const r = sh(`node supabase/tools/migrar-producao.mjs --aplicar${destrutivo ? " --aceito-destrutivo" : ""}`);
  if (r.status === 2) throw new Error("há migration com DROP/TRUNCATE/DELETE: precisa de confirmação explícita (--aceito-destrutivo)");
  exigir(r, "a aplicação das migrations falhou");
});
await passo("Merge do PR", () => { sh(`gh pr ready ${prNum}`, true); exigir(sh(`gh pr merge ${prNum} --merge`), "o merge falhou"); mesclado = true; });
await passoCodigo("Deploy da main em produção", () => {
  sh("git checkout -- docs/screenshots", true); sh("git fetch origin", true);
  exigir(sh("git checkout main"), "não consegui voltar para a main (há alterações locais que conflitam; veja acima)"); exigir(sh("git pull --ff-only origin main"), "não consegui atualizar a main");
  exigir(sh(`netlify deploy --prod --site ${SITE_PROD} --message "promover PR ${prNum}: ${out("git rev-parse --short HEAD")}"`), "o deploy falhou");
});
await passoCodigo("Conferência no domínio", async () => {
  const esperado = out("git rev-parse --short=12 HEAD"); let v;
  for (let i = 0; i < 6; i++) { try { v = await (await fetch(`${DOMINIO}/version.json?x=${Date.now()}`)).json(); if (v.commit === esperado) break; } catch { /* tenta de novo */ } await new Promise((r) => setTimeout(r, 5000)); }
  if (!v || v.commit !== esperado) throw new Error(`o domínio mostra ${v?.commit ?? "nada"}, esperado ${esperado}`);
  if (v.environment !== "production" || v.backendRef !== PROD_REF) throw new Error(`versão inesperada: ${JSON.stringify(v)}`);
  return `commit ${v.commit}, ambiente ${v.environment}, banco de produção`;
});
if (soDocs) { sh("git checkout main", true); sh("git pull --ff-only origin main", true); console.log("\nRESULTADO: MESCLADO (mudança só de documentação; a produção não precisou de novo deploy)."); process.exit(0); }
console.log(`\nRESULTADO: PROMOVIDO para produção (${DOMINIO}).`);
if (anterior) console.log(`Para VOLTAR o site ao deploy anterior: painel Netlify › hp-group-hub-producao › Deploys › ${anterior} › Publish deploy. (Migrations são aditivas: não precisam ser desfeitas; o backup está em D:\\Claude\\backups-hp-group.)`);
