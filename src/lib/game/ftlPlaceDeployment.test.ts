import { describe, expect, it } from "vitest";
import {
    FTL_FIGHTER_PLACE_RADIUS_MU,
    FTL_GUNBOAT_PLACE_RADIUS_MU,
    autoDeployedSquadrons,
    ftlSquadronsNeedingDeployment,
    randomDeployedOffset,
    validateFtlDeployDistance,
} from "./ftlPlaceDeployment";

describe("ftlPlaceDeployment", () => {
    it("lists required FTL gunboats and optional FTL fighters in hangars only", () => {
        const ssd = {
            fighters: [
                { type: "standard", number: 6, mods: ["ftl"], hangar: "H1" },
                { type: "standard", number: 6, mods: ["ftl"] },
            ],
            gunboatSquadrons: [
                {
                    id: "gb1",
                    mods: ["ftl"],
                    boats: [{ type: "missile" }, { type: "missile" }],
                },
            ],
        } as import("ftlibship").FullThrustShip;
        const entries = ftlSquadronsNeedingDeployment("ship1", ssd);
        expect(entries).toHaveLength(2);
        const gb = entries.find((e) => e.objType === "gunboats");
        const f = entries.find((e) => e.objType === "fighters");
        expect(gb?.optional).toBe(false);
        expect(gb?.radiusMu).toBe(FTL_GUNBOAT_PLACE_RADIUS_MU);
        expect(f?.optional).toBe(true);
        expect(f?.radiusMu).toBe(FTL_FIGHTER_PLACE_RADIUS_MU);
    });

    it("random offset is reproducible and within radius", () => {
        const a = randomDeployedOffset("s", "g1", 9);
        const b = randomDeployedOffset("s", "g1", 9);
        expect(a).toEqual(b);
        expect(Math.hypot(a.x, a.y)).toBeLessThanOrEqual(9.01);
    });

    it("validates deploy distance", () => {
        expect(validateFtlDeployDistance({ x: 0, y: 0 }, { x: 5, y: 0 }, 6)).toBeUndefined();
        expect(validateFtlDeployDistance({ x: 0, y: 0 }, { x: 10, y: 0 }, 6)).toMatch(/10\.0/);
    });

    it("lists optional FTL fighters assigned to hangars", () => {
        const ssd = {
            fighters: [
                { type: "standard", number: 6, mods: ["ftl"], hangar: "H1" },
                { type: "standard", number: 6, mods: [], hangar: "H2" },
            ],
            gunboatSquadrons: [],
        } as import("ftlibship").FullThrustShip;
        const entries = ftlSquadronsNeedingDeployment("ship1", ssd);
        expect(entries).toHaveLength(1);
        expect(entries[0].optional).toBe(true);
        expect(entries[0].id).toBe("ship1_H1");
    });

    it("lists each FTL hangar wing with a unique id", () => {
        const ssd = {
            fighters: [
                { type: "standard", number: 6, mods: ["ftl"], hangar: "H1" },
                { type: "heavy", number: 6, mods: ["ftl"], hangar: "H2" },
            ],
        } as import("ftlibship").FullThrustShip;
        const entries = ftlSquadronsNeedingDeployment("ship1", ssd);
        expect(entries).toHaveLength(2);
        expect(new Set(entries.map((e) => e.id)).size).toBe(2);
        expect(entries.every((e) => e.optional)).toBe(true);
    });

    it("autoDeployedSquadrons covers all entries", () => {
        const entries = ftlSquadronsNeedingDeployment("s", {
            fighters: [{ type: "a", mods: ["ftl"], hangar: "H1" }],
        } as import("ftlibship").FullThrustShip);
        const out = autoDeployedSquadrons("s", { x: 1, y: 2 }, entries, 12);
        expect(out).toHaveLength(1);
        expect(out[0].endurance).toBe(5);
        expect(Math.hypot(out[0].position.x - 1, out[0].position.y - 2)).toBeLessThanOrEqual(6.01);
    });
});
