// Exportação (backup lógico) dos DADOS de um projeto Supabase do HP Group — para quem está no plano Free, que não tem backup automático.
//   SUPABASE_ACCESS_TOKEN=... node supabase/tools/backup-projeto.mjs [--ref <projeto>] [--out <pasta>]
// Padrão: projeto de PRODUÇÃO (HP Group Core) e pasta D:\Claude\backups-hp-group (FORA do repositório: os arquivos têm dados reais de pessoas).
// SOMENTE LEITURA: só faz SELECT pela Management API; nada é gravado no banco.
// Gera, numa pasta datada: um JSON por tabela, auth-users.json (e-mail e datas; NUNCA senha), storage-objects.json (lista, não os arquivos),
// migrations.json, manifest.json (contagens e SHA-256) e restaurar.sql (reinsere tudo em ordem de dependência, sem disparar auditoria/eventos).
// O que NÃO entra: senhas/sessões (quem perder o acesso recebe novo convite), o conteúdo binário do Storage, segredos e configuração do Auth.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PROD = "wfqkjrpqkaarpavjheoj";
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const ref = arg("--ref", PROD);
const base = resolve(arg("--out", "D:\\Claude\\backups-hp-group"));
const repo = resolve(fileURLToPath(new URL("../..", import.meta.url)));
if (base === repo || base.startsWith(repo + sep)) throw new Error("Recusado: a pasta de saída está dentro do repositório (os backups têm dados reais). Use --out com outra pasta.");
const token = process.env.SUPABASE_ACCESS_TOKEN; if (!token) throw new Error("Defina SUPABASE_ACCESS_TOKEN (variável de usuário do Windows).");

const q = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ query }) });
  const t = await r.text(); if (!r.ok) throw new Error(`consulta falhou (HTTP ${r.status}): ${t.slice(0, 300)}`);
  return JSON.parse(t);
};
const qi = (s) => `"${s.replace(/"/g, '""')}"`;
const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
const proj = (await (await fetch(`https://api.supabase.com/v1/projects/${ref}`, { headers: { authorization: `Bearer ${token}` } })).json());
const dir = join(base, `${stamp}-${ref === PROD ? "producao-core" : ref}`); mkdirSync(dir, { recursive: true });
const manifest = { projeto: ref, nome: proj.name ?? null, gerado_em: new Date().toISOString(), tabelas: {}, arquivos: {} };
const save = (nome, conteudo) => { writeFileSync(join(dir, nome), conteudo, "utf8"); manifest.arquivos[nome] = createHash("sha256").update(conteudo).digest("hex"); };

// 1) tabelas públicas com dados
const tabelas = (await q(`select c.relname n, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', c.relname), false, true, '')))[1]::text::int cnt
  from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r' order by 1`));
const comDados = tabelas.filter((t) => t.cnt > 0);

// 2) ordem de dependência (chaves estrangeiras): pais antes dos filhos; ciclos caem no fim
const fks = await q(`select c.conrelid::regclass::text filho, c.confrelid::regclass::text pai from pg_constraint c where c.contype = 'f' and c.connamespace = 'public'::regnamespace and c.conrelid <> c.confrelid`);
const nomes = new Set(comDados.map((t) => t.n)); const dep = new Map([...nomes].map((n) => [n, new Set()]));
for (const f of fks) { const filho = f.filho.replace(/^public\./, "").replace(/"/g, ""), pai = f.pai.replace(/^public\./, "").replace(/"/g, ""); if (nomes.has(filho) && nomes.has(pai)) dep.get(filho).add(pai); }
const ordem = []; const feito = new Set();
while (ordem.length < nomes.size) { const pronto = [...nomes].filter((n) => !feito.has(n) && [...dep.get(n)].every((p) => feito.has(p))); const lote = pronto.length ? pronto : [...nomes].filter((n) => !feito.has(n)); for (const n of lote.sort()) { ordem.push(n); feito.add(n); } }

