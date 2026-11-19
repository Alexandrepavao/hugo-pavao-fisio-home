import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/org/OrgProvider";
import { getActiveOrg, brandLogoUrl } from "@/lib/org";
import { fmtDateTime } from "@/lib/format";
import { Badge, btnGhost, btnPrimary, errText, inputCls, Msg, PageHead, State, Table, Tabs, Td, useMsg } from "@/lib/ui";
import UsageView, { type UsageData } from "@/pages/plataforma/UsageView";

interface ExportRow { id: string; status: string; created_at: string; expires_at: string | null; size_bytes: number | null; sha256: string | null; downloads: number; counts: Record<string, number> | null }
const hexOk = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);

const BrandTab = () => {
  const org = useOrg(); const [msg, m] = useMsg(); const [busy, setBusy] = useState(false);
  const b = org.brand;
  const [f, setF] = useState({ app_name: b?.name ?? "", color_primary: b?.color_primary ?? "#1b3350", color_accent: b?.color_accent ?? "#a6873f", color_ink: b?.color_ink ?? "#14283d", support_email: b?.support_email ?? "", website_url: b?.website_url ?? "" });
  const save = async (patch: Record<string, unknown>) => {
    setBusy(true); const { error } = await supabase.rpc("org_settings_save", { p_patch: patch }); setBusy(false);
    if (error) return m.err(errText(error)); m.ok("Marca salva."); await org.refresh();
  };
  const upload = async (file: File) => {
    const orgId = org.ctx?.org?.id; if (!orgId) return;
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type) || file.size > 1024 * 1024) return m.err("Envie uma imagem PNG, JPG, WebP ou SVG de até 1 MB.");
    const ext = file.type === "image/svg+xml" ? "svg" : file.type.split("/")[1]; const path = `${orgId}/logo-${Date.now()}.${ext}`;
    setBusy(true); const up = await supabase.storage.from("org-brand").upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) { setBusy(false); return m.err("Não foi possível enviar o logotipo."); }
    await save({ logo_path: path });
  };
  return (
    <div className="max-w-2xl"><Msg m={msg} />
      <div className="hp-card p-5 grid gap-4">
        <label className="text-sm block"><span className="block font-medium mb-1">Nome do aplicativo</span><input className={inputCls} value={f.app_name} onChange={(e) => setF({ ...f, app_name: e.target.value })} /></label>
        <div className="grid gap-4 sm:grid-cols-3">{(["color_primary", "color_accent", "color_ink"] as const).map((k) => (
          <label key={k} className="text-sm block"><span className="block font-medium mb-1">{{ color_primary: "Cor principal", color_accent: "Cor de destaque", color_ink: "Cor do texto" }[k]}</span><input type="color" className="h-10 w-full rounded border border-border" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>))}</div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm block"><span className="block font-medium mb-1">E-mail de suporte</span><input type="email" className={inputCls} value={f.support_email} onChange={(e) => setF({ ...f, support_email: e.target.value })} /></label>
          <label className="text-sm block"><span className="block font-medium mb-1">Site</span><input className={inputCls} value={f.website_url} onChange={(e) => setF({ ...f, website_url: e.target.value })} /></label></div>
        <div className="flex items-center gap-4">{brandLogoUrl(b?.logo_path) && <img src={brandLogoUrl(b?.logo_path)!} alt="Logotipo atual" className="h-12 w-auto border border-border rounded p-1 bg-white" />}
          <label className="text-sm"><span className="block font-medium mb-1">Logotipo (PNG, JPG, WebP, SVG · até 1 MB)</span><input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" disabled={busy} onChange={(e) => { const x = e.target.files?.[0]; if (x) void upload(x); }} /></label></div>
        <div><button className={btnPrimary} disabled={busy || !hexOk(f.color_primary) || !hexOk(f.color_accent) || !hexOk(f.color_ink)} onClick={() => void save({ app_name: f.app_name, color_primary: f.color_primary, color_accent: f.color_accent, color_ink: f.color_ink, support_email: f.support_email, website_url: f.website_url })}>Salvar marca</button></div>
        <p className="text-xs text-muted-foreground">A marca vale só para esta organização: o e-mail, o login e o aplicativo passam a usar nome, logotipo e cores acima. O endereço de acesso é configurado pela plataforma.</p>
      </div>
    </div>
  );
};

