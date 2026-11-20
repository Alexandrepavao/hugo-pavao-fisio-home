import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Hourglass } from "lucide-react";
import { Badge, btnGhost, btnPrimary, Msg, useMsg } from "@/lib/ui";
import { apiText, enrollmentFor, enrollmentStart } from "./api";

/** Ficha do paciente (fisioterapeuta): estado do vínculo e a porta de entrada para a avaliação + apresentação personalizada. Sem vínculo, só quem cadastrou/atende a pessoa pode iniciar. */
const PresentationEntry = ({ person }: { person: string }) => {
  const nav = useNavigate(); const qc = useQueryClient(); const [msg, m] = useMsg();
  const q = useQuery({ queryKey: ["enrollment", person], retry: false, queryFn: () => enrollmentFor(person) });
  const d = q.data; if (q.isLoading || !d) return null;
  const start = async () => { try { const id = await enrollmentStart(person); await qc.invalidateQueries({ queryKey: ["enrollment", person] }); nav(`/apresentacao/avaliacao/${id}`); } catch (e) { m.err(apiText(e)); } };
  const open = d.id && (d.status === "pending" || d.status === "active");
  return (
    <section className="space-y-2 border border-border bg-card p-4" aria-label="Avaliação e apresentação" data-testid="presentation-entry">
      <div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-semibold">Avaliação e apresentação personalizada</h2>
        {d.status === "pending" && <Badge tone="warning">Paciente pendente</Badge>}{d.status === "active" && <Badge tone="info">Paciente ativo</Badge>}{d.status === "ended" && <Badge tone="neutral">Vínculo encerrado</Badge>}</div>
      <Msg m={msg} />
      {d.status === "pending" && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Hourglass size={14} aria-hidden />O acompanhamento será ativado quando o pagamento da contratação for confirmado. Marcar “venda feita” no CRM não ativa o paciente.</p>}
      {d.review_flag && <p className="text-sm" role="status">Atenção administrativa: {d.review_note ?? "há um sinal financeiro em análise."}</p>}
      <div className="flex flex-wrap gap-2">
        {open ? <Link to={`/apresentacao/avaliacao/${d.id}`} className={btnPrimary} data-testid="open-presentation"><ClipboardList size={14} className="mr-1 inline" aria-hidden />Abrir avaliação e apresentação</Link>
          : d.status === "none" ? <button type="button" className={btnGhost} onClick={() => void start()} data-testid="start-evaluation">Iniciar avaliação</button> : null}
      </div>
    </section>
  );
};
export default PresentationEntry;
