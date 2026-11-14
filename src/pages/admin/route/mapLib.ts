// Carregador ÚNICO do MapLibre GL JS (renderizador livre; os tiles vêm do OpenFreeMap, sem chave). Fica isolado aqui para o resto do app
// não depender do carregamento: se a biblioteca não estiver instalada/for bloqueada, a tela mostra o estado honesto "Mapa indisponível".
// PENDENTE: a dependência `maplibre-gl` ainda não está instalada neste ambiente (instalação aguardando autorização). Depois de instalar,
// troque a linha do import dinâmico por `import("maplibre-gl")` + `import "maplibre-gl/dist/maplibre-gl.css"` para o bundler incluir a biblioteca.
export type MapLibre = any;
export const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
export const MAP_ATTRIBUTION = "Mapa: OpenFreeMap · © OpenMapTiles · Dados © OpenStreetMap contributors";
let cached: Promise<MapLibre | null> | null = null;
export const loadMapLibre = (): Promise<MapLibre | null> => {
  cached ??= (async () => {
    try { const spec = "maplibre-gl"; const mod = await import(/* @vite-ignore */ spec); return mod.default ?? mod; } catch { return null; }
  })();
  return cached;
};
