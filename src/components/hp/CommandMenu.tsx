import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CommandDialog, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { featureOn } from "@/lib/release";
import { zoneLabel } from "@/lib/capitals";
import { ArrowDown, ArrowUp, Clock, CornerDownLeft, Mail, MapPin, Phone, Search, UserCog } from "lucide-react";
import { APPS } from "./apps";
import { navForApp } from "./appNav";
import type { FrameNavItem } from "./AppFrame";
import { usePfAccess } from "@/pages/admin/finance/personal/pf";

type Item = FrameNavItem & { app: string };
interface PersonHit { id: string; full_name: string; city: string | null; state_uf: string | null; neighborhood: string | null; zone: string | null; service_zones: string[]; kinds: string[]; is_physio: boolean; phone: string | null; email: string | null }
interface SearchResp { filters: { kinds: string[]; zones: string[]; terms: string[] }; items: PersonHit[]; total: number }

const KIND_LABEL: Record<string, string> = { patient: "Paciente", partner: "Parceiro", student: "Aluno", lead: "Lead", staff: "Equipe", supplier: "Fornecedor", contact: "Contato" };
const EXAMPLES = ["fisioterapeuta zona sul", "fisioterapeuta Copacabana", "paciente Moema", "lead Campinas", "Maria Silva"];
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const RECENT_KEY = "hp-cmd-recent-q";
const readRecent = (): string[] => { try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 5) : []; } catch { return []; } };
const pushRecent = (q: string) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...readRecent().filter((x) => x !== q)].slice(0, 5))); } catch { /* sem armazenamento: só não lembra */ } };

const Kbd = ({ children }: { children: React.ReactNode }) => <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1 text-[10.5px] font-medium text-muted-foreground">{children}</kbd>;
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join("");

/** Busca global (Ctrl+K). O foco é achar PESSOAS e LEADS: nome, e-mail, telefone — e também por tipo e lugar numa frase só (“fisioterapeuta zona sul”, “paciente Moema”, “lead Campinas”).
 *  A frase é entendida no servidor (tipo, bairro, cidade, UF e zona; para fisioterapeuta, a zona vale para onde mora e para as zonas que atende) e mostramos o que foi entendido.
 *  Páginas do painel ficam fora do caminho: digite “/” para procurá-las. Quem não tem acesso a pessoas vê só as páginas. */
