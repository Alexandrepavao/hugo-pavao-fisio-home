import { lazy, Suspense, useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { parseLatLng, type Place } from "@/lib/route/api";
import { btnGhost, btnPrimary, errText, inputCls, Msg, State, useMsg } from "@/lib/ui";
import "./route.css";

const RouteMap = lazy(() => import("./RouteMap"));
type Kind = "unit" | "person" | "professional";
export const PRECISION_LABEL: Record<Place["precision"], string> = { exact: "Exata (alfinete no local)", street: "Aproximada (rua/bairro)", cep: "Aproximada por CEP (pode errar centenas de metros)" };

/** Local geográfico para a rota (unidade, paciente ou ponto de partida opcional do profissional). Alfinete MANUAL: nada é enviado a serviço de endereço.
 *  Estados de precisão visíveis; um local aproximado nunca é tratado como certeza na rota. O endereço do paciente não é geocodificado por terceiros. */
const PlaceEditor = ({ kind, id, title, hint }: { kind: Kind; id: string; title: string; hint?: string }) => {
  const qc = useQueryClient(); const [msg, m] = useMsg();
  const q = useQuery({ queryKey: ["route-place", kind, id], retry: false, queryFn: async () => { const { data, error } = await supabase.rpc("route_place_get", { p_kind: kind, p_id: id }); if (error) throw error; return data as Place | null; } });
  const [coords, setCoords] = useState(""); const [precision, setPrecision] = useState<"exact" | "street">("exact"); const [notes, setNotes] = useState(""); const [showMap, setShowMap] = useState(false);
  const parsed = parseLatLng(coords);
  useEffect(() => { const p = q.data; if (p) { setCoords(`${p.lat}, ${p.lng}`); setPrecision(p.precision === "street" ? "street" : "exact"); setNotes(p.access_notes ?? ""); } else { setCoords(""); setNotes(""); } }, [q.data, id]);
  const save = async (e: FormEvent) => {
    e.preventDefault(); if (!parsed) return m.err("Informe as coordenadas no formato “-23.5614, -46.6559”.");
    const { error } = await supabase.rpc("route_place_set", { p_kind: kind, p_id: id, p_lat: parsed.lat, p_lng: parsed.lng, p_precision: precision, p_source: "manual_pin", p_notes: notes.trim() || null });
    if (error) return m.err(errText(error)); m.ok("Local salvo. Atendimentos já marcados mantêm o local de quando foram marcados."); void qc.invalidateQueries({ queryKey: ["route-place", kind, id] });
  };
  const clear = async () => { const { error } = await supabase.rpc("route_place_clear", { p_kind: kind, p_id: id }); if (error) return m.err(errText(error)); m.ok("Local removido."); void qc.invalidateQueries({ queryKey: ["route-place", kind, id] }); };
  const p = q.data;
  return (
    <section className="rt rt-card grid gap-3" aria-label={title} data-testid={`place-${kind}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h3 className="flex items-center gap-2 text-base font-semibold"><MapPin size={16} aria-hidden />{title}</h3>{hint && <p className="rt-small rt-muted mt-0.5">{hint}</p>}</div>
        <span className={`rt-chip ${!p ? "is-lilac" : p.precision === "exact" ? "" : "is-amber"}`} data-testid="place-status">{!p ? "Localização não definida" : PRECISION_LABEL[p.precision]}</span>
      </div>
      <Msg m={msg} /><State loading={q.isLoading} error={q.error} />
      {!q.isLoading && !q.error && (
        <form onSubmit={save} className="grid gap-2 sm:grid-cols-2" aria-label="Definir local">
          <div className="sm:col-span-2"><label htmlFor={`pl-c-${kind}`} className="mb-1 block text-xs">Coordenadas (copie do Google Maps ou do OpenStreetMap: “latitude, longitude”)</label>
            <input id={`pl-c-${kind}`} className={inputCls} value={coords} onChange={(e) => setCoords(e.target.value)} placeholder="-23.5614, -46.6559" inputMode="decimal" autoComplete="off" /></div>
          <div><label htmlFor={`pl-p-${kind}`} className="mb-1 block text-xs">Precisão</label>
            <select id={`pl-p-${kind}`} className={inputCls} value={precision} onChange={(e) => setPrecision(e.target.value as "exact" | "street")}><option value="exact">Exata (alfinete no local)</option><option value="street">Aproximada (rua/bairro)</option></select></div>
          <div><label htmlFor={`pl-n-${kind}`} className="mb-1 block text-xs">Orientação de acesso (portaria, referência) — nada clínico</label>
            <input id={`pl-n-${kind}`} className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} /></div>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button className={btnPrimary} disabled={!parsed}>Salvar local</button>
            <button type="button" className={btnGhost} onClick={() => setShowMap((v) => !v)} aria-expanded={showMap}>{showMap ? "Fechar mapa" : "Marcar no mapa"}</button>
            {p && <button type="button" className={btnGhost} onClick={() => void clear()}>Remover local</button>}
          </div>
          {showMap && <div className="sm:col-span-2"><Suspense fallback={<p className="rt-small rt-muted">Carregando o mapa…</p>}>
            <RouteMap points={[]} pin={parsed ?? (p ? { lat: p.lat, lng: p.lng } : null)} height={300} onPick={(c) => { setCoords(`${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`); setPrecision("exact"); }} /></Suspense>
            <p className="rt-small rt-muted mt-1">Clique no mapa para posicionar o alfinete e depois em “Salvar local”.</p></div>}
        </form>)}
    </section>
  );
};
export default PlaceEditor;
