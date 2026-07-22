import { describe, expect, it } from "vitest";
import {
    resolveFighterIntercept,
    isInterceptableOrdnanceType,
    enemyInterceptableOrdnance,
    interceptableOrdnanceForFighter,
    validateInterceptOrdnance,
} from "./fighterIntercept";
import { arrayRollSource } from "./dice";
import { fighterCanInterceptType } from "./fighterEndurance";
import type { FullThrustGamePosition } from "@/schemas/position";

function positionWith(
    fighter: Record<string, unknown>,
    ordnance: Record<string, unknown>
): FullThrustGamePosition {
    return { objects: [fighter, ordnance] } as FullThrustGamePosition;
}

describe("fighterIntercept", () => {
    it("identifies interceptable ordnance types", () => {
        expect(isInterceptableOrdnanceType("salvo")).toBe(true);
        expect(isInterceptableOrdnanceType("mine")).toBe(false);
    });

    it("blocks attack and torpedo fighter types", () => {
        expect(fighterCanInterceptType("attack")).toBe(false);
        expect(fighterCanInterceptType("torpedo")).toBe(false);
        expect(fighterCanInterceptType("standard")).toBe(true);
    });

    it("destroys one salvo missile on 5–6 without removing marker until empty", () => {
        const result = resolveFighterIntercept(1, "salvo", { salvoCount: 6 }, arrayRollSource([5, 3]));
        expect(result.ordnanceKills).toBe(1);
        expect(result.ordnanceDestroyed).toBe(false);
    });

    it("removes salvo marker when last missile is killed", () => {
        const result = resolveFighterIntercept(1, "salvo", { salvoCount: 1 }, arrayRollSource([5, 3]));
        expect(result.ordnanceKills).toBe(1);
        expect(result.ordnanceDestroyed).toBe(true);
    });

    it("disrupts AMT at 3 hits", () => {
        const result = resolveFighterIntercept(
            1,
            "amt",
            { interceptHits: 2 },
            arrayRollSource([4, 3])
        );
        expect(result.amtHits).toBe(1);
        expect(result.ordnanceDestroyed).toBe(true);
    });

    it("heavy missile requires 6", () => {
        const miss = resolveFighterIntercept(1, "missile", {}, arrayRollSource([5]));
        expect(miss.ordnanceDestroyed).toBe(false);
        const hit = resolveFighterIntercept(1, "missile", {}, arrayRollSource([6, 2]));
        expect(hit.ordnanceDestroyed).toBe(true);
    });

    it("lists enemy interceptable ordnance regardless of arc", () => {
        const fighter = {
            id: "A1_EQ2W6",
            objType: "fighters",
            owner: "Player 1",
            position: { x: 34, y: 22.8 },
            facing: 12,
            number: 6,
            endurance: 3,
            type: "standard",
        };
        const ordnance = {
            id: "eLiurtoN",
            objType: "ordnance",
            owner: "Player 2",
            type: "salvo",
            position: { x: 31, y: 23.1 },
        };
        const pos = positionWith(fighter, ordnance);
        expect(enemyInterceptableOrdnance(pos, fighter as never).map((o) => o.id)).toEqual([
            "eLiurtoN",
        ]);
        expect(interceptableOrdnanceForFighter(pos, fighter as never)).toHaveLength(0);
        const issues = validateInterceptOrdnance(pos, "A1_EQ2W6", "eLiurtoN", 8);
        expect(issues.some((i) => i.message.includes("front 180"))).toBe(true);
        expect(issues.some((i) => i.severity === "error")).toBe(false);
    });
});
