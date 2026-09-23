import { defineConfig } from "@playwright/test";

// E2E contra o Supabase DEV (nunca produção). Usa o Edge já instalado (sem baixar navegador).
// Variáveis: HP_QA_PASSWORD (senha das contas de QA do Dev, fora do repositório), E2E_BASE_URL (opcional; padrão local).
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5180";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL, channel: "msedge", trace: "retain-on-failure", screenshot: "only-on-failure", locale: "pt-BR" },
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: "node node_modules/vite/bin/vite.js --port 5180 --host 127.0.0.1",
    url: baseURL, reuseExistingServer: true, timeout: 60_000,
  },
});
