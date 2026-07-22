import { describe, expect, it } from "vitest";
import type { FullThrustGamePosition } from "@/schemas/position";
import {
    bodyFrameOffset,
    worldPosFromBodyOffset,
    applyFighterAttachment,
    syncFightersAttachedTo,
    syncAllAttachedFighters,
} from "./fighterAttachment";
import { resolvePhase5MovementSequence } from "./mineMovement";
import { DEFAULT_META } from "./types";

const basePosition = (): FullThrustGamePosition => ({
    map: { mode: "fixed", width: 72, height: 48 },
    players: [
        { id: "P1", colour: "#f00", vp: 0 },
        { id: "P2", colour: "#00f", vp: 0 },
    ],
    objects: [
        {
            objType: "ship",
            id: "S1",
            owner: "P1",
            object: { systems: [{ name: "drive", id: "d1" }] },
            svg: "<symbol></symbol>",
            position: { x: 10, y: 10 },
            facing: 12,
            speed: 4,
        },
        {
            objType: "fighters",
            id: "F1",
            owner: "P1",
            type: "standard",
            position: { x: 12, y: 10 },
            facing: 12,
            number: 6,
            endurance: 6,
            skill: "standard",
        },
    ] as FullThrustGamePosition["objects"],
});

describe("fighterAttachment", () => {
    it("round-trips body-frame offset", () => {
        const fighter = { x: 12, y: 11 };
        const target = { x: 10, y: 10 };
        const offset = bodyFrameOffset(fighter, target, 12);
        const back = worldPosFromBodyOffset(target, 12, offset);
        expect(back.x).toBeCloseTo(fighter.x);
        expect(back.y).toBeCloseTo(fighter.y);
    });

    it("screened fighter follows ship in phase 5 but keeps chosen facing", () => {
        const pos = basePosition();
        const fighter = pos.objects!.find((o) => o.id === "F1")!;
        const ship = pos.objects!.find((o) => o.id === "S1")!;
        applyFighterAttachment(fighter as never, ship as never, "screen", "ship", {
            screenFacing: 6,
        });

        const meta = { ...DEFAULT_META(), turn: 1, phase: 5 as const };
        const result = resolvePhase5MovementSequence(pos, meta, [], []);
        const fAfter = result.position.objects!.find((o) => o.id === "F1")!;
        const sAfter = result.position.objects!.find((o) => o.id === "S1")!;
        expect(sAfter.position).toBeTruthy();
        expect(fAfter.position).toBeTruthy();
        if (
            fAfter.position &&
            "x" in fAfter.position &&
            sAfter.position &&
            "x" in sAfter.position
        ) {
            expect(fAfter.position.x - sAfter.position.x).toBeCloseTo(2);
            expect(fAfter.position.y).toBeCloseTo(sAfter.position.y);
            expect(fAfter.facing).toBe(6);
            expect(sAfter.facing).not.toBe(6);
        }
    });

    it("syncFightersAttachedTo keeps screen facing when escort turns", () => {
        const pos = basePosition();
        const fighter = pos.objects!.find((o) => o.id === "F1")!;
        const ship = pos.objects!.find((o) => o.id === "S1")!;
        applyFighterAttachment(fighter as never, ship as never, "screen", "ship", {
            screenFacing: 9,
        });
        (ship as { facing?: number }).facing = 3;
        syncFightersAttachedTo(pos, "S1", "ship");
        expect(fighter.facing).toBe(9);
    });

    it("pursuing fighter faces toward target", () => {
        const pos = basePosition();
        pos.objects!.push({
            objType: "ship",
            id: "S2",
            owner: "P2",
            object: { systems: [] },
            svg: "<symbol></symbol>",
            position: { x: 20, y: 10 },
            facing: 12,
            speed: 0,
        });
        const fighter = pos.objects!.find((o) => o.id === "F1")!;
        const enemy = pos.objects!.find((o) => o.id === "S2")!;
        applyFighterAttachment(fighter as never, enemy as never, "pursue", "ship");
        expect(fighter.facing).not.toBe(12);
        (enemy as { position: { x: number; y: number } }).position = { x: 25, y: 10 };
        syncFightersAttachedTo(pos, "S2", "ship");
        expect(fighter.facing).toBe(3);
    });

    it("syncAllAttachedFighters cascades pursuer to screening fighter", () => {
        const pos = basePosition();
        pos.objects!.push({
            objType: "fighters",
            id: "F2",
            owner: "P2",
            type: "standard",
            position: { x: 14, y: 10 },
            facing: 12,
            number: 6,
            endurance: 6,
            skill: "standard",
        });
        const f1 = pos.objects!.find((o) => o.id === "F1")!;
        const f2 = pos.objects!.find((o) => o.id === "F2")!;
        const ship = pos.objects!.find((o) => o.id === "S1")!;
        applyFighterAttachment(f1 as never, ship as never, "screen", "ship");
        applyFighterAttachment(f2 as never, f1 as never, "pursue", "fighters");
        (ship as { position: { x: number; y: number } }).position = { x: 20, y: 10 };
        syncFightersAttachedTo(pos, "S1", "ship");
        syncAllAttachedFighters(pos);
        const f2pos = f2.position as { x: number; y: number };
        expect(f2pos.x).toBeGreaterThan(14);
    });
});
