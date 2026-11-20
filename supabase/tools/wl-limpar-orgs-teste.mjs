// Remove do DEV organizações de TESTE do white label (nunca produção, nunca a HP). Só apaga organizações criadas por provisionamento cujo endereço (slug) começa com um prefixo de teste.
//   node supabase/tools/wl-limpar-orgs-teste.mjs teste- fila- alfa- beta- gama- clinica-delta     (sem argumentos: nada a fazer)
// Argumento terminado em hífen = prefixo de slug; sem hífen no fim = slug EXATO (e os seus sufixos numéricos de unicidade, ex.: clinica-delta, clinica-delta-2).
// Como funciona: para cada tabela do schema public com coluna org_id apaga as linhas da organização com triggers desligados (session_replication_role=replica, só nesta transação do Dev) e, por fim, a organização,
// as solicitações de provisionamento e os usuários de teste "@example.test" criados para elas. Registra quantas linhas saíram de cada organização.
const DEV = "fsvtzowcwhvwtluwrhnb";
const token = process.env.SUPABASE_ACCESS_TOKEN; if (!token) throw new Error("Defina SUPABASE_ACCESS_TOKEN.");
const ref = process.env.SUPABASE_PROJECT_REF ?? DEV; if (ref !== DEV) throw new Error("Recusado: este script só roda no Dev.");
const prefixes = process.argv.slice(2).filter((p) => /^[a-z0-9]+(-[a-z0-9]+)*-?$/.test(p) && p !== "hp-group"); if (!prefixes.length) { console.log("Informe prefixos de slug de teste (ex.: teste- fila- clinica-delta)."); process.exit(0); }
const run = async (query) => { const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ query }) }); const t = await r.text(); if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 600)}`); return JSON.parse(t); };
const like = prefixes.map((p) => (p.endsWith("-") ? `o.slug like '${p}%'` : `(o.slug = '${p}' or o.slug ~ '^${p}-[0-9]+$')`)).join(" or ");
const orgs = await run(`select o.id, o.slug from public.organizations o where o.slug <> 'hp-group' and o.provisioning_request_id is not null and (${like})`);
if (!orgs.length) { console.log("Nenhuma organização de teste encontrada."); process.exit(0); }
for (const o of orgs) {
  const out = await run(`
    begin;
    set local session_replication_role = replica;
    do $$ declare t record; v_org uuid := '${o.id}'; n bigint; v_total bigint := 0;
    begin
      for t in select c.table_schema, c.table_name from information_schema.columns c join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
                where c.table_schema in ('public', 'private') and c.column_name = 'org_id' and c.table_name not in ('organizations') loop   -- inclui private (convites de administrador, eventos de e-mail): com o gatilho de cascata desligado, nada pode sobrar apontando para a organização removida
        execute format('delete from %I.%I where org_id = $1', t.table_schema, t.table_name) using v_org; get diagnostics n = row_count; v_total := v_total + n;
      end loop;
      delete from public.provisioning_requests where org_id = v_org;
      delete from public.organizations where id = v_org;
      delete from auth.users where email like '%@example.test' and id not in (select user_id from public.org_memberships) and id not in (select user_id from public.platform_admins);
      raise notice 'linhas removidas: %', v_total;
    end $$;
    commit; select 1 as ok;`);
  console.log(`[OK] ${o.slug} removida`, JSON.stringify(out).slice(0, 80));
}
