import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Link2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fmtDate } from "@/lib/format";
import { Badge, btnDanger, btnGhost, btnPrimary, confirmDialog, errText, Msg, State, Table, Td, useMsg } from "@/lib/ui";

interface Unit { id: string; name: string }
interface LinkRow { id: string; email: string | null; full_name: string | null; unit_id: string; expires_at: string; used_at: string | null; revoked_at: string | null; created_at: string }
const stateOf = (l: LinkRow) => (l.used_at ? "used" : l.revoked_at ? "revoked" : new Date(l.expires_at).getTime() <= Date.now() ? "expired" : "open");
const STATE: Record<string, { label: string; tone: "success" | "neutral" | "warning" | "danger" }> = { open: { label: "Aguardando preenchimento", tone: "warning" }, used: { label: "Preenchido", tone: "success" }, revoked: { label: "Cancelado", tone: "neutral" }, expired: { label: "Expirado", tone: "danger" } };

/** Convite de onboarding do fisioterapeuta: gera um link único (14 dias, uso único). O link aparece UMA vez, na hora; depois só o estado fica visível. */
const OnboardingLinks = ({ units }: { units: Unit[] }) => {
  const qc = useQueryClient(); const [msg, m] = useMsg();
  const [email, setEmail] = useState(""); const [name, setName] = useState(""); const [unit, setUnit] = useState(""); const [days, setDays] = useState("14"); const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<{ url: string; who: string } | null>(null);
  const list = useQuery({ queryKey: ["onboarding-links"], queryFn: async () => ((await supabase.from("onboarding_links").select("id, email, full_name, unit_id, expires_at, used_at, revoked_at, created_at").order("created_at", { ascending: false }).limit(30)).data ?? []) as LinkRow[] });
  const unitName = (id: string) => units.find((u) => u.id === id)?.name ?? "—";

  const create = async (e: FormEvent) => {
    e.preventDefault(); m.clear(); setFresh(null);
    const u = unit || (units.length === 1 ? units[0].id : "");
    if (!u) return m.err("Escolha a unidade do fisioterapeuta.");
    setBusy(true);
    const { data, error } = await supabase.rpc("onboarding_link_create", { p_email: email.trim() || null, p_full_name: name.trim() || null, p_unit: u, p_days: Number(days) });
    setBusy(false);
    if (error) return m.err(errText(error));
    const r = data as { path: string };
    setFresh({ url: `${window.location.origin}${r.path}`, who: name.trim() || email.trim() || "o fisioterapeuta" });
    setEmail(""); setName(""); void qc.invalidateQueries({ queryKey: ["onboarding-links"] });
  };
  const copy = async (text: string, ok: string) => { try { await navigator.clipboard.writeText(text); m.ok(ok); } catch { m.err("Não foi possível copiar automaticamente. Selecione o texto e copie."); } };
  const revoke = async (l: LinkRow) => {
    if (!(await confirmDialog("Cancelar este convite?", "O link deixa de funcionar. Se a pessoa já abriu o formulário, não conseguirá enviar.", "Cancelar convite", true))) return;
    const { error } = await supabase.rpc("onboarding_link_revoke", { p_id: l.id });
    error ? m.err(errText(error)) : void qc.invalidateQueries({ queryKey: ["onboarding-links"] });
  };
  const wa = (url: string, who: string) => `Olá! Para finalizar a sua contratação na HP Group, preencha o seu cadastro neste link (pessoal e de uso único, vale até a data combinada):\n${url}\n\nNele você informa seus dados, cria o seu acesso ao sistema e vê um tutorial. Qualquer dúvida, é só chamar. (${who})`;

  return (
    <section className="hp-card p-5 mb-6" aria-label="Convite de onboarding por link" data-testid="onboarding-links">
      <h2 className="text-xl flex items-center gap-2"><Link2 size={18} aria-hidden />Convidar fisioterapeuta por link</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-4 max-w-3xl">Gere um link único para o fisioterapeuta contratado preencher os próprios dados. Ao concluir, o cadastro entra em Pessoas (pessoa física, ou jurídica se informar CNPJ), o profissional já fica ativo nesta unidade e ele cria o acesso ao sistema. Sem o link ninguém consegue se cadastrar.</p>
      <Msg m={msg} />
      <form onSubmit={create} className="grid gap-3 sm:grid-cols-5 items-end" noValidate>
        <div className="sm:col-span-2"><label htmlFor="ol-email" className="block text-xs mb-1">E-mail do fisioterapeuta (recomendado)</label><input id="ol-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@email.com" /></div>
        <div><label htmlFor="ol-name" className="block text-xs mb-1">Nome (opcional)</label><input id="ol-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label htmlFor="ol-unit" className="block text-xs mb-1">Unidade</label>
          <select id="ol-unit" value={unit || (units.length === 1 ? units[0].id : "")} onChange={(e) => setUnit(e.target.value)}><option value="">Selecione…</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
        <div><label htmlFor="ol-days" className="block text-xs mb-1">Validade</label>
          <select id="ol-days" value={days} onChange={(e) => setDays(e.target.value)}>{[["7", "7 dias"], ["14", "14 dias"], ["30", "30 dias"]].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div className="sm:col-span-5"><button className={btnPrimary} disabled={busy}>{busy ? "Gerando…" : "Gerar link de convite"}</button></div>
      </form>
      {fresh && (
        <div className="mt-4 rounded-md border border-border bg-muted/40 p-4" data-testid="onboarding-link-novo" role="status">
          <p className="text-sm font-medium">Link para {fresh.who} — copie agora, ele não será mostrado de novo:</p>
          <input readOnly value={fresh.url} onFocus={(e) => e.currentTarget.select()} aria-label="Link de convite" className="mt-2 font-mono text-xs" data-testid="onboarding-link-url" />
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={btnGhost + " hp-btn-sm"} onClick={() => void copy(fresh.url, "Link copiado.")}><Copy size={13} aria-hidden className="mr-1.5" />Copiar link</button>
            <button type="button" className={btnGhost + " hp-btn-sm"} onClick={() => void copy(wa(fresh.url, fresh.who), "Mensagem pronta copiada.")}>Copiar mensagem pronta</button>
          </div>
        </div>)}
      <h3 className="text-base font-semibold mt-6 mb-2">Convites enviados</h3>
      <State loading={list.isLoading} error={list.error} empty={list.data?.length === 0} emptyText="Nenhum convite gerado ainda." />
      {list.data && list.data.length > 0 && (
        <Table head={["Para", "Unidade", "Criado em", "Vale até", "Situação", ""]}>
          {list.data.map((l) => { const st = STATE[stateOf(l)]; return (
            <tr key={l.id} data-testid="onboarding-link-linha">
              <Td><strong>{l.full_name ?? "—"}</strong>{l.email && <span className="block text-xs text-muted-foreground">{l.email}</span>}</Td>
              <Td>{unitName(l.unit_id)}</Td><Td>{fmtDate(l.created_at)}</Td><Td>{fmtDate(l.expires_at)}</Td>
              <Td><Badge tone={st.tone}>{st.label}</Badge></Td>
              <Td>{stateOf(l) === "open" && <button className={btnDanger + " hp-btn-sm"} onClick={() => void revoke(l)}>Cancelar</button>}</Td>
            </tr>); })}
        </Table>)}
    </section>
  );
};

export default OnboardingLinks;
