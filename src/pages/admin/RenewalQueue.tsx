import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { fmtDateTime } from "@/lib/format";
import { Badge, btnGhost, errText, Msg, State, Table, Td, useMsg } from "@/lib/ui";

interface Req { id: string; person_id: string; person_name: string; unit_name: string; kind: "renovacao" | "contato"; message: string | null; created_at: string }

/** Pedidos de renovação/contato feitos pelos pacientes no portal. Fila ADMINISTRATIVA (sem nenhum dado clínico): quem atende faz o contato humano;
 *  nada aqui cobra, vende ou desconta sessão automaticamente. */
const RenewalQueue = () => {
  const qc = useQueryClient(); const [msg, m] = useMsg();
  const q = useQuery({ queryKey: ["renewal-open"], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("renewal_requests_open"); if (error) throw error; return data as Req[]; } });
  const set = async (id: string, status: "contacted" | "closed") => {
    const { error } = await supabase.rpc("renewal_request_set_status", { p_id: id, p_status: status });
    if (error) return m.err(errText(error)); m.ok(status === "contacted" ? "Marcado como contatado." : "Pedido encerrado."); void qc.invalidateQueries({ queryKey: ["renewal-open"] });
  };
  return (<><Msg m={msg} />
    <p className="text-sm text-muted-foreground mb-3">Pedidos feitos pelos pacientes no portal. Isto só avisa a equipe — nenhuma cobrança, venda ou desconto de sessão é feito automaticamente; o contato é humano.</p>
    <State loading={q.isLoading} error={q.error} empty={q.data?.length === 0} emptyText="Nenhum pedido em aberto." />
    {q.data && q.data.length > 0 && <Table head={["Paciente", "Unidade", "Pedido", "Mensagem", "Quando", ""]}>
      {q.data.map((r) => <tr key={r.id}><Td>{r.person_name}</Td><Td>{r.unit_name}</Td><Td><Badge tone={r.kind === "renovacao" ? "gold" : "info"}>{r.kind === "renovacao" ? "Renovação" : "Contato"}</Badge></Td><Td>{r.message ?? "—"}</Td><Td>{fmtDateTime(r.created_at)}</Td>
        <Td><button className={btnGhost + " hp-btn-sm"} onClick={() => set(r.id, "contacted")}>Contatado</button> <button className={btnGhost + " hp-btn-sm"} onClick={() => set(r.id, "closed")}>Encerrar</button></Td></tr>)}</Table>}</>);
};

export default RenewalQueue;
