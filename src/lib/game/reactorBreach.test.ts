import { describe, expect, it } from "vitest";
import { arrayRollSource } from "./dice";
import {
    reactorBreachDiceCount,
    resolveReactorBreachBlast,
    shipMass,
} from "./reactorBreach";
import {
    buildReactorResolveCommands,
    mergeCoreState,
    reactorExplosionThreshold,
    resolveReactorExplosion,
    shipIsAbandoned,
} from "./coreSystems";
import { repairTargetsForShip } from "./repairSystems";
import { foldCommands } from "./applyCommand";
import type { GameMeta } from "./types";
import { DEFAULT_META } from "./types";

describe("reactorExplosionThreshold", () => {
    it("base threshold is 5", () => {
        expect(reactorExplosionThreshold({ powerless: true }, 1)).toBe(5);
    });

    it("abandoned turn 3 at turn 5 → threshold 3", () => {
        expect(
            reactorExplosionThreshold({ powerless: true, abandonedSinceTurn: 3 }, 5)
        ).toBe(3);
    });

    it("floors at 2", () => {
        expect(
            reactorExplosionThreshold({ powerless: true, abandonedSinceTurn: 1 }, 99)
        ).toBe(2);
    });
});

describe("resolveReactorExplosion", () => {
    it("explodes at threshold when powerless", () => {
        expect(resolveReactorExplosion(5, { powerless: true }, 1).exploded).toBe(true);
        expect(resolveReactorExplosion(4, { powerless: true }, 1).exploded).toBe(false);
    });

    it("skips dumped reactors", () => {
        expect(resolveReactorExplosion(6, { powerless: true, dumped: true }, 1).skipped).toBe(
            true
        );
    });

    it("respects abandon threshold", () => {
        const core = { powerless: true, abandonedSinceTurn: 3 };
        expect(resolveReactorExplosion(3, core, 5).exploded).toBe(true);
        expect(resolveReactorExplosion(2, core, 5).exploded).toBe(false);
    });
});

describe("mergeCoreState abandon", () => {
    it("clears abandon when reactor stabilized", () => {
        expect(
            mergeCoreState({ powerless: true, abandonedSinceTurn: 2 }, { powerless: false })
        ).toEqual({});
    });

    it("keeps abandon on dump", () => {
        expect(
            mergeCoreState(
                { powerless: true, abandonedSinceTurn: 2 },
                { dumped: true, powerless: true }
            )
        ).toEqual({ powerless: true, dumped: true, abandonedSinceTurn: 2 });
    });
});

describe("shipIsAbandoned", () => {
    it("true when abandonedSinceTurn set", () => {
        expect(shipIsAbandoned({ abandonedSinceTurn: 1 })).toBe(true);
        expect(shipIsAbandoned({ powerless: true })).toBe(false);
    });
});

describe("repairTargetsForShip after abandon", () => {
    it("excludes _corePower when abandoned", () => {
        const ship = {
            id: "S1",
            object: { systems: [] },
            coreState: { powerless: true, abandonedSinceTurn: 2 },
        };
        const ids = repairTargetsForShip(ship).map((t) => t.id);
        expect(ids).not.toContain("_corePower");
    });
});

describe("reactorBreachDiceCount", () => {
    it("mass 130 → 5 dice", () => {
        expect(reactorBreachDiceCount(130)).toBe(5);
    });

    it("minimum 1 die", () => {
        expect(reactorBreachDiceCount(10)).toBe(1);
    });
});

describe("shipMass", () => {
    it("reads object.mass then ship.mass", () => {
        expect(shipMass({ object: { mass: 130 } })).toBe(130);
        expect(shipMass({ mass: 80 })).toBe(80);
        expect(shipMass({})).toBe(50);
    });
});

describe("resolveReactorBreachBlast", () => {
    const meta = {
        ...DEFAULT_META(),
        includeCoreSystemsInThreshold: true,
        reactorBreachesEnabled: true,
    } as GameMeta;

    it("applies SAP dmgShip to nearby ship (armour split)", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            objects: [
                {
                    objType: "ship",
                    id: "BOOM",
                    position: { x: 10, y: 10 },
                    object: { mass: 50, hull: { points: 12 }, armour: [[2, 0]] },
                },
                {
                    objType: "ship",
                    id: "NEAR",
                    position: { x: 11, y: 10 },
                    object: { hull: { points: 12 }, armour: [[2, 0]] },
                    dmgArmour: [{ standard: 0, regenerative: 0 }],
                },
            ],
        };
        const source = arrayRollSource([6, 6]);
        const result = resolveReactorBreachBlast(position, "BOOM", 50, source, meta);
        const dmg = result.commands.find((c) => c.name === "dmgShip" && (c as { ship?: string }).ship === "NEAR");
        expect(dmg).toBeDefined();
        expect((dmg as { hull?: number }).hull).toBeGreaterThanOrEqual(0);
        expect((dmg as { armour?: number[] }).armour?.length).toBeGreaterThan(0);
    });

    it("returns no commands when breaches disabled", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            objects: [
                { objType: "ship", id: "A", position: { x: 0, y: 0 }, object: { mass: 50 } },
                { objType: "ship", id: "B", position: { x: 1, y: 0 }, object: {} },
            ],
        };
        const result = resolveReactorBreachBlast(
            position,
            "A",
            50,
            arrayRollSource([6]),
            { ...meta, reactorBreachesEnabled: false }
        );
        expect(result.commands).toHaveLength(0);
    });
});

describe("buildReactorResolveCommands", () => {
    const meta = {
        includeCoreSystemsInThreshold: true,
        turn: 1,
        phase: 15,
    } as GameMeta;

    it("emits resolveReactorBreaches and objDestroy on explode", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            objects: [{ objType: "ship", id: "A", coreState: { powerless: true } }],
        };
        const cmds = buildReactorResolveCommands(position, meta, [6]);
        expect(cmds.some((c) => c.name === "resolveReactorBreaches")).toBe(true);
        expect(cmds.some((c) => c.name === "objDestroy" && (c as { uuid?: string }).uuid === "A")).toBe(
            true
        );
    });

    it("queues pending thresholds on breach hull crossing", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            objects: [
                {
                    objType: "ship",
                    id: "BOOM",
                    position: { x: 0, y: 0 },
                    coreState: { powerless: true },
                    object: { mass: 25, hull: { points: 12, rows: 4 } },
                },
                {
                    objType: "ship",
                    id: "NEAR",
                    position: { x: 2, y: 0 },
                    object: {
                        hull: { points: 12, rows: 4 },
                        armour: [],
                    },
                    dmgHull: 0,
                },
            ],
        };
        const cmds = buildReactorResolveCommands(
            position,
            { ...meta, reactorBreachesEnabled: true },
            [6],
            arrayRollSource([6])
        );
        const folded = foldCommands(
            { ...DEFAULT_META(), phase: 15, turn: 1 },
            position,
            cmds
        );
        const near = folded.state.position.objects?.find((o) => o.id === "NEAR") as {
            pendingThresholds?: unknown[];
        };
        expect(near?.pendingThresholds?.length).toBeGreaterThan(0);
    });

    it("abandon via setCoreState lowers threshold next turn", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            objects: [
                {
                    objType: "ship",
                    id: "A",
                    coreState: { powerless: true, abandonedSinceTurn: 3 },
                },
            ],
        };
        const cmds = buildReactorResolveCommands(
            position,
            { ...meta, turn: 5 },
            [3]
        );
        expect(cmds.some((c) => c.name === "objDestroy")).toBe(true);
    });
});
