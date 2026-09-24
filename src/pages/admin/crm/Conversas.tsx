import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fmtDateTime } from "@/lib/format";
import { PageHead, State, Table, Td, errText, Msg, useMsg } from "@/lib/ui";

interface Row { id: string; title: string; person_id: string; full_name: string; phone: string | null; last_contact_at: string | null }

/** Conversas: abre o WhatsApp com mensagem pronta e registra o contato — o que HP tem de verdade hoje.
 *  NÃO é uma caixa de entrada com sincronização de duas vias (isso exigiria um provedor real conectado —
 *  Evolution API/Chatwoot ou similar — que a organização ainda não tem configurado; ver Mensagens agendadas
 *  e Disparo de mensagens, que dependem do mesmo provedor e ficam bloqueados até essa integração existir). */
const Conversas = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg();
  const rows = useQuery({ queryKey: ["crm-conversas"], queryFn: async () => {
    const { data, error } = await supabase.from("opportunities").select("id, title, person_id, last_contact_at, person:people(full_name, person_contacts(type, value, normalized))").eq("status", "open").order("last_contact_at", { ascending: true, nullsFirst: true }).limit(100);
    if (error) throw error;
    return (data as unknown as { id: string; title: string; person_id: string; last_contact_at: string | null; person: { full_name: string; person_contacts: { type: string; value: string; normalized: string }[] } | null }[]).map((o) => ({
      id: o.id, title: o.title, person_id: o.person_id, full_name: o.person?.full_name ?? "—", last_contact_at: o.last_contact_at,
      phone: o.person?.person_contacts.find((c) => c.type === "phone")?.normalized ?? null,
    })) as Row[];
  } });

  const openWhatsApp = async (r: Row) => {
    if (!r.phone) return m.err("Esta pessoa não tem telefone cadastrado.");
    const text = encodeURIComponent(`Olá ${r.full_name.split(" ")[0]}, tudo bem? Aqui é da HP Fisioterapia sobre "${r.title}".`);
    window.open(`https://wa.me/${r.phone}?text=${text}`, "_blank", "noopener,noreferrer");
    const { data: u } = await supabase.auth.getUser();
    const { data: org } = await supabase.from("organizations").select("id").single();
    const { error } = await supabase.from("interactions").insert({ org_id: org?.id, person_id: r.person_id, opportunity_id: r.id, channel: "whatsapp", summary: "WhatsApp aberto com mensagem pronta", created_by: u.user?.id });
    if (error) return m.err(errText(error));
    void qc.invalidateQueries({ queryKey: ["crm-conversas"] });
  };

  return (
    <div>
      <PageHead eyebrow="CRM · Comunicação" title="Conversas" hint="Abre o WhatsApp com mensagem pronta para o contato da oportunidade e registra o contato automaticamente. Sem caixa de entrada integrada (dependeria de um provedor real — ver Configurações)." />
      <Msg m={msg} />
      <State loading={rows.isLoading} error={rows.error} empty={rows.data?.length === 0} emptyText="Nenhuma oportunidade em aberto." />
      {rows.data && rows.data.length > 0 && (
        <Table head={["Pessoa", "Oportunidade", "Último contato", ""]}>
          {rows.data.map((r) => (
            <tr key={r.id}>
              <Td>{r.full_name}</Td>
              <Td>{r.title}</Td>
              <Td>{r.last_contact_at ? fmtDateTime(r.last_contact_at) : "Nunca"}</Td>
              <Td>{r.phone ? <button className="hp-btn hp-btn-outline hp-btn-sm" onClick={() => openWhatsApp(r)}><MessageCircle size={14} aria-hidden />WhatsApp</button> : <span className="text-xs text-muted-foreground">Sem telefone</span>}</Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
};

export default Conversas;
