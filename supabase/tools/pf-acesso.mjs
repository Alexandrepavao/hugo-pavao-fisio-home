// Concede, revoga ou lista o acesso às FINANÇAS PESSOAIS (apenas o banco DEV; recusa a produção).
//   SUPABASE_ACCESS_TOKEN=... node supabase/tools/pf-acesso.mjs --listar
//   node supabase/tools/pf-acesso.mjs --email=pessoa@exemplo.com [--ligar-recurso]        concede
//   node supabase/tools/pf-acesso.mjs --email=pessoa@exemplo.com --revogar               revoga (efeito imediato)
// O acesso é individual: ser gestor NÃO basta. O app não tem tela para conceder acesso de propósito — só a operação, por esta ferramenta (ou SQL), conforme docs/financas-pessoais.md.
// `--ligar-recurso` liga o recurso `personal_finance` na organização da pessoa (habilitação por organização); sem ele a pessoa só passa a ter acesso quando o recurso já estiver ligado.
const DEV = "fsvtzowcwhvwtluwrhnb"; const PROD = "wfqkjrpqkaarpavjheoj";
const ref = process.env.SUPABASE_PROJECT_REF ?? DEV;
if (ref === PROD) { console.error("Recusado: esta ferramenta só roda no banco Dev."); process.exit(1); }
const token = process.env.SUPABASE_ACCESS_TOKEN; if (!token) { console.error("Defina SUPABASE_ACCESS_TOKEN (variável do usuário do Windows)."); process.exit(1); }
const arg = (n) => process.argv.find((a) => a === `--${n}` || a.startsWith(`--${n}=`)); const val = (n) => arg(n)?.split("=").slice(1).join("=");
const sql = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ query }) });
  const t = await r.text(); if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 300)}`); return JSON.parse(t);
};
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

if (arg("listar")) {
  const rows = await sql(`select u.email, a.granted_at, a.revoked_at, coalesce((o.features ->> 'personal_finance')::boolean, false) recurso_ligado from public.pf_access a join auth.users u on u.id = a.user_id join public.organizations o on o.id = a.org_id order by a.granted_at`);
  console.table(rows.map((r) => ({ email: r.email, concedido: r.granted_at?.slice(0, 10), revogado: r.revogado ?? r.revoked_at?.slice(0, 10) ?? "", recurso_na_org: r.recurso_ligado })));
  process.exit(0);
}
const email = val("email")?.trim().toLowerCase();
if (!email) { console.error("Informe --email=... (ou --listar)."); process.exit(1); }
const u = await sql(`select ua.user_id, ua.org_id, ua.status from public.user_accounts ua join auth.users au on au.id = ua.user_id where lower(au.email) = ${lit(email)}`);
if (!u.length) { console.error(`Nenhuma conta com o e-mail ${email} (a pessoa precisa ter feito o primeiro acesso).`); process.exit(1); }
const { user_id, org_id, status } = u[0]; if (status !== "active") { console.error("A conta está suspensa."); process.exit(1); }
if (arg("revogar")) {
  await sql(`update public.pf_access set revoked_at = now() where user_id = ${lit(user_id)} and org_id = ${lit(org_id)} and revoked_at is null`);
  console.log(`Acesso REVOGADO para ${email}.`); process.exit(0);
}
if (arg("ligar-recurso")) await sql(`update public.organizations set features = features || '{"personal_finance": true}'::jsonb where id = ${lit(org_id)}`);
await sql(`insert into public.pf_access (org_id, user_id, granted_note) values (${lit(org_id)}, ${lit(user_id)}, 'concedido pela ferramenta pf-acesso') on conflict (org_id, user_id) do update set revoked_at = null, granted_at = now()`);
const on = (await sql(`select coalesce((features ->> 'personal_finance')::boolean, false) v from public.organizations where id = ${lit(org_id)}`))[0].v;
console.log(`Acesso CONCEDIDO para ${email}. Recurso ligado na organização: ${on ? "sim" : "NÃO (use --ligar-recurso)"}.`);
