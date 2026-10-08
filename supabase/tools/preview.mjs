// Publica o PREVIEW fixo: build do que está nesta pasta com o perfil da produção (v1) e o banco DEV, no site hp-group-hub, com endereço estável.
//   npm run preview:publicar [-- --alias=nome]      (padrão: https://preview--hp-group-hub.netlify.app)
// É um deploy de RASCUNHO (nunca vai para o endereço principal nem para o domínio), protegido por login da equipe Netlify.
// Confere o que foi gerado (dist/version.json): ambiente "preview", banco Dev, perfil v1. Se algo estiver fora, falha.
// Requer NETLIFY_AUTH_TOKEN (variável do usuário do Windows).
import { execSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const SITE_PREVIEW = "2c2d11bc-f62c-42b7-bae6-4cf3b6f35756";   // hp-group-hub (NUNCA o site de produção)
const DEV_REF = "fsvtzowcwhvwtluwrhnb";
const alias = (process.argv.find((a) => a.startsWith("--alias=")) ?? "--alias=preview").split("=")[1];
if (!/^[a-z0-9-]{2,30}$/.test(alias)) throw new Error("alias inválido (use letras minúsculas, números e hífen)");
if (!process.env.NETLIFY_AUTH_TOKEN) throw new Error("Defina NETLIFY_AUTH_TOKEN (variável de usuário do Windows).");

const git = (c) => { try { return execSync(`git ${c}`, { encoding: "utf8" }).trim(); } catch { return ""; } };
const commit = git("rev-parse --short=12 HEAD"); const branch = git("branch --show-current");
const dirty = git("status --porcelain").split("\n").filter((l) => l && !l.includes(".claude/")).length > 0;
if (dirty) console.log("AVISO: há alterações não commitadas; o preview mostra o que está nesta pasta (não só o commit).");

const msg = `preview ${branch}@${commit}${dirty ? "+alteracoes" : ""}`;
const r = spawnSync("netlify", ["deploy", "--build", "--context", "preview", "--alias", alias, "--site", SITE_PREVIEW, "--message", `"${msg}"`], { encoding: "utf8", shell: true, env: process.env });
const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
if (r.status !== 0) { console.error(out.split("\n").filter((l) => /error|Error|recusado|failed/.test(l)).slice(0, 8).join("\n") || out.slice(-1500)); console.error("\n[FALHA] o preview não foi publicado."); process.exit(1); }

const v = JSON.parse(readFileSync("dist/version.json", "utf8"));
const bad = [];
if (v.environment !== "preview") bad.push(`ambiente=${v.environment} (esperado preview)`);
if (v.backendRef !== DEV_REF) bad.push(`banco=${v.backendRef} (esperado o Dev)`);
if (v.profile !== "v1") bad.push(`perfil=${v.profile} (esperado v1)`);
if (bad.length) { console.error(`[FALHA] build fora do esperado: ${bad.join("; ")}`); process.exit(1); }
const url = (out.match(/https:\/\/[a-z0-9-]+--hp-group-hub\.netlify\.app/i) ?? [`https://${alias}--hp-group-hub.netlify.app`])[0];
console.log(`[OK] PREVIEW publicado: ${url}\n     commit ${v.commit} · perfil ${v.profile} · ambiente ${v.environment} · banco ${v.backend} (${v.backendRef})\n     (acesso: login da equipe Netlify; dados: banco Dev, nunca produção)`);
