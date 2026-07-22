import { describe, expect, it } from "vitest";
import {
    applySalvoMissileKills,
    DEFAULT_SALVO_MISSILE_COUNT,
    initialSalvoFields,
    isSalvoOrdnanceType,
    salvoMissileCount,
} from "./salvoOrdnance";

describe("salvoOrdnance", () => {
    it("identifies salvo family types", () => {
        expect(isSalvoOrdnanceType("salvo")).toBe(true);
        expect(isSalvoOrdnanceType("salvoER")).toBe(true);
        expect(isSalvoOrdnanceType("missile")).toBe(false);
    });

    it("defaults salvo count to six for legacy markers", () => {
        expect(salvoMissileCount({ type: "salvo" })).toBe(6);
        expect(initialSalvoFields("salvo")).toEqual({ salvoCount: DEFAULT_SALVO_MISSILE_COUNT });
        expect(initialSalvoFields("missile")).toEqual({});
    });

    it("decrements salvo count and reports depletion at zero", () => {
        const ord = { type: "salvo", salvoCount: 3 };
        expect(applySalvoMissileKills(ord, 2)).toEqual({ remaining: 1, depleted: false });
        expect(ord.salvoCount).toBe(1);
        expect(applySalvoMissileKills(ord, 1)).toEqual({ remaining: 0, depleted: true });
        expect(ord.salvoCount).toBe(0);
    });
});
