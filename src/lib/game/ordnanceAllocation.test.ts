import { describe, expect, it } from "vitest";
import {
    buildOrdnanceAllocationProposals,
    applyOrdnanceAllocationsToPosition,
    phase7OrdnanceLogCommands,
    findClosestEnemyShip,
    homingRangeForTargetShip,
    isMultistageStage1,
    proposeAllocationForOrdnance,
    HOMING_CINEMATIC_RANGE_MU,
    HOMING_VECTOR_RANGE_MU,
} from "./ordnanceAllocation";
import type { FullThrustGamePosition } from "@/schemas/position";

function pos(objects: NonNullable<FullThrustGamePosition["objects"]>): FullThrustGamePosition {
    return {
        map: { mode: "fixed", width: 72, height: 48 },
        players: [
            { id: "P1", colour: "#f00" },
            { id: "P2", colour: "#00f" },
        ],
        objects,
    };
}

describe("ordnanceAllocation", () => {
    it("uses 6 MU for cinematic targets and 3 MU for vector targets", () => {
        const cinematic = {
            objType: "ship" as const,
            id: "S1",
            owner: "P2",
            position: { x: 5, y: 0 },
            facing: 12 as const,
            speed: 0,
            object: {},
            svg: "",
        };
        const vector = { ...cinematic, movementMode: "vector" as const, course: 0 };
        expect(homingRangeForTargetShip(cinematic)).toBe(HOMING_CINEMATIC_RANGE_MU);
        expect(homingRangeForTargetShip(vector)).toBe(HOMING_VECTOR_RANGE_MU);
    });

    it("picks closest enemy ship within range", () => {
        const position = pos([
            {
                objType: "ordnance",
                id: "M1",
                owner: "P1",
                type: "missile",
                position: { x: 0, y: 0 },
            },
            {
                objType: "ship",
                id: "Near",
                owner: "P2",
                position: { x: 4, y: 0 },
                facing: 12,
                speed: 0,
                object: {},
                svg: "",
            },
            {
                objType: "ship",
                id: "Far",
                owner: "P2",
                position: { x: 5.5, y: 0 },
                facing: 12,
                speed: 0,
                object: {},
                svg: "",
            },
        ]);
        const closest = findClosestEnemyShip(position, { x: 0, y: 0 }, "P1");
        expect(closest?.id).toBe("Near");
    });

    it("stage-1 multistage survives with no target; others destroy", () => {
        const position = pos([
            {
                objType: "ordnance",
                id: "MS1",
                owner: "P1",
                type: "salvoMS",
                stage: 1,
                position: { x: 0, y: 0 },
            },
            {
                objType: "ordnance",
                id: "H1",
                owner: "P1",
                type: "missile",
                position: { x: 0, y: 0 },
            },
        ]);
        const ms = position.objects![0];
        expect(isMultistageStage1(ms as never)).toBe(true);
        expect(proposeAllocationForOrdnance(position, ms as never).action).toBe("skip");
        expect(proposeAllocationForOrdnance(position, position.objects![1] as never).action).toBe(
            "destroy"
        );
    });

    it("skips AMT with detonateOpenSpace", () => {
        const position = pos([
            {
                objType: "ordnance",
                id: "A1",
                owner: "P1",
                type: "amt",
                detonateOpenSpace: true,
                position: { x: 0, y: 0 },
            },
        ]);
        const proposals = buildOrdnanceAllocationProposals(position);
        expect(proposals).toEqual([{ ordnanceId: "A1", action: "skip", proposed: true }]);
    });

    it("apply sets targetShip or removes destroyed ordnance", () => {
        const position = pos([
            {
                objType: "ordnance",
                id: "M1",
                owner: "P1",
                type: "missile",
                position: { x: 0, y: 0 },
            },
            {
                objType: "ordnance",
                id: "M2",
                owner: "P1",
                type: "missile",
                position: { x: 1, y: 0 },
            },
        ]);
        applyOrdnanceAllocationsToPosition(position, [
            { ordnanceId: "M1", action: "target", targetShipId: "T1", proposed: true },
            { ordnanceId: "M2", action: "destroy", proposed: true },
        ]);
        expect(position.objects).toHaveLength(1);
        expect((position.objects![0] as { targetShip?: string }).targetShip).toBe("T1");
    });

    it("builds log commands for pending proposals", () => {
        const cmds = phase7OrdnanceLogCommands([
            { ordnanceId: "M1", action: "target", targetShipId: "B1", proposed: true },
        ]);
        expect(cmds.map((c) => c.name)).toEqual([
            "allocateOrdnanceTarget",
            "applyOrdnanceAllocations",
        ]);
        expect((cmds[0] as { targetShipId?: string }).targetShipId).toBe("B1");
    });
});