const CommandMenu = ({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) => {
  const nav = useNavigate(); const { hasRole } = useAuth(); const pfAccess = usePfAccess().data === true; const [q, setQ] = useState(""); const [debounced, setDebounced] = useState(""); const [recent, setRecent] = useState<string[]>([]);
  const canPeople = hasRole("manager", "ops_admin", "unit_manager", "sales");
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => { if (!open) setQ(""); else setRecent(readRecent()); }, [open]);
  const pagesMode = !canPeople || q.trimStart().startsWith("/"); const text = q.trimStart().replace(/^\/\s*/, "").trim();
  const items = useMemo<Item[]>(() => [{ to: "/admin/conta", label: "Configurações da conta", icon: UserCog, keywords: "perfil nome senha segurança dados pessoais minha conta", app: "Conta" } as Item, ...APPS.flatMap((app) => navForApp(app.id).flatMap((sec) => sec.items.map((i) => ({ ...i, app: app.label }))))]
    .filter((i) => (!i.roles || hasRole(...i.roles)) && (!i.feature || featureOn(i.feature)) && (!i.pfOnly || pfAccess)), [hasRole, pfAccess]);
  const pages = useMemo(() => {
    const s = norm(text); if (!pagesMode) return []; const words = s.split(/\s+/).filter(Boolean);
    return items.filter((i) => { const hay = norm(`${i.label} ${i.app} ${i.keywords ?? ""}`); return words.every((w) => hay.includes(w)); })
      .sort((a, b) => Number(norm(b.label).startsWith(s)) - Number(norm(a.label).startsWith(s))).slice(0, 30);
  }, [items, text, pagesMode]);
  const res = useQuery({
    queryKey: ["cmd-search", debounced], enabled: open && canPeople && !pagesMode && debounced.length >= 2,
    queryFn: async () => { const { data, error } = await supabase.rpc("search_people", { p_q: debounced, p_limit: 20 }); if (error) throw error; return data as SearchResp; },
    placeholderData: (prev) => prev,
  });
  const hits = res.data?.items ?? []; const f = res.data?.filters;
  const go = (to: string, remember?: string) => { if (remember) pushRecent(remember); onOpenChange(false); nav(to); };
  const goPerson = (p: PersonHit) => go(`/admin/pessoas?q=${encodeURIComponent(p.full_name)}`, debounced);
  const typing = q.trim() !== debounced && q.trim().length >= 2;
  const searchedNothing = !pagesMode && debounced.length >= 2 && !res.isFetching && !typing && res.data && hits.length === 0;
  const where = (p: PersonHit) => [p.neighborhood, p.city ? `${p.city}${p.state_uf ? `/${p.state_uf}` : ""}` : p.state_uf].filter(Boolean).join(", ");

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} className="max-w-2xl" shouldFilter={false}>
      <CommandInput placeholder={canPeople ? "Buscar pessoa, lead, fisioterapeuta, bairro, cidade ou zona…" : "Buscar páginas do painel…"} value={q} onValueChange={setQ} />
      <CommandList className="max-h-[min(26rem,60vh)]">
        {/* o que a busca entendeu da frase */}
        {!pagesMode && f && res.data && debounced.length >= 2 && (f.kinds.length > 0 || f.zones.length > 0 || f.terms.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 px-3 pt-3 text-[11.5px] text-muted-foreground" data-testid="cmd-entendi" aria-label="O que a busca entendeu">
            <span>Buscando:</span>
            {f.kinds.map((k) => <span key={k} className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">{k}</span>)}
            {f.zones.map((z) => <span key={z} className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 font-medium text-foreground"><MapPin className="h-3 w-3" aria-hidden />{z}</span>)}
            {f.terms.map((t) => <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-foreground">“{t}”</span>)}
          </div>)}

        {/* sem nada digitado: como usar, e o que a pessoa buscou por último */}
        {!pagesMode && q.trim().length === 0 && (
          <div className="px-4 py-4" data-testid="cmd-ajuda">
            <p className="text-sm font-medium">Procure uma pessoa, um lead ou um fisioterapeuta</p>
            <p className="mt-1 text-[12.5px] text-muted-foreground">Digite nome, e-mail ou telefone — ou junte o tipo e o lugar: bairro, cidade, UF ou zona.</p>
            <div className="mt-3 flex flex-wrap gap-1.5">{EXAMPLES.map((e) => <button key={e} type="button" onClick={() => setQ(e)} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-[12.5px] hover:bg-muted"><Search className="h-3 w-3 text-muted-foreground" aria-hidden />{e}</button>)}</div>
            <p className="mt-3 text-[11.5px] text-muted-foreground">Para ir a uma página do painel, comece com <Kbd>/</Kbd> (ex.: <button type="button" className="underline" onClick={() => setQ("/agenda")}>/agenda</button>).</p>
          </div>)}
        {!pagesMode && q.trim().length === 0 && recent.length > 0 && (
          <CommandGroup heading={<span className="inline-flex items-center gap-1.5"><Clock className="h-3 w-3" aria-hidden />Buscas recentes</span>}>
            {recent.map((r) => <CommandItem key={r} value={`recent-${r}`} onSelect={() => setQ(r)} className="gap-3 py-2 data-[selected='true']:bg-muted data-[selected=true]:text-foreground"><Search className="h-4 w-4 text-muted-foreground" aria-hidden /><span className="truncate">{r}</span></CommandItem>)}
          </CommandGroup>)}

        {/* resultados: pessoas */}
        {!pagesMode && hits.length > 0 && (
          <CommandGroup heading={`Pessoas${res.data ? ` (${res.data.total.toLocaleString("pt-BR")})` : ""}`}>
            {hits.map((p) => (
              <CommandItem key={p.id} value={`pessoa-${p.id}`} onSelect={() => goPerson(p)} className="items-start gap-3 py-2.5 data-[selected='true']:bg-muted data-[selected=true]:text-foreground" data-testid="cmd-pessoa">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">{initials(p.full_name)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.full_name}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-muted-foreground">
                    {where(p) && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" aria-hidden />{where(p)}{p.zone ? <b className="font-medium text-foreground"> · {zoneLabel(p.zone)}</b> : null}</span>}
                    {p.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" aria-hidden />{p.phone}</span>}
                    {p.email && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" aria-hidden /><span className="truncate max-w-[14rem]">{p.email}</span></span>}
                  </span>
                  {p.is_physio && p.service_zones.length > 0 && <span className="mt-0.5 block text-[11.5px] text-muted-foreground">Atende: {p.service_zones.map((z) => zoneLabel(z)).join(", ")}</span>}
                </span>
                <span className="flex shrink-0 flex-wrap justify-end gap-1">
                  {p.is_physio && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10.5px] font-medium text-primary">Fisioterapeuta</span>}
                  {p.kinds.filter((k) => k !== "staff" || !p.is_physio).slice(0, 2).map((k) => <span key={k} className="rounded-full bg-muted px-2 py-0.5 text-[10.5px] text-muted-foreground">{KIND_LABEL[k] ?? k}</span>)}
                </span>
              </CommandItem>))}
          </CommandGroup>)}
        {!pagesMode && (res.isFetching || typing) && hits.length === 0 && debounced.length >= 2 && <p className="px-4 py-6 text-center text-sm text-muted-foreground" role="status">Buscando…</p>}
        {searchedNothing && (
          <div className="px-4 py-6 text-center text-sm" data-testid="cmd-vazio" role="status">
            <p className="font-medium">Nenhuma pessoa encontrada para “{debounced}”.</p>
            <p className="mt-1 text-[12.5px] text-muted-foreground">Todas as partes precisam combinar. Tente menos palavras (ex.: só o bairro) ou outra grafia.</p>
          </div>)}
        {!pagesMode && res.error && <p className="px-4 py-6 text-center text-sm text-destructive" role="alert">Não foi possível buscar agora. Tente de novo.</p>}

        {/* páginas: só quando pedidas com “/” (ou para quem não tem acesso a pessoas) */}
        {pagesMode && (
          <>
            {pages.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted-foreground" data-testid="cmd-vazio">Nenhuma página encontrada{text ? ` para “${text}”` : ""}.</p> : (
              <CommandGroup heading="Ir para uma página">
                {pages.map((i) => (
                  <CommandItem key={`${i.app}|${i.label}|${i.to}`} value={`${i.app}|${i.label}|${i.to}`} onSelect={() => go(i.to)} className="gap-3 py-2.5 data-[selected='true']:bg-muted data-[selected=true]:text-foreground" data-testid="cmd-item">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><i.icon className="h-4 w-4" aria-hidden /></span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{i.label}</span>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10.5px] text-muted-foreground">{i.app}</span>
                  </CommandItem>))}
              </CommandGroup>)}
          </>)}
      </CommandList>
      <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5" aria-hidden><Kbd><ArrowUp className="h-3 w-3" /></Kbd><Kbd><ArrowDown className="h-3 w-3" /></Kbd>navegar<Kbd><CornerDownLeft className="h-3 w-3" /></Kbd>abrir<Kbd>Esc</Kbd>fechar</span>
        {!pagesMode && res.data && res.data.total > hits.length ? <button type="button" className="text-accent hover:underline" onClick={() => go(`/admin/pessoas?q=${encodeURIComponent(debounced)}`, debounced)}>Ver todos os {res.data.total.toLocaleString("pt-BR")} em Pessoas</button> : <span />}
      </div>
    </CommandDialog>
  );
};
export default CommandMenu;
