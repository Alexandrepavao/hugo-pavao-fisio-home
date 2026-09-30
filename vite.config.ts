/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { execSync } from "node:child_process";

// Projetos Supabase do HP Group. O build recusa combinações que misturariam ambientes (ver guardaDeAmbiente).
const SUPABASE_DEV_REF = "fsvtzowcwhvwtluwrhnb";
const SUPABASE_PROD_REF = "wfqkjrpqkaarpavjheoj";

// Identificação do deploy: commit e horário do build (Netlify define COMMIT_REF; localmente vem do git).
const commit = (process.env.COMMIT_REF ?? process.env.GITHUB_SHA ?? (() => { try { return execSync("git rev-parse HEAD").toString().trim(); } catch { return "desconhecido"; } })()).slice(0, 12);
const builtAt = new Date().toISOString();

/** Um `vite build` local lê `.env.local` (que aponta para o Dev). Foi assim que o site de produção acabou publicado com o banco Dev
 *  embutido. Regras de um build (não vale para `vite dev`):
 *   · VITE_APP_ENV=production  → o banco precisa ser o de produção (nunca o Dev);
 *   · qualquer outro ambiente → o banco não pode ser o de produção (teste/preview nunca escreve em dado real). */
function guardaDeAmbiente(url: string, appEnv: string) {
  const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url)?.[1] ?? "";
  if (appEnv === "production" && ref !== SUPABASE_PROD_REF) throw new Error(`Build de PRODUÇÃO recusado: VITE_SUPABASE_URL aponta para "${ref || "(vazio)"}", esperado o projeto de produção. Confira as variáveis do Netlify e remova .env.local do ambiente de build.`);
  if (appEnv !== "production" && ref === SUPABASE_PROD_REF) throw new Error(`Build "${appEnv}" recusado: VITE_SUPABASE_URL aponta para o banco de PRODUÇÃO. Ambientes de teste/preview usam o banco Dev.`);
  return { ref, label: ref === SUPABASE_PROD_REF ? "produção" : ref === SUPABASE_DEV_REF ? "Dev" : "outro" };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const appEnv = env.VITE_APP_ENV || "development";
  const backend = command === "build" ? guardaDeAmbiente(env.VITE_SUPABASE_URL ?? "", appEnv) : { ref: /https:\/\/([a-z0-9]+)\./.exec(env.VITE_SUPABASE_URL ?? "")?.[1] ?? "", label: "Dev" };
  const profile = env.VITE_RELEASE_PROFILE === "full" ? "full" : "v1";
  const versionFile = () => ({
    name: "hp-version-file",
    generateBundle() {
      (this as unknown as { emitFile: (f: { type: "asset"; fileName: string; source: string }) => void }).emitFile({
        type: "asset", fileName: "version.json", source: JSON.stringify({ commit, builtAt, profile, environment: appEnv, backend: backend.label, backendRef: backend.ref }, null, 2),
      });
    },
  });
  return {
    server: {
      host: "::",
      port: 8080,
    },
    define: { __BUILD_INFO__: JSON.stringify({ commit, builtAt, environment: appEnv, backend: backend.label }) },
    plugins: [
      versionFile(),
      react(),
      mode === 'development' &&
      componentTagger(),
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    test: {
      // e2e/**/*.spec.ts são testes do Playwright (rodam com `npx playwright test`, não com o Vitest);
      // sem essa exclusão o Vitest também os coleta e falha porque test.describe()/test.setTimeout() do
      // Playwright não existem nesse runner.
      exclude: ["**/node_modules/**", "**/dist/**", "e2e/**"],
    },
  };
});