// 3) dados (páginas de 500 linhas por ctid, para tabelas grandes)
const PAGINA = 500; const inserts = [];
for (const t of ordem) {
  const total = comDados.find((x) => x.n === t).cnt; const linhas = [];
  for (let off = 0; off < total; off += PAGINA) {
    const r = await q(`select coalesce(json_agg(x), '[]'::json) j from (select * from public.${qi(t)} order by ctid limit ${PAGINA} offset ${off}) x`);
    linhas.push(...r[0].j);
  }
  if (linhas.length !== total) throw new Error(`${t}: esperadas ${total} linhas e lidas ${linhas.length} (a tabela mudou durante a exportação; rode de novo)`);
  save(`tabela-${t}.json`, JSON.stringify(linhas)); manifest.tabelas[t] = linhas.length;
  inserts.push(`alter table public.${qi(t)} disable trigger user;\ninsert into public.${qi(t)} overriding system value select * from jsonb_populate_recordset(null::public.${qi(t)}, $hpbk$${JSON.stringify(linhas)}$hpbk$::jsonb);\nalter table public.${qi(t)} enable trigger user;`);
}

// 4) usuários de login (sem senha), arquivos do Storage (só a lista) e histórico de migrations
save("auth-users.json", JSON.stringify(await q(`select id, email, created_at, email_confirmed_at, last_sign_in_at, raw_user_meta_data from auth.users order by created_at`), null, 1));
save("storage-objects.json", JSON.stringify(await q(`select bucket_id, name, created_at, metadata from storage.objects order by bucket_id, name`), null, 1));
save("migrations.json", JSON.stringify(await (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/migrations`, { headers: { authorization: `Bearer ${token}` } })).json(), null, 1));

// 5) restaurar.sql
save("restaurar.sql", `-- Restauração dos dados do projeto ${ref} (${proj.name ?? ""}) exportados em ${manifest.gerado_em}.
-- PRÉ-REQUISITOS: o schema já existe (migrations aplicadas até a versão deste backup) e as tabelas abaixo estão VAZIAS.
-- Os usuários de login (auth.users) não são restaurados por aqui: user_accounts.user_id precisa existir em auth.users (recrie por convite/primeiro acesso ou restaure auth.users antes).
-- Rode tudo de uma vez (uma transação): em caso de erro nada é gravado.
${inserts.join("\n\n")}

-- sequências (id automático) continuam depois do maior id restaurado
do $$ declare r record; m bigint; begin
  for r in select c.relname t, a.attname col, pg_get_serial_sequence(format('public.%I', c.relname), a.attname) seq
           from pg_class c join pg_namespace s on s.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
          where s.nspname = 'public' and c.relkind = 'r' and pg_get_serial_sequence(format('public.%I', c.relname), a.attname) is not null loop
    execute format('select max(%I) from public.%I', r.col, r.t) into m;
    if m is not null then perform setval(r.seq, m); end if;
  end loop;
end $$;
`);

manifest.total_linhas = Object.values(manifest.tabelas).reduce((a, b) => a + b, 0);
save("manifest.json", JSON.stringify(manifest, null, 1));
writeFileSync(join(dir, "LEIA-ME.txt"), `BACKUP LÓGICO DE DADOS — ${proj.name ?? ref} (${ref})\nGerado em ${manifest.gerado_em}\nTabelas com dados: ${ordem.length} | linhas: ${manifest.total_linhas}\n\nContém dados reais de pessoas: guarde fora do Git e de nuvens públicas.\nNão contém: senhas, sessões, arquivos do Storage (só a lista), segredos/configuração do Auth.\nRestaurar: ver comentários no início de restaurar.sql (schema pelas migrations + tabelas vazias; rodar o arquivo inteiro numa transação).\nConferir integridade: SHA-256 de cada arquivo em manifest.json.\n`, "utf8");
console.log(`OK: ${dir}\n  tabelas com dados: ${ordem.length} | linhas: ${manifest.total_linhas}`);
for (const [t, n] of Object.entries(manifest.tabelas)) console.log(`  ${String(n).padStart(6)}  ${t}`);
