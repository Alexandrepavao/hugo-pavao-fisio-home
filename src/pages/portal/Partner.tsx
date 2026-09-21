import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { brl, fmtDate } from "@/lib/format";
import { btnGhost, errText, inputCls, Msg, State, useMsg } from "@/lib/ui";
import PortalShell from "./PortalShell";

const Partner = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [spec, setSpec] = useState<string | null>(null); const [bio, setBio] = useState<string | null>(null); const [reg, setReg] = useState<string | null>(null);
  const profile = useQuery({ queryKey: ["my-partner"], queryFn: async () => (await supabase.from("partner_profiles").select("person_id, specialty, council_registration, bio, status, onboarding").maybeSingle()).data });
  const code = useQuery({ queryKey: ["ref-code"], queryFn: async () => (await supabase.rpc("referral_code_get")).data as string });
  const refs = useQuery({ queryKey: ["my-refs"], queryFn: async () => ((await supabase.rpc("partner_my_referrals")).data ?? []) as { referral_id: string; created_at: string; first_name: string; stage_name: string | null; status: string | null }[] });
  const payouts = useQuery({ queryKey: ["my-payouts"], queryFn: async () => (await supabase.from("partner_payouts").select("id, description, amount_cents, status, reference_month, paid_at").order("created_at", { ascending: false })).data ?? [] });
  const p = profile.data;
  const save = async (e: FormEvent) => { e.preventDefault(); const { error } = await supabase.from("partner_profiles").update({ specialty: spec ?? p?.specialty, council_registration: reg ?? p?.council_registration, bio: bio ?? p?.bio }).eq("person_id", p!.person_id); error ? m.err(errText(error)) : (m.ok("Perfil atualizado."), void qc.invalidateQueries({ queryKey: ["my-partner"] })); };
  const link = code.data ? `${window.location.origin}/?ref=${code.data}` : "";
  const OB: Record<string, string> = { contrato: "Contrato", formacao: "Formação", integracao: "Integração" };
  return (
    <PortalShell title="Portal do parceiro">
      <Msg m={msg} />
      <State loading={profile.isLoading} error={profile.error} empty={!p} emptyText="Seu cadastro de parceiro ainda não foi aprovado." />
      {p && <>
        <section className="mb-8 grid gap-6 lg:grid-cols-2">
          <form onSubmit={save} className="bg-card border border-border p-5 grid gap-3" noValidate><h2 className="text-xl">Perfil profissional <span className="text-sm text-navy-400">({p.status === "active" ? "ativo" : p.status === "onboarding" ? "em integração" : "inativo"})</span></h2>
            <div><label htmlFor="sp" className="block text-xs mb-1">Especialidade</label><input id="sp" className={inputCls} value={spec ?? p.specialty ?? ""} onChange={(e) => setSpec(e.target.value)} /></div>
            <div><label htmlFor="rg" className="block text-xs mb-1">Registro no conselho</label><input id="rg" className={inputCls} value={reg ?? p.council_registration ?? ""} onChange={(e) => setReg(e.target.value)} /></div>
            <div><label htmlFor="bi" className="block text-xs mb-1">Apresentação</label><textarea id="bi" rows={3} className={inputCls} value={bio ?? p.bio ?? ""} onChange={(e) => setBio(e.target.value)} /></div><button className={btnGhost + " w-fit"}>Salvar perfil</button></form>
          <div className="bg-card border border-border p-5"><h2 className="text-xl mb-3">Integração</h2><ul className="space-y-1">{Object.entries(p.onboarding as Record<string, boolean>).map(([k, v]) => <li key={k}>{v ? "✓" : "○"} {OB[k] ?? k}</li>)}</ul><p className="text-xs text-navy-400 mt-3">A equipe atualiza estas etapas conforme a integração avança.</p></div>
        </section>
        <section className="mb-8"><h2 className="text-xl mb-2">Programa de indicação</h2><p className="text-sm text-navy-400 mb-2">Compartilhe qualquer página do HP Group acrescentando <code>?ref={code.data ?? "…"}</code> ao endereço. Quando a pessoa enviar um formulário, a indicação fica registrada e rastreável.</p>
          {link && <p className="bg-card border border-border p-3 break-all">{link}</p>}</section>
        <section className="mb-8"><h2 className="text-xl mb-2">Minhas indicações</h2><State loading={refs.isLoading} error={refs.error} empty={refs.data?.length === 0} emptyText="Nenhuma indicação registrada ainda." />
          <ul className="space-y-2">{refs.data?.map((r) => <li key={r.referral_id} className="bg-card border border-border p-3 flex justify-between"><span>{r.first_name} <span className="text-navy-400 text-sm">· {fmtDate(r.created_at)}</span></span><span className="text-sm">{r.status === "won" ? "Contratou" : r.status === "lost" ? "Encerrado" : r.stage_name ?? "Em andamento"}</span></li>)}</ul>
          <p className="text-xs text-navy-400 mt-2">Por privacidade, você vê apenas o primeiro nome e a etapa.</p></section>
        <section><h2 className="text-xl mb-2">Repasses autorizados</h2>
          {payouts.data && payouts.data.length > 0 ? <ul className="space-y-2">{payouts.data.map((x) => <li key={x.id} className="bg-card border border-border p-3 flex justify-between"><span>{x.description} <span className="text-navy-400 text-sm">· ref. {fmtDate(x.reference_month + "T12:00:00Z").slice(3)}</span></span><span className="tabular">{brl(x.amount_cents)} · {x.status === "paid" ? "pago" : "autorizado"}</span></li>)}</ul> : <p className="text-navy-400">Nenhum repasse autorizado.</p>}</section>
      </>}
    </PortalShell>
  );
};
export default Partner;
