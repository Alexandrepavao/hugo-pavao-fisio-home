import { describe, expect, it } from "vitest";
import { featureOn } from "./release";

describe("app Marketing no perfil de entrega", () => {
  it("fica visível também no build de produção (promoção autorizada em 09/11/2026)", () => { expect(featureOn("marketing")).toBe(true); });
});
