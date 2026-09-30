import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface Subject { id: string; name: string }

/** Busca um cadastro (pessoa física ou jurídica) pelo nome; respeita o que o usuário já enxerga (RLS). */
const SubjectSearch = ({ kind, value, onChange, id, label = "Cadastro" }: { kind: "person" | "legal_entity"; value: Subject | null; onChange: (s: Subject | null) => void; id: string; label?: string }) => {
  const [q, setQ] = useState("");
  const found = useQuery({ queryKey: ["subj-search", kind, q], enabled: q.trim().length >= 2 && !value, queryFn: async () => {
    const term = `%${q.trim().replace(/[%_]/g, "")}%`;
    if (kind === "person") return ((await supabase.from("people").select("id, full_name").ilike("full_name", term).is("merged_into_id", null).is("archived_at", null).limit(6)).data ?? []).map((p) => ({ id: p.id as string, name: p.full_name as string }));
    return ((await supabase.from("legal_entities").select("id, legal_name").ilike("legal_name", term).is("merged_into_id", null).is("archived_at", null).limit(6)).data ?? []).map((p) => ({ id: p.id as string, name: p.legal_name as string }));
  } });
  return (
    <div>
      <label htmlFor={id} className="block text-xs mb-1">{label}</label>
      <input id={id} value={value ? value.name : q} autoComplete="off" onChange={(e) => { onChange(null); setQ(e.target.value); }} placeholder="Digite ao menos 2 letras do nome" />
      {!value && found.data?.map((s) => <button type="button" key={s.id} className="block w-full text-left p-2 border border-border bg-card hover:bg-muted text-sm" onClick={() => { onChange(s); setQ(""); }}>{s.name}</button>)}
    </div>
  );
};

export default SubjectSearch;
