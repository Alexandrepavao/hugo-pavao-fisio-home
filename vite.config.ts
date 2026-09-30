/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { execSync } from "node:child_process";

// Identificação do deploy: commit e horário do build (Netlify define COMMIT_REF; localmente vem do git).
const commit = (process.env.COMMIT_REF ?? process.env.GITHUB_SHA ?? (() => { try { return execSync("git rev-parse HEAD").toString().trim(); } catch { return "desconhecido"; } })()).slice(0, 12);
const builtAt = new Date().toISOString();
const versionFile = () => ({ name: "hp-version-file", generateBundle() { (this as unknown as { emitFile: (f: { type: "asset"; fileName: string; source: string }) => void }).emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ commit, builtAt, profile: process.env.VITE_RELEASE_PROFILE === "full" ? "full" : "v1" }, null, 2) }); } });

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  define: { __BUILD_INFO__: JSON.stringify({ commit, builtAt }) },
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
}));
