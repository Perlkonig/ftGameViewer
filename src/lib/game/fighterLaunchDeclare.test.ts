import { describe, expect, it } from "vitest";
import {
    declaredLaunchFightersForShip,
    moveShipDeclaresLaunchFighters,
    moveShipUsesThrust,
    validateLaunchFightersDeclaration,
    validateMoveShipLaunchFighters,
} from "./fighterLaunchDeclare";
import type { ShipGameState } from "./shipSystems";
import { DEFAULT_META } from "./types";
import type { FoldState } from "./applyCommand";

const ship = (): ShipGameState => ({
    id: "C1",
    object: { thrust: 4, systems: [{ id: "h1", name: "hangar" }] },
    systems: [],
    speed: 4,
    facing: 12,
    movementMode: "cinematic",
});

describe("fighterLaunchDeclare", () => {
    it("detects launch fighter declaration on moveShip", () => {
        const cmd = {
            name: "moveShip",
            id: "C1",
            launchFighters: true,
            cinematicAllocation: { speedChange: "hold", speedChangeThrust: 0, turns: 0 },
        } as never;
        expect(moveShipDeclaresLaunchFighters(cmd)).toBe(true);
        expect(declaredLaunchFightersForShip([cmd], "C1")).toBe(true);
    });

    it("warns when launch fighters is declared with thrust", () => {
        const cmd = {
            name: "moveShip",
            id: "C1",
            launchFighters: true,
            cinematicAllocation: { speedChange: "accel", speedChangeThrust: 2, turns: 0 },
        } as never;
        const issues = validateMoveShipLaunchFighters(ship(), cmd);
        expect(issues).toHaveLength(1);
        expect(issues[0].severity).toBe("warning");
        expect(moveShipUsesThrust(cmd, ship())).toBe(true);
    });

    it("allows drift-only movement with launch fighters declared", () => {
        const cmd = {
            name: "moveShip",
            id: "C1",
            launchFighters: true,
            cinematicAllocation: { speedChange: "hold", speedChangeThrust: 0, turns: 0 },
        } as never;
        expect(validateMoveShipLaunchFighters(ship(), cmd)).toHaveLength(0);
        expect(moveShipUsesThrust(cmd, ship())).toBe(false);
    });

    it("warns phase 3 launch without phase 1 declaration", () => {
        const fold: FoldState = {
            meta: DEFAULT_META(),
            position: { objects: [] },
            pendingMoves: [
                {
                    name: "moveShip",
                    id: "C1",
                    cinematicAllocation: { speedChange: "hold", speedChangeThrust: 0, turns: 0 },
                } as never,
            ],
        };
        const issues = validateLaunchFightersDeclaration(fold, "C1");
        expect(issues[0].message).toMatch(/did not declare launching fighters/);
    });
});
