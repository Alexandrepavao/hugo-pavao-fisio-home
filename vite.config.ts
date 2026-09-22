/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
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
