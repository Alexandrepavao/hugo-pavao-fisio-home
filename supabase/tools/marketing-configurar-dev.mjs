// Configura NO DEV os segredos INTERNOS do Marketing (os que o projeto gera sozinho) e o Vault da sincronização horária. NUNCA imprime valores.
//   node supabase/tools/marketing-configurar-dev.mjs [--return-url=https://preview--hp-group-hub.netlify.app]
// • MKT_TOKEN_ENC_KEY (32 bytes): criada UMA vez; nunca é sobrescrita (trocar a chave invalidaria os tokens já guardados).
// • MKT_SYNC_SECRET + Vault (marketing_sync_url / marketing_sync_secret): gerados juntos para a sincronização horária.
// • MKT_RETURN_URL: origem do app para onde o usuário volta depois do OAuth (só se ainda não existir).
// NÃO cria META_APP_ID/META_APP_SECRET nem GOOGLE_ADS_CLIENT_ID/SECRET: esses vêm dos painéis da Meta e do Google e são cadastrados por quem tem acesso
// (Supabase → Edge Functions → Secrets). Ver docs/marketing-conexao-meta-google.md.
import { randomBytes } from "node:crypto";

const DEV = "fsvtzowcwhvwtluwrhnb"; const PROD = "wfqkjrpqkaarpavjheoj";
const ref = process.env.SUPABASE_PROJECT_REF ?? DEV; if (ref === PROD) throw new Error("Recusado: este script nunca roda contra a produção.");
const token = process.env.SUPABASE_ACCESS_TOKEN; if (!token) throw new Error("Defina SUPABASE_ACCESS_TOKEN.");
const returnUrl = (process.argv.find((a) => a.startsWith("--return-url=")) ?? "--return-url=https://preview--hp-group-hub.netlify.app").split("=")[1].replace(/\/+$/, "");
if (!/^https?:\/\/[a-z0-9.:-]+$/i.test(returnUrl)) throw new Error("--return-url inválida (use só a origem, sem caminho).");
const api = (path, opt = {}) => fetch(`https://api.supabase.com/v1/projects/${ref}${path}`, { headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...opt });
const sql = async (query) => { const r = await api("/database/query", { method: "POST", body: JSON.stringify({ query }) }); const t = await r.text(); if (r.status >= 300) throw new Error(`SQL falhou (HTTP ${r.status}): ${t.slice(0, 300)}`); return JSON.parse(t); };

const existing = new Set(((await (await api("/secrets")).json()) ?? []).map((s) => s.name));
const set = [];
if (!existing.has("MKT_TOKEN_ENC_KEY")) set.push({ name: "MKT_TOKEN_ENC_KEY", value: randomBytes(32).toString("base64") });
if (!existing.has("MKT_RETURN_URL")) set.push({ name: "MKT_RETURN_URL", value: returnUrl });
const vault = await sql("select name from vault.secrets where name in ('marketing_sync_url','marketing_sync_secret')");
const needSync = !existing.has("MKT_SYNC_SECRET") || vault.length < 2;
let syncSecret = null; if (needSync) { syncSecret = randomBytes(32).toString("hex"); set.push({ name: "MKT_SYNC_SECRET", value: syncSecret }); }
if (set.length) { const r = await api("/secrets", { method: "POST", body: JSON.stringify(set) }); if (r.status >= 300) throw new Error(`secrets falhou (HTTP ${r.status})`); }
if (needSync) {
  const url = `https://${ref}.supabase.co/functions/v1/marketing-ads/sync`;
  for (const [name, value, desc] of [["marketing_sync_url", url, "URL da função de sincronização do Marketing"], ["marketing_sync_secret", syncSecret, "Segredo da sincronização horária do Marketing"]]) {
    await sql(`do $$ declare v uuid; begin select id into v from vault.secrets where name = '${name}'; if v is null then perform vault.create_secret('${value}', '${name}', '${desc}'); else perform vault.update_secret(v, '${value}', '${name}', '${desc}'); end if; end $$;`);
  }
}
const have = (await (await api("/secrets")).json()).map((s) => s.name);
console.log(`[OK] segredos internos do Marketing no Dev: ${["MKT_TOKEN_ENC_KEY", "MKT_SYNC_SECRET", "MKT_RETURN_URL"].map((n) => `${n}=${have.includes(n) ? "definido" : "FALTA"}`).join(" · ")}`);
console.log(`     criados agora: ${set.map((s) => s.name).join(", ") || "nenhum (já existiam)"} · Vault: sincronização ${needSync ? "configurada agora" : "já configurada"}`);
console.log(`     AINDA FALTAM (vêm da Meta/Google): ${["META_APP_ID", "META_APP_SECRET", "GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET"].filter((n) => !have.includes(n)).join(", ") || "nada"}`);
