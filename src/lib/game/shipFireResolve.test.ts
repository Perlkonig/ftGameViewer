import { describe, expect, it } from "vitest";
import { arrayRollSource } from "./dice";
import { resolveFireDeclaration } from "./resolveCombat";
import { resolveKgunDamage, resolvePlasmaDamagePerHit, resolveSapPerHit } from "./combat";
import type { FullThrustGameCommand } from "@/schemas/commands";

describe("resolveFireDeclaration profiles", () => {
    const target = {
        objType: "ship" as const,
        id: "T1",
        dmgHull: 0,
        object: { hull: { points: 12, rows: 4 }, armour: [[2, 0]] },
    };

    it("resolves pulse torpedo SAP on hit", () => {
        const decl = {
            name: "declareShipFire",
            ship: "S1",
            weapon: "tp1",
            target: "T1",
            notes: JSON.stringify({ profile: "pulseTorpedo", range: 14 }),
        } as FullThrustGameCommand;
        const cmds = resolveFireDeclaration(decl, arrayRollSource([4, 5]), target);
        expect(cmds.some((c) => c.name === "dmgShip")).toBe(true);
    });

    it("banks EMP hits without hull damage", () => {
        const decl = {
            name: "declareShipFire",
            ship: "S1",
            weapon: "e1",
            target: "T1",
            notes: JSON.stringify({ profile: "emp", beamClass: 1, range: 6, screens: 0 }),
        } as FullThrustGameCommand;
        const cmds = resolveFireDeclaration(decl, arrayRollSource([6, 3]), target);
        expect(cmds.some((c) => c.name === "bankEmpHits")).toBe(true);
        expect(cmds.some((c) => c.name === "dmgShip")).toBe(false);
    });

    it("queues transporter delivery on hit", () => {
        const decl = {
            name: "declareShipFire",
            ship: "S1",
            weapon: "tr1",
            target: "T1",
            notes: JSON.stringify({ profile: "transporter", beamClass: 1, range: 6, screens: 0 }),
        } as FullThrustGameCommand;
        const cmds = resolveFireDeclaration(decl, arrayRollSource([5, 4]), target);
        expect(cmds.some((c) => c.name === "queueTransporterDelivery")).toBe(true);
    });
});

describe("combat primitives", () => {
    it("kgun doubles damage on low reroll", () => {
        const r = resolveKgunDamage(3, arrayRollSource([4]));
        expect(r.damage).toBe(3);
        const d = resolveKgunDamage(3, arrayRollSource([2]));
        expect(d.damage).toBe(6);
    });

    it("plasma damage respects screens", () => {
        const noScreen = resolvePlasmaDamagePerHit(0, arrayRollSource([4]));
        expect(noScreen.damage).toBe(2);
    });

    it("sap uses die size", () => {
        expect(resolveSapPerHit(arrayRollSource([5]), 3)).toBe(3);
        expect(resolveSapPerHit(arrayRollSource([3]), 6)).toBe(3);
    });
});
