import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface Entry {
  id: number; action: string; entity_type: string; entity_id: string | null;
  changed_columns: string[] | null; created_at: string;
}

const Audit = () => {
  const [rows, setRows] = useState<Entry[]>([]);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    supabase.from("audit_log").select("id, action, entity_type, entity_id, changed_columns, created_at")
      .order("created_at", { ascending: false }).limit(100)
      .then(({ data, error }) => { if (error) return setState("error"); setRows((data ?? []) as Entry[]); setState("ok"); });
  }, []);

  return (
    <div>
      <p className="eyebrow mb-2">Segurança</p>
      <h1 className="text-3xl text-foreground mb-2">Auditoria</h1>
      <p className="text-muted-foreground mb-6 max-w-2xl">Últimas 100 ações. O registro guarda apenas os nomes dos campos alterados, nunca senhas, tokens ou conteúdo clínico.</p>
      {state === "loading" && <p role="status" className="text-muted-foreground">Carregando…</p>}
      {state === "error" && <p role="alert" className="text-destructive">Sem permissão ou falha ao carregar.</p>}
      {state === "ok" && rows.length === 0 && <p className="hp-card p-6 text-muted-foreground">Nenhum registro ainda.</p>}
      {state === "ok" && rows.length > 0 && (
        <div className="overflow-x-auto hp-card">
          <table className="w-full text-[14px]">
            <thead><tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
              <th className="p-3">Quando</th><th className="p-3">Ação</th><th className="p-3">Entidade</th><th className="p-3">Campos alterados</th>
            </tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0">
                <td className="p-3 whitespace-nowrap">{new Date(r.created_at).toLocaleString("pt-BR")}</td>
                <td className="p-3">{r.action}</td><td className="p-3">{r.entity_type}</td>
                <td className="p-3 text-muted-foreground">{r.changed_columns?.join(", ") ?? "—"}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default Audit;
