import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { fmtDateTime } from "@/lib/format";
import { Badge, Msg, State, Table, Td, btnGhost, errText, promptText, useMsg } from "@/lib/ui";

interface Row { id: string; person_id: string; person: string; type: string; masked: string; valid_format: boolean; verified_at: string | null; method: string | null }
const METHOD: Record<string, string> = { conversa: "Conversa com a pessoa", codigo_enviado: "Código enviado e confirmado", documento: "Documento apresentado", outro: "Outro" };

/** Verificação de contato: REGISTRO feito por uma pessoa da equipe. Formato válido não é contato verificado, e nada é inferido automaticamente. O valor aparece mascarado. */
const ContactsTab = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg(); const [q, setQ] = useState("");
  const list = useQuery({ queryKey: ["adm-contacts", q], enabled: q.trim().length >= 2, retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("adm_contacts_search", { p_q: q, p_unit: null }); if (error) throw error; return data as Row[]; } });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["adm-contacts"] }); void qc.invalidateQueries({ queryKey: ["adm-central"] }); };
  const verify = async (r: Row) => {
    const v = await promptText("Registrar verificação", `Como o contato de ${r.person} foi verificado?`, { kind: "select", defaultValue: "conversa", confirmLabel: "Registrar", options: Object.entries(METHOD).map(([value, label]) => ({ value, label })) }); if (!v) return;
    const { error } = await supabase.rpc("adm_contact_verify", { p_contact: r.id, p_method: v, p_verified: true }); if (error) m.err(errText(error)); else { m.ok("Verificação registrada."); refresh(); }
  };
  const unverify = async (r: Row) => { const { error } = await supabase.rpc("adm_contact_verify", { p_contact: r.id, p_method: "outro", p_verified: false }); if (error) m.err(errText(error)); else { m.ok("Verificação removida."); refresh(); } };
  return (
    <div className="grid gap-4">
      <Msg m={msg} />
      <p className="text-sm text-muted-foreground">Registre aqui que um contato <b>foi de fato verificado</b> (conversa, código confirmado, documento). <b>Formato válido não é verificação</b>; mudar o valor do contato apaga a verificação anterior. O valor aparece mascarado por privacidade.</p>
      <div className="max-w-md"><label htmlFor="ctc-q" className="block text-xs mb-1">Buscar cadastro pelo nome</label><input id="ctc-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Digite ao menos 2 letras" /></div>
      {q.trim().length >= 2 && <State loading={list.isLoading} error={list.error} empty={list.data?.length === 0} emptyText="Nenhum contato encontrado para este nome (dentro do seu escopo de unidade)." />}
      {list.data && list.data.length > 0 && (
        <Table head={["Cadastro", "Contato", "Formato", "Verificação", ""]}>
          {list.data.map((r) => (
            <tr key={r.id}><Td>{r.person}</Td><Td>{r.type === "email" ? "E-mail" : r.type === "whatsapp" ? "WhatsApp" : "Telefone"} · <span className="tabular">{r.masked}</span></Td>
              <Td>{r.valid_format ? <Badge tone="success">Válido</Badge> : <Badge tone="danger">Inválido</Badge>}</Td>
              <Td>{r.verified_at ? <><Badge tone="success">Verificado</Badge><span className="block text-xs text-muted-foreground">{METHOD[r.method ?? ""] ?? r.method} · {fmtDateTime(r.verified_at)}</span></> : <Badge>Não verificado</Badge>}</Td>
              <Td>{r.verified_at ? <button type="button" className={`${btnGhost} hp-btn-sm`} onClick={() => unverify(r)}>Remover verificação</button> : <button type="button" className={`${btnGhost} hp-btn-sm`} onClick={() => verify(r)}>Registrar verificação</button>}</Td></tr>))}
        </Table>)}
    </div>
  );
};

export default ContactsTab;
