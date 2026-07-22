import { describe, expect, it } from "vitest";
import type { FullThrustGameCommand } from "@/schemas/commands";
import { arrayRollSource } from "./dice";
import { resolveFireDeclaration } from "./resolveCombat";
import { repairTargetsForShip } from "./repairSystems";

describe("needle fire destroy", () => {
    it("destroys target system on roll 6 and excludes from repair", () => {
        const declaration = {
            name: "declareShipFire",
            ship: "A1",
            weapon: "needle1",
            target: "B1",
            notes: JSON.stringify({ profile: "needle", needleSystemId: "reactor1" }),
        } as FullThrustGameCommand;
        const target = {
            dmgHull: 0,
            object: { hull: { points: 12, rows: 3 } },
            systems: [{ id: "reactor1", state: "ok" }],
        };
        const cmds = resolveFireDeclaration(declaration, arrayRollSource([6]), target);
        const disable = cmds.find(
            (c) => c.name === "sysDisable" && (c as { system?: string }).system === "reactor1"
        ) as { state?: string };
        expect(disable?.state).toBe("destroyed");

        const repairShip = {
            id: "B1",
            object: { systems: [{ name: "reactor", id: "reactor1" }] },
            systems: [{ id: "reactor1", state: "destroyed" }],
        };
        expect(repairTargetsForShip(repairShip).some((t) => t.id === "reactor1")).toBe(false);
    });
});
