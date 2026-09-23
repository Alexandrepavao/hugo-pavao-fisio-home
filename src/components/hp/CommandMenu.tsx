import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { NAV } from "./nav";

/** Busca global (Ctrl+K): páginas do painel e pessoas (respeitando a RLS: só aparece o que o perfil pode ler). */
const CommandMenu = ({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) => {
  const nav = useNavigate(); const { hasRole } = useAuth(); const [q, setQ] = useState(""); const [debounced, setDebounced] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => { if (!open) setQ(""); }, [open]);
  const items = useMemo(() => NAV.flatMap((s) => s.items).filter((i) => !i.roles || hasRole(...i.roles)), [hasRole]);
  const people = useQuery({
    queryKey: ["cmd-people", debounced], enabled: open && debounced.length >= 2 && hasRole("manager", "ops_admin", "unit_manager", "sales"),
    queryFn: async () => (await supabase.from("people").select("id, full_name").ilike("full_name", `%${debounced.replace(/[%_]/g, "")}%`).is("merged_into_id", null).limit(6)).data ?? [],
  });
  const go = (to: string) => { onOpenChange(false); nav(to); };
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Buscar páginas do painel ou pessoas…" value={q} onValueChange={setQ} />
      <CommandList>
        <CommandEmpty>Nada encontrado.</CommandEmpty>
        <CommandGroup heading="Ir para">
          {items.map((i) => <CommandItem key={i.to} value={`${i.label} ${i.keywords ?? ""}`} onSelect={() => go(i.to)}><i.icon className="mr-2 h-4 w-4" aria-hidden />{i.label}</CommandItem>)}
        </CommandGroup>
        {people.data && people.data.length > 0 && (
          <CommandGroup heading="Pessoas">
            {people.data.map((p) => <CommandItem key={p.id} value={`pessoa ${p.full_name} ${p.id}`} onSelect={() => go(`/admin/pessoas?q=${encodeURIComponent(p.full_name)}`)}>{p.full_name}</CommandItem>)}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
};
export default CommandMenu;
