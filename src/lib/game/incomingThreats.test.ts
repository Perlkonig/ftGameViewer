import { describe, expect, it } from "vitest";
import type { FullThrustGamePosition } from "@/schemas/position";
import {
    shipAttackQualifiedWingIds,
    mutuallyEngagedFighterIds,
    incomingThreatsForPhase9,
    isHostileThreatToProtectedShip,
} from "./incomingThreats";
import { analyzeSkirmishCoverage, furballSkirmishes } from "./fighterScreening";

function fighter(
    id: string,
    alloc?: { targetType: "ship" | "fighters"; targetId: string },
    number = 6
) {
    return {
        objType: "fighters" as const,
        id,
        owner: "P1",
        type: "standard" as const,
        number,
        endurance: 6,
        skill: "standard" as const,
        position: { x: 0, y: 0 },
        facing: 12,
        ...(alloc
            ? {
                  attackAllocation: {
                      turn: 1,
                      targetType: alloc.targetType,
                      targetId: alloc.targetId,
                  },
              }
            : {}),
    };
}

describe("incomingThreats", () => {
    it("qualifies direct ship attackers without screening", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            players: [],
            objects: [
                fighter("ATK", { targetType: "ship", targetId: "S1" }),
                { objType: "ship" as const, id: "S1", owner: "P2", position: { x: 1, y: 0 } },
            ],
        } as FullThrustGamePosition;
        const allocations = [
            { groupId: "ATK", targetType: "ship" as const, targetId: "S1", turn: 1 },
        ];
        const { qualified, forfeited } = shipAttackQualifiedWingIds(position, allocations, []);
        expect(qualified.get("ATK")).toBe("S1");
        expect(forfeited.has("ATK")).toBe(false);
    });

    it("forfeits attackers who fought screeners without bypass", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            players: [],
            objects: [
                fighter("ATK", { targetType: "ship", targetId: "S1" }),
                {
                    ...fighter("SCR", undefined, 6),
                    owner: "P2",
                    fighterAttachment: {
                        kind: "screen" as const,
                        targetType: "ship" as const,
                        targetId: "S1",
                    },
                },
                { objType: "ship" as const, id: "S1", owner: "P2", position: { x: 1, y: 0 } },
            ],
        } as FullThrustGamePosition;
        const allocations = [
            { groupId: "ATK", targetType: "ship" as const, targetId: "S1", turn: 1 },
        ];
        const skirmishes = furballSkirmishes(position, allocations);
        const screening = skirmishes.find((s) => s.kind === "screening")!;
        const declarations = [
            {
                attackers: [{ id: "ATK", targetIds: ["SCR"] }],
                defenders: [{ id: "SCR", targetIds: ["ATK"] }],
            },
        ];
        const cov = analyzeSkirmishCoverage(screening, position, declarations, skirmishes);
        expect(cov.furballAttackers.has("ATK")).toBe(true);
        expect(cov.shipStrikeThroughAttackers.has("ATK")).toBe(false);

        const { qualified, forfeited } = shipAttackQualifiedWingIds(
            position,
            allocations,
            declarations
        );
        expect(qualified.has("ATK")).toBe(false);
        expect(forfeited.has("ATK")).toBe(true);
    });

    it("qualifies strike-through bypass attackers", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            players: [],
            objects: [
                fighter("ATK", { targetType: "ship", targetId: "S1" }),
                {
                    ...fighter("SCR", undefined, 6),
                    owner: "P2",
                    fighterAttachment: {
                        kind: "screen" as const,
                        targetType: "ship" as const,
                        targetId: "S1",
                    },
                },
                { objType: "ship" as const, id: "S1", owner: "P2", position: { x: 1, y: 0 } },
            ],
        } as FullThrustGamePosition;
        const allocations = [
            { groupId: "ATK", targetType: "ship" as const, targetId: "S1", turn: 1 },
        ];
        const declarations = [
            {
                attackers: [{ id: "ATK", targetIds: ["S1"] }],
                defenders: [],
            },
        ];
        const { qualified, forfeited } = shipAttackQualifiedWingIds(
            position,
            allocations,
            declarations
        );
        expect(qualified.get("ATK")).toBe("S1");
        expect(forfeited.has("ATK")).toBe(false);
    });

    it("detects mutual fighter engagement", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            players: [],
            objects: [fighter("A"), fighter("B")],
        } as FullThrustGamePosition;
        const allocations = [
            { groupId: "A", targetType: "fighters" as const, targetId: "B", turn: 1 },
            { groupId: "B", targetType: "fighters" as const, targetId: "A", turn: 1 },
        ];
        const engaged = mutuallyEngagedFighterIds(position, allocations);
        expect(engaged.has("A")).toBe(true);
        expect(engaged.has("B")).toBe(true);
    });

    it("incomingThreatsForPhase9 lists ordnance with targetShip", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            players: [],
            objects: [
                {
                    objType: "ordnance" as const,
                    id: "M1",
                    owner: "P1",
                    type: "salvo",
                    position: { x: 0, y: 0 },
                    targetShip: "S2",
                    salvoCount: 4,
                },
                { objType: "ship" as const, id: "S2", owner: "P2", position: { x: 1, y: 0 } },
            ],
        } as FullThrustGamePosition;
        const board = incomingThreatsForPhase9(position, [], 1);
        expect(board.ordnance).toHaveLength(1);
        expect(board.ordnance[0].ordnanceId).toBe("M1");
    });

    it("isHostileThreatToProtectedShip rejects same-owner fighters and ordnance", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            players: [],
            objects: [
                {
                    objType: "fighters" as const,
                    id: "F1",
                    owner: "P1",
                    number: 6,
                    position: { x: 0, y: 0 },
                },
                {
                    objType: "ordnance" as const,
                    id: "M1",
                    owner: "P1",
                    type: "salvo",
                    position: { x: 1, y: 0 },
                    targetShip: "S1",
                },
                { objType: "ship" as const, id: "S1", owner: "P1", position: { x: 2, y: 0 } },
                {
                    objType: "fighters" as const,
                    id: "F2",
                    owner: "P2",
                    number: 6,
                    position: { x: 3, y: 0 },
                },
            ],
        } as FullThrustGamePosition;
        expect(isHostileThreatToProtectedShip(position, "F1", "S1")).toBe(false);
        expect(isHostileThreatToProtectedShip(position, "M1", "S1")).toBe(false);
        expect(isHostileThreatToProtectedShip(position, "F2", "S1")).toBe(true);
    });
});
