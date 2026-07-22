import { describe, expect, it } from "vitest";
import type { FullThrustGamePosition } from "@/schemas/position";
import { arrayRollSource } from "./dice";
import { resolveAmtRackThresholdExplosion } from "./ordnanceBlast";

function carrierShip(id: string, x: number, y: number) {
    return {
        objType: "ship" as const,
        id,
        owner: "P1",
        position: { x, y },
        facing: 0 as const,
        speed: 0,
        object: {
            hull: { points: 12, rows: 3 },
            armour: [[2, 0]],
        },
        dmgHull: 0,
        dmgArmour: [{ standard: 0, regenerative: 0 }],
    };
}

describe("resolveAmtRackThresholdExplosion", () => {
    it("applies hull-only damage to carrier and nearby units within 1 MU", () => {
        const position: FullThrustGamePosition = {
            map: { mode: "fixed", width: 72, height: 48 },
            objects: [
                carrierShip("C1", 10, 10),
                carrierShip("N1", 10.5, 10),
                {
                    objType: "fighters" as const,
                    id: "FG1",
                    owner: "P2",
                    position: { x: 9.5, y: 10 },
                    number: 4,
                    facing: 0,
                    svg: "",
                },
                carrierShip("FAR", 14, 10),
            ],
        };
        const result = resolveAmtRackThresholdExplosion(
            position,
            "C1",
            "amt1",
            arrayRollSource([4, 3, 2])
        );
        const dmg = result.commands.filter((c) => c.name === "dmgShip") as {
            ship?: string;
            hull?: number;
            armour?: number[];
        }[];
        expect(dmg.find((c) => c.ship === "C1")).toEqual({ name: "dmgShip", ship: "C1", hull: 4 });
        expect(dmg.find((c) => c.ship === "N1")?.hull).toBe(2);
        expect(dmg.some((c) => c.ship === "FAR")).toBe(false);
        expect(
            result.commands.some(
                (c) => c.name === "adjustFighters" && (c as { uuid?: string }).uuid === "FG1"
            )
        ).toBe(true);
    });

    it("does not apply armour damage to carrier", () => {
        const position: FullThrustGamePosition = {
            map: { mode: "fixed", width: 72, height: 48 },
            objects: [carrierShip("C1", 0, 0)],
        };
        const result = resolveAmtRackThresholdExplosion(
            position,
            "C1",
            "amt1",
            arrayRollSource([5])
        );
        const dmg = result.commands.find((c) => c.name === "dmgShip") as {
            hull?: number;
            armour?: number[];
        };
        expect(dmg?.hull).toBe(5);
        expect(dmg?.armour).toBeUndefined();
    });
});
