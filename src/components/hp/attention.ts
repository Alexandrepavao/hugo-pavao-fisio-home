import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";

export interface AttentionItem { id: string; label: string; detail: string; to: string; overdue: boolean }

/** O que pede atenção de QUEM está logado — só dados reais, cada consulta respeitando a RLS/permissão do próprio usuário
 *  (quem não enxerga a tabela ou a função simplesmente não vê o item; nunca mostra nada inventado nem de outra pessoa):
 *  - tarefas comerciais atribuídas ao usuário e vencidas (CRM);
 *  - pendências administrativas abertas e vencidas sob a responsabilidade do usuário (Administrativo). */
export const useAttention = () => {
  const { user } = useAuth();
  const uid = user?.id;
  const tasks = useQuery({
    queryKey: ["attention-crm-tasks", uid], enabled: !!uid, staleTime: 60_000, retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.from("crm_tasks").select("id, title, due_at").eq("assignee_user_id", uid!).is("done_at", null).lt("due_at", new Date().toISOString()).order("due_at").limit(5);
      if (error) return [] as AttentionItem[];
      return (data ?? []).map((t) => ({ id: `t-${t.id}`, label: t.title as string, detail: "Tarefa comercial vencida", to: "/admin/crm/tarefas", overdue: true }));
    },
  });
  const pend = useQuery({
    queryKey: ["attention-adm-pendencies", uid], enabled: !!uid, staleTime: 60_000, retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("adm_pendency_list", { p_unit: null, p_owner: uid!, p_type: null, p_kind: null, p_status: "open", p_limit: 50 });
      if (error) return [] as AttentionItem[];
      return ((data ?? []) as { id: string; title: string; overdue: boolean; overdue_days: number | null }[]).filter((p) => p.overdue).slice(0, 5)
        .map((p) => ({ id: `p-${p.id}`, label: p.title, detail: `Pendência administrativa atrasada${p.overdue_days ? ` há ${p.overdue_days} dia(s)` : ""}`, to: "/admin/adm/pendencias", overdue: true }));
    },
  });
  const items = [...(pend.data ?? []), ...(tasks.data ?? [])];
  return { items, count: items.length, loading: tasks.isLoading || pend.isLoading };
};
