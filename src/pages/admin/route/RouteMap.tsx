import { useEffect, useRef, useState } from "react";
import { loadMapLibre, MAP_ATTRIBUTION, STYLE_URL } from "./mapLib";

export interface MapPoint { key: string; n: number | null; lat: number; lng: number; label: string; kind?: "stop" | "start" | "remote" | "approx" }
interface Props { points: MapPoint[]; line?: [number, number][] | null; attribution?: string | null; onPick?: (p: { lat: number; lng: number }) => void; pin?: { lat: number; lng: number } | null; height?: number }

/** Mapa (MapLibre + OpenFreeMap). Pontos numerados na ordem do dia; a linha só aparece quando o provedor devolveu a GEOMETRIA do trajeto (nunca uma reta inventada).
 *  Com `onPick`, vira o seletor do alfinete manual (clique = posição; o usuário confirma antes de salvar). */
const RouteMap = ({ points, line, attribution, onPick, pin, height }: Props) => {
  const el = useRef<HTMLDivElement>(null); const mapRef = useRef<any>(null); const libRef = useRef<any>(null); const markers = useRef<any[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  const pickRef = useRef(onPick); pickRef.current = onPick;

  useEffect(() => {
    let dead = false;
    void loadMapLibre().then((lib) => {
      if (dead) return; if (!lib || !el.current) { setState("unavailable"); return; }
      libRef.current = lib;
      try {
        const map = new lib.Map({ container: el.current, style: STYLE_URL, center: [-46.65, -23.55], zoom: 10, attributionControl: { compact: true } });
        map.addControl(new lib.NavigationControl({ showCompass: false }), "top-right");
        map.on("load", () => { if (!dead) setState("ready"); }); map.on("error", () => { /* tiles falhando não derrubam a tela */ });
        map.on("click", (e: any) => pickRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
        mapRef.current = map;
      } catch { setState("unavailable"); }
    });
    return () => { dead = true; markers.current.forEach((m) => m.remove()); mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current, lib = libRef.current; if (!map || !lib || state !== "ready") return;
    markers.current.forEach((m) => m.remove()); markers.current = [];
    const all = [...points, ...(pin ? [{ key: "pin", n: null, lat: pin.lat, lng: pin.lng, label: "Alfinete", kind: "stop" as const }] : [])];
    for (const p of all) {
      const d = document.createElement("div");
      d.setAttribute("role", "img"); d.setAttribute("aria-label", p.n ? `${p.n}. ${p.label}` : p.label);
      d.style.cssText = `width:30px;height:30px;border-radius:50%;display:grid;place-items:center;font:700 13px system-ui;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);color:#fff;background:${p.kind === "start" ? "#6B4FA3" : p.kind === "remote" ? "#8d7bbd" : p.kind === "approx" ? "#c98a00" : "#12284C"}`;
      d.textContent = p.kind === "start" ? "P" : p.n ? String(p.n) : "•";
      markers.current.push(new lib.Marker({ element: d }).setLngLat([p.lng, p.lat]).addTo(map));
    }
    if (all.length) { const b = new lib.LngLatBounds(); all.forEach((p) => b.extend([p.lng, p.lat])); map.fitBounds(b, { padding: 50, maxZoom: 15, duration: 0 }); }
  }, [points, pin, state]);

  useEffect(() => {
    const map = mapRef.current; if (!map || state !== "ready") return;
    const data = { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line ?? [] } };
    if (map.getSource("trajeto")) { map.getSource("trajeto").setData(data); return; }
    map.addSource("trajeto", { type: "geojson", data });
    map.addLayer({ id: "trajeto", type: "line", source: "trajeto", paint: { "line-color": "#2f6fe4", "line-width": 4, "line-opacity": 0.85 }, layout: { "line-cap": "round", "line-join": "round" } });
  }, [line, state]);

  return (
    <div className="rt-mapbox" data-testid="route-map" data-state={state}>
      <div ref={el} className={`rt-map${onPick ? " rt-pin" : ""}`} style={height ? { height } : undefined} />
      {state !== "ready" && <div className="rt-mapmsg" role="status">{state === "loading" ? "Carregando o mapa…" : "Mapa indisponível neste ambiente. A lista com os tempos estimados continua funcionando."}</div>}
      <p className="rt-attrib">{MAP_ATTRIBUTION}{attribution ? ` · ${attribution}` : ""}</p>
    </div>
  );
};
export default RouteMap;
