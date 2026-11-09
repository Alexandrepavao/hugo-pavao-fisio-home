import { describe, expect, it } from "vitest";
import { featureOn } from "./release";

describe("app Marketing no perfil de entrega", () => {
  it("fica visível em desenvolvimento/preview (o build de PRODUÇÃO o esconde até a promoção ser decidida)", () => { expect(featureOn("marketing")).toBe(true); });
});
