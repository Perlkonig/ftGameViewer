import { describe, expect, it } from "vitest";
import type { FullThrustGamePosition } from "@/schemas/position";
import type { FullThrustGameCommand } from "@/schemas/commands";
import { applyCommand, type FoldState } from "./applyCommand";
import { DEFAULT_META } from "./types";
import { validateFighterCallsignField, validateSetFighterCallsign } from "./commandValidation";

const carrierFold = (): FoldState => ({
    meta: { ...DEFAULT_META(), phase: 3, turn: 1 },
    position: {
        map: { mode: "fixed", width: 72, height: 48 },
        players: [{ id: "P1", colour: "#f00", vp: 0 }],
        objects: [
            {
                objType: "ship",
                id: "C1",
                owner: "P1",
                hangars: { h1: { occupied: true, deployed: false } },
                object: { systems: [{ name: "hangar", id: "h1", fighters: 6 }] },
                svg: "<symbol viewBox='0 0 1 1'></symbol>",
                position: { x: 0, y: 0 },
                facing: 12,
                speed: 0,
            },
            {
                objType: "fighters",
                id: "C1_h1",
                owner: "P1",
                type: "heavy",
                position: { ship: "C1", hangar: "h1" },
                facing: 12,
                number: 6,
                endurance: 6,
                skill: "standard",
            },
        ],
    } as FullThrustGamePosition,
});

const fighter = (fold: FoldState) => fold.position.objects!.find((o) => o.id === "C1_h1")!;

describe("fighter callsign commands", () => {
    it("launchFighters sets callsign only when empty", () => {
        let fold = carrierFold();
        fold = applyCommand(fold, {
            name: "launchFighters",
            ship: "C1",
            id: "C1_h1",
            hangarId: "h1",
            position: { x: 0.5, y: 0 },
            facing: 12,
            callsign: "Red 1",
        } as FullThrustGameCommand).state;
        expect((fighter(fold) as { callsign?: string }).callsign).toBe("Red 1");

        fold = applyCommand(fold, {
            name: "moveFighters",
            id: "C1_h1",
            position: { ship: "C1", hangar: "h1" },
            facing: 12,
        } as FullThrustGameCommand).state;
        expect((fighter(fold) as { callsign?: string }).callsign).toBe("Red 1");

        fold = applyCommand(fold, {
            name: "launchFighters",
            ship: "C1",
            id: "C1_h1",
            hangarId: "h1",
            position: { x: 0.5, y: 0.2 },
            facing: 12,
            callsign: "Blue 2",
        } as FullThrustGameCommand).state;
        expect((fighter(fold) as { callsign?: string }).callsign).toBe("Red 1");
    });

    it("setFighterCallsign sets, changes, and clears", () => {
        let fold = carrierFold();
        fold = applyCommand(fold, {
            name: "setFighterCallsign",
            id: "C1_h1",
            callsign: "CAP",
        } as FullThrustGameCommand).state;
        expect((fighter(fold) as { callsign?: string }).callsign).toBe("CAP");

        fold = applyCommand(fold, {
            name: "setFighterCallsign",
            id: "C1_h1",
            callsign: "Red 1",
        } as FullThrustGameCommand).state;
        expect((fighter(fold) as { callsign?: string }).callsign).toBe("Red 1");

        fold = applyCommand(fold, {
            name: "setFighterCallsign",
            id: "C1_h1",
        } as FullThrustGameCommand).state;
        expect((fighter(fold) as { callsign?: string }).callsign).toBeUndefined();
    });

    it("validates callsign length", () => {
        const issues = validateFighterCallsignField("x".repeat(40));
        expect(issues[0]?.severity).toBe("error");
        expect(validateSetFighterCallsign(carrierFold().position, { id: "C1_h1" })).toEqual([]);
    });
});