const UsageTab = () => {
  const org = useOrg(); const q = useQuery({ queryKey: ["org-usage", getActiveOrg()], queryFn: async () => { const { data, error } = await supabase.rpc("org_usage"); if (error) throw error; return data as UsageData; } });
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="hp-card p-4" aria-label="Módulos habilitados"><h3 className="font-semibold mb-2">Módulos habilitados</h3>
        <p className="text-xs text-muted-foreground mb-2">Quem habilita ou desabilita módulos é a plataforma. Desabilitar nunca apaga dados.</p>
        <ul className="flex flex-wrap gap-1.5">{(org.ctx?.modules ?? []).map((k) => <li key={k}><Badge tone="info">{k}</Badge></li>)}</ul></section>
      <section className="hp-card p-4" aria-label="Consumo e limites"><h3 className="font-semibold mb-2">Consumo e limites do plano</h3><State loading={q.isLoading} error={q.error} />{q.data && <UsageView data={q.data} />}</section>
    </div>
  );
};

const ExportTab = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ["org-exports", getActiveOrg()], queryFn: async () => { const { data, error } = await supabase.rpc("org_export_list"); if (error) throw error; return data as ExportRow[]; } });
  const call = async (body: Record<string, unknown>) => {
    const org = getActiveOrg();
    return supabase.functions.invoke("org-export", { body, headers: org ? { "x-org": org } : undefined });
  };
  const open = (url: string) => { window.location.assign(url); };
  const create = async () => {
    setBusy(true); const { data, error } = await call({});
    setBusy(false);
    if (error || data?.status === "failed") return m.err(data?.code === "organizacao_grande" ? "A organização é grande demais para exportação em um passo; fale com a plataforma." : "Não foi possível gerar a exportação.");
    m.ok(`Exportação pronta (${data.tables} tabelas, ${data.rows_total} registros). O download começa em seguida; o link vale 10 minutos.`); await qc.invalidateQueries({ queryKey: ["org-exports"] }); if (data.url) open(data.url);
  };
  const again = async (id: string) => { setBusy(true); const { data, error } = await call({ action: "download", export_id: id }); setBusy(false); if (error || !data?.url) return m.err("Exportação indisponível ou expirada."); await qc.invalidateQueries({ queryKey: ["org-exports"] }); open(data.url); };
  return (
    <div><Msg m={msg} />
      <div className="hp-card p-4 mb-5 max-w-3xl text-sm">
        <p className="mb-2">Gera um pacote <strong>.zip</strong> com os dados <strong>desta organização</strong> (registros em NDJSON, manifesto com contagens e SHA-256, inventário de arquivos). Não inclui senhas, tokens nem dados de outras organizações. O download é registrado em auditoria e o link expira em 10 minutos.</p>
        <p className="text-xs text-muted-foreground mb-3">Exportar dados não entrega o aplicativo: migrar para infraestrutura própria é um serviço separado.</p>
        <button className={btnPrimary} disabled={busy} onClick={() => void create()} data-testid="gerar-exportacao"><Download size={15} className="mr-1" />{busy ? "Gerando…" : "Gerar exportação"}</button>
      </div>
      <State loading={q.isLoading} error={q.error} empty={q.data?.length === 0} emptyText="Nenhuma exportação gerada." />
      {q.data && q.data.length > 0 && <Table head={["Gerada em", "Estado", "Tamanho", "Downloads", "Validade", ""]}>{q.data.map((e) => <tr key={e.id}><Td>{fmtDateTime(e.created_at)}</Td><Td><Badge tone={e.status === "ready" ? "success" : e.status === "failed" ? "danger" : "info"}>{e.status === "ready" ? "pronta" : e.status === "failed" ? "falhou" : "em preparo"}</Badge></Td>
        <Td num>{e.size_bytes ? `${Math.max(1, Math.round(e.size_bytes / 1024))} KB` : "—"}</Td><Td num>{e.downloads}</Td><Td>{e.expires_at ? fmtDateTime(e.expires_at) : "—"}</Td>
        <Td>{e.status === "ready" && e.expires_at && new Date(e.expires_at) > new Date() && <button className={btnGhost + " h-8 text-xs"} disabled={busy} onClick={() => void again(e.id)}>Baixar de novo</button>}</Td></tr>)}</Table>}
    </div>
  );
};

const OrgSettings = () => {
  const [tab, setTab] = useState("marca"); const org = useOrg();
  return (
    <div>
      <PageHead eyebrow="Gestão" title="Organização" hint={`${org.brandName || "Organização"} · marca, consumo do plano e exportação dos seus dados.`} />
      <Tabs tabs={[["marca", "Marca"], ["uso", "Módulos e consumo"], ["export", "Exportação de dados"]]} value={tab} onChange={setTab} />
      {tab === "marca" && <BrandTab />}{tab === "uso" && <UsageTab />}{tab === "export" && <ExportTab />}
    </div>
  );
};
export default OrgSettings;
