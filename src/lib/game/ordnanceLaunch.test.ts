import { describe, expect, it } from "vitest";
import {
    inferOrdnanceType,
    rocketHitThreshold,
    resolveRocketHits,
    listLaunchableSystems,
    bearingInSystemArc,
} from "./ordnanceLaunch";
import type { ShipGameState } from "./shipSystems";

describe("ordnanceLaunch", () => {
    it("infers ordnance types from SSD systems", () => {
        expect(inferOrdnanceType({ id: "a", name: "missile", modifier: "twostage" })).toEqual({
            gameType: "missile",
            modifier: "twostage",
        });
        expect(inferOrdnanceType({ id: "b", name: "salvo", modifier: "er" })).toEqual({
            gameType: "salvoER",
            modifier: "er",
        });
        expect(inferOrdnanceType({ id: "c", name: "rocketPod" })).toEqual({
            gameType: "rocket",
            modifier: "none",
        });
    });

    it("rocket hit thresholds by range", () => {
        expect(rocketHitThreshold(5)).toBe(2);
        expect(rocketHitThreshold(10)).toBe(3);
        expect(rocketHitThreshold(18)).toBe(4);
    });

    it("resolveRocketHits applies thresholds", () => {
        expect(resolveRocketHits([2, 1], 5)).toEqual([true, false]);
        expect(resolveRocketHits([4, 4], 15)).toEqual([true, true]);
        expect(resolveRocketHits([3, 3], 15)).toEqual([false, false]);
    });

    it("lists launchable systems excluding spent pods", () => {
        const ship: ShipGameState = {
            id: "S1",
            object: {
                ordnance: [
                    { id: "m1", name: "missile", shots: 1 },
                    { id: "r1", name: "rocketPod" },
                ],
            },
            ammo: ["m1"],
        };
        const systems = listLaunchableSystems(ship);
        expect(systems.map((s) => s.systemId)).toEqual(["r1"]);
    });

    it("tracks salvo launcher ammo via linked magazine", () => {
        const ship: ShipGameState = {
            id: "S1",
            object: {
                systems: [{ id: "mag1", name: "magazine", capacity: 3 }],
                ordnance: [{ id: "sl1", name: "salvoLauncher", magazine: "mag1" }],
            },
            ammo: ["mag1", "mag1", "mag1"],
        };
        expect(listLaunchableSystems(ship)).toHaveLength(0);
        const partial = { ...ship, ammo: ["mag1"] };
        const systems = listLaunchableSystems(partial);
        expect(systems).toHaveLength(1);
        expect(systems[0]?.remaining).toBe(2);
    });

    it("bearingInSystemArc uses SSD arc letters", () => {
        const ship = { x: 0, y: 0 };
        expect(bearingInSystemArc(ship, 12, { x: 0, y: -10 }, "F", 3)).toBe(true);
        expect(bearingInSystemArc(ship, 12, { x: 0, y: 10 }, "F", 1)).toBe(false);
        expect(bearingInSystemArc(ship, 12, { x: 0, y: -10 }, "FP", 3)).toBe(true);
    });
});
