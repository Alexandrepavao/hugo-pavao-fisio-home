import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { fmtDateTime } from "@/lib/format";
import { PageHead, State, Table, Td } from "@/lib/ui";
import type { StaffUser, Task } from "./types";

/** Tarefas comerciais (crm_tasks) — vinculadas a oportunidade/pessoa, diferente das tarefas pessoais
 *  ("Meu dia"). Extraído da antiga aba "Tarefas" do Pipeline para ter rota própria dentro do CRM. */
const Tasks = () => {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ["assignable"], queryFn: async () => ((await supabase.rpc("list_assignable_users", {})).data ?? []) as StaffUser[] });
  const tasks = useQuery({ queryKey: ["crm-tasks-page"], queryFn: async () => (await supabase.from("crm_tasks").select("*").is("done_at", null).order("due_at")).data as Task[] });
  const nameOf = (id: string | null) => users.data?.find((u) => u.user_id === id)?.name ?? "Sem responsável";
  const done = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("crm_tasks").update({ done_at: new Date().toISOString() }).eq("id", id); if (error) throw error; },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["crm-tasks-page"] }); void qc.invalidateQueries({ queryKey: ["opp-tasks"] }); },
  });

  return (
    <div>
      <PageHead eyebrow="CRM" title="Tarefas" hint="Tarefas comerciais vinculadas a oportunidades e pessoas — para tarefas pessoais, veja Meu dia." />
      <State loading={tasks.isLoading} error={tasks.error} empty={tasks.data?.length === 0} emptyText="Nenhuma tarefa pendente." />
      {tasks.data && tasks.data.length > 0 && (
        <Table head={["Tarefa", "Vencimento", "Responsável", ""]}>
          {tasks.data.map((t) => (
            <tr key={t.id}>
              <Td><span className={new Date(t.due_at) < new Date() ? "text-destructive" : ""}>{t.title}</span></Td>
              <Td>{fmtDateTime(t.due_at)}</Td>
              <Td>{nameOf(t.assignee_user_id)}</Td>
              <Td><button className="hp-btn hp-btn-outline hp-btn-sm" onClick={() => done.mutate(t.id)}>Concluir</button></Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
};

export default Tasks;
