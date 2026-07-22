import { describe, expect, it } from "vitest";
import { beamDicePool, beamRangeBand } from "./combat";
import { arrayRollSource } from "./dice";
import {
    computeShipDamageApplication,
    fireDeclarationDiceInfo,
    pushHullDamageCommands,
    resolveBeamDeclaration,
} from "./resolveCombat";
import { formatAppliedDamage } from "./rollResults";
import type { FullThrustGameCommand } from "@/schemas/commands";

describe("fireDeclarationDiceInfo", () => {
    const frigateBeamDecl = {
        name: "declareShipFire",
        ship: "FrigateA1",
        weapon: "4Q_bf",
        target: "FrigateB1",
        notes: JSON.stringify({
            profile: "beam",
            beamClass: 2,
            screens: 0,
            range: 21.865115462163214,
            weaponName: "beam",
        }),
    } as FullThrustGameCommand;

    it("matches combat pool for class-2 beam at ~22 MU", () => {
        expect(beamRangeBand(21.865, 2)).toBe(2);
        expect(beamDicePool(2, 21.865)).toBe(1);

        const info = fireDeclarationDiceInfo(frigateBeamDecl);
        expect(info.attackPool).toBe(1);
        expect(info.rangeBand).toBe(2);
    });
});

describe("formatAppliedDamage", () => {
    it("reports a miss when no damage rolled", () => {
        expect(formatAppliedDamage(0, null)).toBe("Miss");
    });

    it("reports armour and hull damage on a hit", () => {
        expect(
            formatAppliedDamage(3, {
                hullDamage: 1,
                armourDamage: [2, 0],
            })
        ).toBe("Hit: 3 damage (2 armour, 1 hull)");
    });
});

describe("computeShipDamageApplication", () => {
    const corvette = {
        object: {
            hull: { points: 2, rows: 2 },
            armour: [[1, 0]],
        },
        dmgHull: 0,
        dmgArmour: undefined,
    };

    it("applies non-penetrating damage to ftLibShip tuple armour first", () => {
        expect(computeShipDamageApplication(corvette, 1, 0, "standard")).toEqual({
            hullDamage: 0,
            armourDamage: [1],
        });
        expect(computeShipDamageApplication(corvette, 2, 0, "standard")).toEqual({
            hullDamage: 1,
            armourDamage: [1],
        });
    });
});

describe("pushHullDamageCommands", () => {
    const corvette = {
        object: {
            hull: { points: 2, rows: 4 },
            armour: [[1, 0]],
        },
        dmgHull: 0,
        dmgArmour: undefined,
    };

    it("logs ship destruction when the last hull box is filled", () => {
        const cmds: FullThrustGameCommand[] = [];
        pushHullDamageCommands(cmds, "A1", corvette, 4, 0, "standard");
        expect(cmds).toEqual([
            { name: "dmgShip", ship: "A1", hull: 2, armour: [1] },
            { name: "_custom", msg: "Ship A1 destroyed." },
            { name: "objDestroy", uuid: "A1" },
        ]);
    });

    it("defers objDestroy during phase 11 simultaneous fire", () => {
        const cmds: FullThrustGameCommand[] = [];
        pushHullDamageCommands(cmds, "A1", corvette, 4, 0, "standard", { deferObjDestroy: true });
        expect(cmds).toEqual([
            { name: "dmgShip", ship: "A1", hull: 2, armour: [1] },
            { name: "_custom", msg: "Ship A1 destroyed." },
        ]);
    });
});

describe("resolveBeamDeclaration", () => {
    const decl = {
        name: "declareShipFire",
        ship: "FrigateA1",
        weapon: "4Q_bf",
        target: "FrigateB1",
        notes: JSON.stringify({
            profile: "beam",
            beamClass: 1,
            screens: 0,
            range: 10,
            weaponName: "beam",
        }),
    } as FullThrustGameCommand;

    const target = {
        object: {
            hull: { points: 12, rows: 3 },
            armour: [{ standard: 2, regenerative: 0 }],
        },
        dmgHull: 0,
        dmgArmour: [{ standard: 0, regenerative: 0 }],
    };

    it("notes Miss on a failed attack", () => {
        const cmds = resolveBeamDeclaration(decl, arrayRollSource([1]), target);
        const fire = cmds.find((c) => c.name === "fireWeapon") as { notes?: string };
        expect(fire.notes).toBe("beam → FrigateB1: Miss");
        const log = cmds.find((c) => c.name === "logDice") as { result?: string };
        expect(log.result).toBe("Miss");
    });

    it("notes hit damage split across armour and hull", () => {
        const cmds = resolveBeamDeclaration(decl, arrayRollSource([5]), target);
        const fire = cmds.find((c) => c.name === "fireWeapon") as { notes?: string };
        expect(fire.notes).toBe("beam → FrigateB1: Hit: 1 damage (1 armour)");
        const log = cmds.find((c) => c.name === "logDice") as { result?: string };
        expect(log.result).toBe("Hit: 1 damage (1 armour)");
    });
});
