import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Check, UserRound } from "lucide-react";
import { supabase, setActingAs } from "@/lib/supabase";
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";

export interface Representation {
  id: string; patient_person_id: string; patient_name: string; birth_date: string | null; kind: string; status: string; active: boolean; suspended: boolean; valid_until: string | null;
  scopes: { agenda: boolean; cancel: boolean; train: boolean; evolution: boolean; billing: boolean; consent: boolean; ticket: boolean };
}
export const KIND_LABEL: Record<string, string> = { responsavel_legal: "Responsável legal", tutor: "Tutor(a)", curador: "Curador(a)", procurador: "Procurador(a)", cuidador: "Cuidador(a)", delegado: "Pessoa de confiança" };
const KEY = "hp-acting-as";
const readKey = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const writeKey = (v: string | null) => { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch { /* sem storage: vale só nesta aba */ } };

interface Ctx { acting: string | null; reps: Representation[]; current: Representation | null; switchTo: (personId: string | null) => void }
const ActingContext = createContext<Ctx>({ acting: null, reps: [], current: null, switchTo: () => undefined });
export const useActing = () => useContext(ActingContext);

/** Guarda “em nome de quem” o usuário está usando o portal. O cabeçalho é aplicado ANTES de qualquer consulta dos filhos (ver setActingAs). */
export const ActingProvider = ({ children }: { children: ReactNode }) => {
  const qc = useQueryClient(); const navigate = useNavigate();
  const [acting, setActing] = useState<string | null>(() => { const v = readKey(); setActingAs(v); return v; });
  const reps = useQuery({ queryKey: ["my-representations"], retry: false, staleTime: 60_000, queryFn: async () => { const { data, error } = await supabase.rpc("my_representations"); if (error) throw error; return (data ?? []) as Representation[]; } });
  const switchTo = useCallback((personId: string | null) => {
    setActingAs(personId); writeKey(personId); setActing(personId); qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "my-representations" }); navigate("/paciente");
  }, [qc, navigate]);
  const list = useMemo(() => reps.data ?? [], [reps.data]);
  const current = useMemo(() => list.find((r) => r.patient_person_id === acting) ?? null, [list, acting]);
  const value = useMemo(() => ({ acting, reps: list, current, switchTo }), [acting, list, current, switchTo]);
  return <ActingContext.Provider value={value}>{children}</ActingContext.Provider>;
};

/** Faixa fixa no topo enquanto o usuário age em nome de outra pessoa. */
export const ActingBanner = () => {
  const { acting, current, switchTo } = useActing();
  if (!acting) return null;
  return (
    <div role="status" data-testid="acting-banner" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm">
      <span>Você está usando o aplicativo <b>em nome de {current?.patient_name ?? "outra pessoa"}</b>{current ? ` (${KIND_LABEL[current.kind] ?? current.kind})` : ""}.</span>
      <button type="button" className="hp-btn hp-btn-outline hp-btn-sm" onClick={() => switchTo(null)}>Voltar para mim</button>
    </div>
  );
};

/** Itens do menu da conta: “Quem está usando?” (só aparece para quem tem vínculos). */
export const ActingMenuItems = () => {
  const { acting, reps, switchTo } = useActing();
  if (reps.length === 0) return null;
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="text-xs text-muted-foreground">Quem está usando?</DropdownMenuLabel>
      <DropdownMenuItem onSelect={() => switchTo(null)}><UserRound size={14} aria-hidden className="mr-2" />Eu mesmo(a){!acting && <Check size={14} aria-hidden className="ml-auto" />}</DropdownMenuItem>
      {reps.filter((r) => r.active).map((r) => (
        <DropdownMenuItem key={r.id} onSelect={() => switchTo(r.patient_person_id)} data-testid="acting-option"><UserRound size={14} aria-hidden className="mr-2" />{r.patient_name}<span className="ml-1 text-xs text-muted-foreground">({KIND_LABEL[r.kind] ?? r.kind})</span>{acting === r.patient_person_id && <Check size={14} aria-hidden className="ml-auto" />}</DropdownMenuItem>
      ))}
    </>
  );
};
