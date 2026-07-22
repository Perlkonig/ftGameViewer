import { describe, expect, it } from "vitest";
import { buildGunboatMapSymbol, GUNBOAT_MAP_TOKEN_W_MU } from "@/lib/gunboatMarker";

describe("gunboatMarker", () => {
    it("builds a symbol with the token id and SSD-style insert labels", () => {
        const sym = buildGunboatMapSymbol("gb_token_1", [
            "beam",
            "beam",
            "pointDefense",
            "missile",
            "rocket",
            "ads",
        ]);
        expect(sym.id).toBe("gb_token_1");
        expect(sym.svg).toContain('symbol id="gb_token_1"');
        expect(sym.svg).toContain(">B<");
        expect(sym.svg).toContain(">PDS<");
        expect(sym.svg).not.toContain("BmBm");
    });

    it("uses tactical map token width smaller than authored glyph MU", () => {
        expect(GUNBOAT_MAP_TOKEN_W_MU).toBeLessThan(0.5);
    });
});
