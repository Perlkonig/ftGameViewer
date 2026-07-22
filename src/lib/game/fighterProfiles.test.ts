import { describe, expect, it } from "vitest";
import { fighterCanInterceptProfile, fighterProfileFor } from "./fighterProfiles";
import { isFighterMissionConfigured } from "./fighterWing";

describe("fighterProfiles", () => {
    it("multiRole is not mission configured", () => {
        expect(isFighterMissionConfigured({ type: "multiRole" })).toBe(false);
    });

    it("interceptor can intercept", () => {
        expect(fighterCanInterceptProfile({ type: "interceptor" })).toBe(true);
        expect(fighterProfileFor({ type: "attack" }).canIntercept).toBe(false);
    });

    it("fast mod increases primary move", () => {
        const p = fighterProfileFor({ type: "standard", mods: ["fast"] });
        expect(p.movePrimaryMu).toBe(36);
    });
});
