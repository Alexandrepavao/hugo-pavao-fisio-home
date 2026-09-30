// Perfil de entrega: sem VITE_RELEASE_PROFILE o padrão é "v1", que esconde os recursos incompletos.
import { describe, expect, it } from "vitest";
import { featureOn, RELEASE_PROFILE, type FeatureKey } from "./release";

const HIDDEN: FeatureKey[] = ["crm_scheduled_messages", "crm_broadcast", "system_status", "settings_pending_cards"];

describe("perfil de entrega", () => {
  it("padrão é v1 e desliga exatamente os recursos incompletos", () => {
    expect(RELEASE_PROFILE).toBe("v1");
    for (const f of HIDDEN) expect(featureOn(f), f).toBe(false);
  });
});
