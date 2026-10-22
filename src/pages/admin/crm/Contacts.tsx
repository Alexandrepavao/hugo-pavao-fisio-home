import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { brl } from "@/lib/format";
import { PageHead, State, Table, Td } from "@/lib/ui";
import PersonFormAnswers from "@/components/hp/PersonFormAnswers";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import CrmGeoSection from "./CrmGeoSection";
import { useUnits } from "../finance/shared";

interface Row { person_id: string; full_name: string; unit_id: string; city: string | null; uf: string | null; open: number; won: number; lost: number; wonValue: number }

/** Contatos comerciais: pessoas do cadastro central com ao menos uma oportunidade — não duplica o cadastro
 *  (edição completa continua em Pessoas); aqui é a lente comercial (quantos negócios, quanto já converteu). */
const Contacts = () => {
  const [search, setSearch] = useState(""); const [unit, setUnit] = useState(""); const [uf, setUf] = useState<string | null>(null); const [openPerson, setOpenPerson] = useState<Row | null>(null);
  const units = useUnits();

  const rows = useQuery({ queryKey: ["crm-contacts", unit], queryFn: async () => {
    let q = supabase.from("opportunities").select("person_id, unit_id, status, value_cents, person:people(full_name, city, state_uf)").limit(3000);
    if (unit) q = q.eq("unit_id", unit);
    const { data, error } = await q; if (error) throw error;
    const by = new Map<string, Row>();
    for (const o of data as unknown as { person_id: string; unit_id: string; status: string; value_cents: number; person: { full_name: string; city: string | null; state_uf: string | null } | null }[]) {
      if (!by.has(o.person_id)) by.set(o.person_id, { person_id: o.person_id, full_name: o.person?.full_name ?? "—", unit_id: o.unit_id, city: o.person?.city ?? null, uf: o.person?.state_uf ?? null, open: 0, won: 0, lost: 0, wonValue: 0 });
      const r = by.get(o.person_id)!;
      if (o.status === "open") r.open++; else if (o.status === "won") { r.won++; r.wonValue += o.value_cents; } else r.lost++;
    }
    return [...by.values()].sort((a, b) => a.full_name.localeCompare(b.full_name));
  } });

  const filtered = useMemo(() => (rows.data ?? []).filter((r) => (!search || r.full_name.toLowerCase().includes(search.toLowerCase())) && (!uf || r.uf === uf)), [rows.data, search, uf]);

  return (
    <div>
      <PageHead eyebrow="CRM" title="Contatos" hint="Pessoas com pelo menos uma oportunidade — para cadastrar ou editar dados pessoais, use Pessoas." />
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <label className="sr-only" htmlFor="ct-q">Buscar</label>
        <input id="ct-q" placeholder="Buscar por nome" value={search} onChange={(e) => setSearch(e.target.value)} className="!h-9 rounded-full !py-0 text-[13px] min-w-[14rem]" />
        <label className="sr-only" htmlFor="ct-unit">Unidade</label>
        <select id="ct-unit" value={unit} onChange={(e) => setUnit(e.target.value)} className="!h-9 rounded-full !py-0 text-[13px]"><option value="">Todas as unidades</option>{units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
      </div>
      <CrmGeoSection unit={unit} uf={uf} onUf={setUf} />
      {uf && <p className="mb-3 text-sm"><strong>Filtrando pelo estado {uf}</strong> <button type="button" className="text-accent hover:underline ml-2" onClick={() => setUf(null)}>limpar</button></p>}
      <State loading={rows.isLoading} error={rows.error} empty={filtered.length === 0} emptyText="Nenhum contato encontrado." />
      {filtered.length > 0 && (
        <Table head={["Nome", "Cidade/UF", "Em aberto", "Ganhos", "Perdidos", "Valor ganho", ""]} right={[2, 3, 4, 5]}>
          {filtered.map((r) => (
            <tr key={r.person_id}>
              <Td><button type="button" className="font-medium text-left text-accent hover:underline" onClick={() => setOpenPerson(r)} aria-label={`Ver formulário e dados de ${r.full_name}`}>{r.full_name}</button></Td>
              <Td>{r.city || r.uf ? `${r.city ?? "—"}/${r.uf ?? "—"}` : <span className="text-muted-foreground">não informado</span>}</Td>
              <Td num>{r.open}</Td>
              <Td num>{r.won}</Td>
              <Td num>{r.lost}</Td>
              <Td num>{r.wonValue > 0 ? brl(r.wonValue) : "—"}</Td>
              <Td><Link className="hp-btn hp-btn-outline hp-btn-sm" to={`/admin/pessoas?q=${encodeURIComponent(r.full_name)}`}>Ver cadastro</Link></Td>
            </tr>
          ))}
        </Table>
      )}
      <Sheet open={!!openPerson} onOpenChange={(o) => { if (!o) setOpenPerson(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col gap-0" data-testid="contato-detalhe">
          <SheetHeader className="px-5 pt-5 pb-3 border-b border-border text-left space-y-1.5">
            <SheetTitle className="text-[1.0625rem]">{openPerson?.full_name}</SheetTitle>
            <SheetDescription>Cidade/UF no cadastro: {openPerson?.city || openPerson?.uf ? `${openPerson?.city ?? "—"}/${openPerson?.uf ?? "—"}` : "não informado"}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-5 py-5 grid gap-4">
            {openPerson && <PersonFormAnswers personId={openPerson.person_id} empty="Esta pessoa não preencheu formulário (quiz ou página): o contato veio por outro caminho." />}
            {openPerson && <Link className="hp-btn hp-btn-outline w-fit" to={`/admin/pessoas?q=${encodeURIComponent(openPerson.full_name)}`}>Ver cadastro</Link>}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default Contacts;
