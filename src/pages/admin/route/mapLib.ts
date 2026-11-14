// Carregador ÚNICO do MapLibre GL JS (renderizador livre; os tiles vêm do OpenFreeMap, sem chave). Fica isolado aqui: a biblioteca só é
// baixada quando um mapa é aberto e, se falhar (rede/bloqueio), a tela mostra o estado honesto "Mapa indisponível".
export type MapLibre = any;
export const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
export const MAP_ATTRIBUTION = "Mapa: OpenFreeMap · © OpenMapTiles · Dados © OpenStreetMap contributors";
let cached: Promise<MapLibre | null> | null = null;
export const loadMapLibre = (): Promise<MapLibre | null> => {
  cached ??= (async () => {
    try {
      const [mod] = await Promise.all([import("maplibre-gl"), import("maplibre-gl/dist/maplibre-gl.css")]);
      return mod.default ?? mod;
    } catch { return null; }
  })();
  return cached;
};
