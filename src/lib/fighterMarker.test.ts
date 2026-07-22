import { describe, expect, it } from "vitest";
import { buildFighterSymbol, FIGHTER_MAP_TOKEN_W_MU } from "@/lib/fighterMarker";

describe("fighterMarker", () => {
    it("builds a symbol with the wing id", () => {
        const sym = buildFighterSymbol("wing_a", { type: "standard", number: 6 });
        expect(sym.id).toBe("wing_a");
        expect(sym.svg).toContain("symbol");
        expect(sym.widthMu).toBeGreaterThan(0);
        expect(FIGHTER_MAP_TOKEN_W_MU).toBeLessThan(sym.widthMu / 4);
    });

    it("includes partial squadron marker in svg", () => {
        const sym = buildFighterSymbol("wing_b", {
            type: "interceptor",
            number: 4,
            skill: "ace",
        });
        expect(sym.svg.length).toBeGreaterThan(50);
    });
});
