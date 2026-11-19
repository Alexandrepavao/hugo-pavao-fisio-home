// Edge Function `org-export` — exportação administrativa dos dados de UMA organização (portabilidade). Só o GESTOR da própria organização pede (verify_jwt + checagem no banco); a plataforma não lê dados de clínica.
// Pacote .zip: manifest.json (versão do schema, contagens, hashes, o que ficou de fora e por quê) + data/<tabela>.ndjson + files.json (inventário de arquivos) + LEIA-ME.txt.
// Construção consistente (uma única instrução SQL = um snapshot). Sem senhas, tokens ou chaves. Download por URL assinada CURTA, registrado em auditoria.
// Arquivos do Storage: só o inventário (os binários saem por link assinado sob demanda; não vão no pacote).
import { createClient } from "npm:@supabase/supabase-js@2";
import { zipSync, strToU8 } from "npm:fflate@0.8.2";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const env = (k: string) => Deno.env.get(k) ?? "";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha256 = async (b: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", b))).map((x) => x.toString(16).padStart(2, "0")).join("");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "método não permitido" }, 405);
  const auth = req.headers.get("Authorization") ?? ""; if (!auth.startsWith("Bearer ")) return json({ error: "não autenticado" }, 401);
  const body = await req.json().catch(() => ({})) as { action?: string; export_id?: string };
  const url = env("SUPABASE_URL");
  const asUser = createClient(url, env("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } });
  const svc = createClient(url, env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });

  if (body.action === "download") {                                      // nova URL assinada para uma exportação já pronta (do próprio gestor)
    if (!UUID.test(body.export_id ?? "")) return json({ error: "exportação inválida" }, 400);
    const list = await asUser.rpc("org_export_list"); if (list.error) return json({ error: "sem permissão" }, 403);
    if (!(list.data as { id: string }[]).some((x) => x.id === body.export_id)) return json({ error: "exportação não encontrada" }, 404);
    const log = await svc.rpc("org_export_download_logged", { p_export: body.export_id }); if (log.error) return json({ error: "exportação indisponível ou expirada" }, 410);
    const signed = await svc.storage.from("org-exports").createSignedUrl((log.data as { path: string }).path, 600);
    if (signed.error) return json({ error: "não foi possível gerar o link" }, 500);
    return json({ url: signed.data.signedUrl, expires_in: 600 });
  }

  const reqd = await asUser.rpc("org_export_request"); if (reqd.error) return json({ error: reqd.error.code === "42501" ? "sem permissão" : "não foi possível iniciar" }, reqd.error.code === "42501" ? 403 : 400);
  const { id, org_id } = reqd.data as { id: string; org_id: string };
  const fail = async (code: string) => { await svc.rpc("org_export_done", { p_export: id, p_status: "failed", p_path: null, p_size: null, p_sha: null, p_counts: {}, p_schema: null, p_error: code }); return json({ status: "failed", code }, 500); };
  const run = await svc.rpc("org_export_run", { p_export: id });
  if (run.error) { console.error("org-export:run", run.error.code); return await fail(run.error.message?.includes("grande demais") ? "organizacao_grande" : "run_failed"); }
  const r = run.data as { data: Record<string, unknown[]>; counts: Record<string, number>; schema_version: string; excluded: { table: string; reason: string }[]; files: unknown[] };

  const files: Record<string, Uint8Array> = {}; const hashes: Record<string, string> = {};
  for (const [table, rows] of Object.entries(r.data)) {
    const nd = strToU8(rows.map((x) => JSON.stringify(x)).join("\n") + (rows.length ? "\n" : "")); files[`data/${table}.ndjson`] = nd; hashes[`data/${table}.ndjson`] = await sha256(nd);
  }
  const inv = strToU8(JSON.stringify(r.files, null, 2)); files["files.json"] = inv; hashes["files.json"] = await sha256(inv);
  const manifest = {
    format: "hp-org-export", format_version: 1, org_id, export_id: id, generated_at: new Date().toISOString(), schema_version: r.schema_version, tables: Object.keys(r.data).length,
    rows_total: Object.values(r.counts).reduce((a, b) => a + b, 0), counts: r.counts, sha256: hashes, excluded: r.excluded, files_inventory: "files.json",
    notes: ["Dados de UMA organização; identificadores e relações (UUID) preservados.", "Sem senhas, tokens, chaves ou dados de outras organizações; finanças pessoais de usuários não entram.", "Arquivos do Storage: apenas o inventário; solicite os links assinados.", "Exportar dados não entrega o aplicativo: a migração para infraestrutura própria é um serviço separado."],
  };
  files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  files["LEIA-ME.txt"] = strToU8("Exportação de dados (HP Group Hub)\n\n- manifest.json: versão do schema, contagens por tabela e SHA-256 de cada arquivo.\n- data/*.ndjson: uma linha JSON por registro.\n- files.json: inventário de arquivos privados.\nPara verificar a integridade, recalcule o SHA-256 de cada arquivo e compare com o manifesto.\n");
  const zip = zipSync(files, { level: 6 }); const zhash = await sha256(zip); const path = `${org_id}/${id}.zip`;
  const up = await svc.storage.from("org-exports").upload(path, zip, { contentType: "application/zip", upsert: true });
  if (up.error) { console.error("org-export:upload", up.error.message?.slice(0, 80)); return await fail("upload_failed"); }
  await svc.rpc("org_export_done", { p_export: id, p_status: "ready", p_path: path, p_size: zip.length, p_sha: zhash, p_counts: r.counts, p_schema: r.schema_version, p_error: null });
  const log = await svc.rpc("org_export_download_logged", { p_export: id }); if (log.error) return await fail("log_failed");
  const signed = await svc.storage.from("org-exports").createSignedUrl(path, 600);
  if (signed.error) return json({ status: "ready", id, message: "pronto; gere o link de download novamente" });
  return json({ status: "ready", id, url: signed.data.signedUrl, expires_in: 600, size_bytes: zip.length, sha256: zhash, tables: manifest.tables, rows_total: manifest.rows_total });
});
