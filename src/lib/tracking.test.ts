import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONSENT_KEY, pickTracking, stripClickIds } from "./tracking";

const src = (o: Record<string, string>) => (k: string) => o[k];
const mem = new Map<string, string>();
beforeEach(() => { mem.clear(); vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("rastreamento da captação (front)", () => {
  it("leva só parâmetros de campanha; ignora e-mail, token e chaves desconhecidas", () => {
    const r = pickTracking(src({ utm_source: "facebook", utm_campaign: "Camp <b>A</b>", hp_campaign_id: "123456", email: "a@b.com", token: "x", utm_term: "  ok  " }));
    expect(r).toEqual({ utm_source: "facebook", utm_campaign: "Camp bA/b", hp_campaign_id: "123456", utm_term: "ok" });
  });
  it("identificadores de clique (fbclid/gclid) SÓ com consentimento de rastreamento", () => {
    const params = src({ utm_source: "google", gclid: "Cj0KCQ_valid_123", fbclid: "IwAR_clique_123456" });
    expect(Object.keys(pickTracking(params))).toEqual(["utm_source"]);
    localStorage.setItem(CONSENT_KEY, "1");
    expect(pickTracking(params)).toMatchObject({ gclid: "Cj0KCQ_valid_123", fbclid: "IwAR_clique_123456", hp_consent: "tracking" });
  });
  it("revogar o consentimento remove os identificadores já guardados na sessão", () => {
    const stored = { utm_source: "google", gclid: "abc1234567890", hp_consent: "tracking" };
    localStorage.setItem(CONSENT_KEY, "1"); expect(stripClickIds(stored)).toEqual(stored);
    localStorage.removeItem(CONSENT_KEY); expect(stripClickIds(stored)).toEqual({ utm_source: "google" });
  });
  it("limita o tamanho dos valores", () => { expect(pickTracking(src({ utm_campaign: "x".repeat(400) })).utm_campaign).toHaveLength(150); });
});
