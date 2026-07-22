import { describe, expect, it } from "vitest";
import type { FullThrustGamePosition } from "@/schemas/position";
import { applyCommand, foldCommands, type FoldState } from "./applyCommand";
import { buildPhase11HullDestructionCommands } from "./phase11HullDestruction";
import { shipsForPhase11HullDestruction } from "./thresholds";

const meta = {
    phase: 11 as const,
    turn: 1,
    version: "",
    name: "",
    createdAt: "",
    dicePolicy: "hybrid" as const,
};

const basePos = (
    ships: FullThrustGamePosition["objects"]
): FullThrustGamePosition => ({
    map: { mode: "fixed", width: 72, height: 48 },
    players: [{ id: "P1" }, { id: "P2" }],
    objects: ships,
});

describe("phase11 hull destruction helpers", () => {
    it("lists hull-depleted ships without capture flag", () => {
        const pos = basePos([
            {
                objType: "ship",
                id: "S1",
                owner: "P1",
                dmgHull: 12,
                object: { hull: { points: 12 } },
            },
            {
                objType: "ship",
                id: "S2",
                owner: "P2",
                dmgHull: 12,
                boardingCapture: { by: "P1", resolved: false },
                object: { hull: { points: 12 } },
            },
            {
                objType: "ship",
                id: "S3",
                owner: "P1",
                dmgHull: 6,
                object: { hull: { points: 12 } },
            },
        ]);
        expect(shipsForPhase11HullDestruction(pos)).toEqual(["S1"]);
    });
});

describe("buildPhase11HullDestructionCommands", () => {
    it("emits destroy commands and rollup marker", () => {
        const pos = basePos([
            {
                objType: "ship",
                id: "Dead",
                owner: "P1",
                dmgHull: 12,
                object: { hull: { points: 12 } },
            },
        ]);
        const cmds = buildPhase11HullDestructionCommands(pos);
        expect(cmds.some((c) => c.name === "_custom")).toBe(true);
        expect(
            cmds.some(
                (c) => c.name === "objDestroy" && (c as { uuid: string }).uuid === "Dead"
            )
        ).toBe(true);
        expect(cmds.some((c) => c.name === "resolvePhase11HullDestruction")).toBe(true);
    });

    it("skips ships with boardingCapture", () => {
        const pos = basePos([
            {
                objType: "ship",
                id: "Captured",
                owner: "P2",
                dmgHull: 12,
                boardingCapture: { by: "P1", resolved: false },
                object: { hull: { points: 12 } },
            },
        ]);
        expect(buildPhase11HullDestructionCommands(pos)).toEqual([]);
    });
});

describe("resolvePhase11HullDestruction apply", () => {
    it("removes hull-depleted ships when commands are folded", () => {
        const position = basePos([
            {
                objType: "ship",
                id: "Goner",
                owner: "P1",
                dmgHull: 12,
                object: { hull: { points: 12 } },
            },
        ]);
        const cleanup = buildPhase11HullDestructionCommands(position);
        const folded = foldCommands(meta, position, cleanup, 0);
        expect(folded.state.position.objects?.some((o) => o.id === "Goner")).toBe(false);
    });
});

describe("setShipCaptured and setShipOwner", () => {
    const foldBase = (): FoldState => ({
        meta: { ...meta, phase: 12 },
        position: basePos([
            {
                objType: "ship",
                id: "Prize",
                owner: "P2",
                dmgHull: 12,
                object: { hull: { points: 12 } },
            },
        ]),
    });

    it("setShipCaptured sets boardingCapture flag", () => {
        const { state } = applyCommand(foldBase(), {
            name: "setShipCaptured",
            ship: "Prize",
            capturedBy: "P1",
        });
        const ship = state.position.objects![0] as {
            boardingCapture?: { by: string; resolved?: boolean };
        };
        expect(ship.boardingCapture).toEqual({ by: "P1", turn: 1, resolved: false });
    });

    it("setShipOwner transfers owner, resolves capture, and survives hull sweep", () => {
        let state = applyCommand(foldBase(), {
            name: "setShipCaptured",
            ship: "Prize",
            capturedBy: "P1",
        }).state;
        state = applyCommand(state, {
            name: "setShipOwner",
            ship: "Prize",
            owner: "P1",
        }).state;

        const ship = state.position.objects![0] as {
            owner?: string;
            boardingCapture?: { by: string; resolved?: boolean };
        };
        expect(ship.owner).toBe("P1");
        expect(ship.boardingCapture?.resolved).toBe(true);

        const cleanup = buildPhase11HullDestructionCommands(state.position);
        expect(cleanup).toEqual([]);
        const afterSweep = foldCommands(
            { ...meta, phase: 11 },
            state.position,
            cleanup,
            0
        );
        expect(afterSweep.state.position.objects?.some((o) => o.id === "Prize")).toBe(true);
    });
});
