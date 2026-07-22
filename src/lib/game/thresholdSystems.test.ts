import { describe, it, expect } from "vitest";
import type { FullThrustGamePosition } from "@/schemas/position";
import {
    applyHullDamageThreshold,
    clearPendingThreshold,
    coreSystemsInThresholdEnabled,
    thresholdsCrossed,
    systemFailsThreshold,
} from "./thresholds";
import {
    thresholdTargetsForShip,
    thresholdDiceCount,
    resolveThresholdRolls,
    buildThresholdResolveCommands,
} from "./thresholdSystems";
import { resolveFragileSensorThresholds } from "./needleFire";
import { arrayRollSource } from "./dice";
import { applyCommand, foldCommands } from "./applyCommand";
import { DEFAULT_META } from "./types";
import { phaseAdvancePrompt, suggestedThresholdDiceCount } from "./phase";
import { validateDeclareShipFireBatch, fireDeclarationModeratorLogMessages } from "./commandValidation";
import { functionalFireControls, shipRequiresFireControl } from "./shipSystems";
import type { FoldState } from "./applyCommand";

function testShip(overrides: Record<string, unknown> = {}) {
    return {
        objType: "ship" as const,
        id: "HMS Test",
        owner: "P1",
        position: { x: 0, y: 0 },
        facing: 0 as const,
        speed: 0,
        svg: "<symbol viewBox='0 0 1 1'></symbol>",
        object: {
            hull: { points: 12, rows: 3 },
            systems: [
                { id: "mag1", name: "magazine" },
                { id: "salvo1", name: "salvoLauncher", magazine: "mag1", type: "weapon" },
                { id: "drive1", name: "drive", thrust: 4 },
                { id: "hang1", name: "hangar" },
            ],
            weapons: [{ id: "beam1", name: "beamBattery", type: "weapon" }],
        },
        ...overrides,
    };
}

describe("thresholdsCrossed", () => {
    it("skips last hull row destruction", () => {
        const t = thresholdsCrossed(12, 3, 8, 12);
        expect(t.thresholdsCrossed).toBe(0);
    });

    it("combines multi-row crossing with roll bonus", () => {
        const t = thresholdsCrossed(12, 3, 0, 8);
        expect(t.thresholdsCrossed).toBe(2);
        expect(t.thresholdIndex).toBe(2);
        expect(t.rollBonus).toBe(1);
        expect(t.failOnOrAbove).toBe(4);
        expect(systemFailsThreshold(3, t.failOnOrAbove, t.rollBonus)).toBe(true);
        expect(systemFailsThreshold(2, t.failOnOrAbove, t.rollBonus)).toBe(false);
    });
});

describe("coreSystemsInThresholdEnabled", () => {
    it("defaults legacy undefined to true", () => {
        expect(coreSystemsInThresholdEnabled({} as import("./types").GameMeta)).toBe(true);
        expect(
            coreSystemsInThresholdEnabled({ includeCoreSystemsInThreshold: false } as import("./types").GameMeta)
        ).toBe(false);
    });
});

describe("thresholdTargetsForShip", () => {
    const meta = DEFAULT_META();

    it("dedupes magazine with salvo launcher", () => {
        const ship = testShip();
        const targets = thresholdTargetsForShip(ship, meta);
        const ids = targets.map((t) => t.id);
        expect(ids).toContain("mag1");
        expect(ids).not.toContain("salvo1");
        expect(ids).toContain("beam1");
        expect(ids).toContain("drive1");
        expect(ids).toContain("hang1");
        expect(ids.filter((id) => id === "mag1")).toHaveLength(1);
    });

    it("includes core systems when enabled", () => {
        const ship = testShip();
        const withCore = thresholdTargetsForShip(ship, meta);
        expect(withCore.some((t) => t.id === "_coreBridge")).toBe(true);
        const without = thresholdTargetsForShip(ship, {
            ...meta,
            includeCoreSystemsInThreshold: false,
        });
        expect(without.some((t) => t.id.startsWith("_core"))).toBe(false);
    });

    it("excludes destroyed systems", () => {
        const ship = testShip({
            systems: [{ id: "beam1", state: "destroyed" }],
        });
        const targets = thresholdTargetsForShip(ship, meta);
        expect(targets.some((t) => t.id === "beam1")).toBe(false);
    });
});

describe("thresholdDiceCount", () => {
    it("totals dice across pending ships", () => {
        const position: FullThrustGamePosition = {
            map: { mode: "fixed", width: 72, height: 48 },
            objects: [
                testShip({
                    pendingThreshold: {
                        failOnOrAbove: 6,
                        rollBonus: 0,
                        thresholdIndex: 1,
                        crossedRows: 1,
                    },
                }),
            ],
        };
        const summary = thresholdDiceCount(position, DEFAULT_META());
        expect(summary.perShip).toHaveLength(1);
        expect(summary.total).toBe(summary.perShip[0].dice);
        expect(summary.total).toBeGreaterThan(0);
    });
});

describe("resolveThresholdRolls", () => {
    it("damages weapons and destroys low-thrust drives on fail", () => {
        const ship = testShip();
        const meta = DEFAULT_META();
        const targets = thresholdTargetsForShip(ship, meta).filter((t) =>
            ["beam1", "drive1"].includes(t.id)
        );
        const allTargets = thresholdTargetsForShip(ship, meta);
        const rolls = allTargets.map((t) => (t.id === "beam1" ? 6 : 1));
        const outcomes = resolveThresholdRolls(ship, meta, rolls, 6, 0);
        const beam = outcomes.find((o) => o.target.id === "beam1");
        expect(beam?.failed).toBe(true);
        expect(beam?.outcome).toContain("damaged");
    });

    it("destroys marines and hired DCP on fail", () => {
        const ship = testShip({
            object: {
                hull: { points: 12, rows: 3 },
                systems: [
                    { id: "m1", name: "marines" },
                    { id: "dcp1", name: "damageControl" },
                    { id: "drive1", name: "drive", thrust: 4 },
                ],
            },
        });
        const meta = DEFAULT_META();
        const targets = thresholdTargetsForShip(ship, meta);
        const mTarget = targets.find((t) => t.id === "m1");
        const dTarget = targets.find((t) => t.id === "dcp1");
        expect(mTarget?.permanent).toBe(true);
        expect(dTarget?.permanent).toBe(true);

        const rolls = targets.map((t) => (t.id === "m1" || t.id === "dcp1" ? 6 : 1));
        const outcomes = resolveThresholdRolls(ship, meta, rolls, 6, 0);
        const cmds = buildThresholdResolveCommands(ship, outcomes, rolls, 1);
        const disable = cmds.filter((c) => c.name === "sysDisable") as {
            system?: string;
            state?: string;
        }[];
        expect(disable.find((c) => c.system === "m1")?.state).toBe("destroyed");
        expect(disable.find((c) => c.system === "dcp1")?.state).toBe("destroyed");
    });

    it("sysDisable on deployed marine clears crewDeployment", () => {
        const ship = testShip({
            object: {
                hull: { points: 12, rows: 3 },
                systems: [{ id: "m1", name: "marines" }],
            },
            crewDeployment: { deployed: ["m1"] },
        });
        const fold: FoldState = {
            meta: DEFAULT_META(),
            position: { map: { mode: "fixed", width: 72, height: 48 }, objects: [ship] },
        };
        const next = applyCommand(fold, {
            name: "sysDisable",
            ship: "HMS Test",
            system: "m1",
            state: "destroyed",
        }).state;
        const updated = next.position.objects![0] as ReturnType<typeof testShip> & {
            crewDeployment?: { deployed?: string[] };
        };
        expect(updated.crewDeployment?.deployed ?? []).not.toContain("m1");
        expect(updated.systems?.find((s) => s.id === "m1")?.state).toBe("destroyed");
    });
});

describe("dmgShip pending threshold", () => {
    it("sets pendingThreshold when hull row crossed", () => {
        const position: FullThrustGamePosition = {
            map: { mode: "fixed", width: 72, height: 48 },
            objects: [testShip({ dmgHull: 3 })],
        };
        const fold: FoldState = {
            meta: DEFAULT_META(),
            position,
        };
        const next = applyCommand(fold, {
            name: "dmgShip",
            ship: "HMS Test",
            hull: 2,
        }).state;
        const ship = next.position.objects![0] as ReturnType<typeof testShip> & {
            pendingThresholds?: { thresholdIndex: number }[];
        };
        expect(ship.pendingThresholds?.[0]?.thresholdIndex).toBe(1);
    });

    it("clears pending on resolveThresholdCheck", () => {
        const ship = testShip({
            dmgHull: 4,
            pendingThreshold: {
                failOnOrAbove: 6,
                rollBonus: 0,
                thresholdIndex: 1,
                crossedRows: 1,
            },
        });
        const fold: FoldState = {
            meta: DEFAULT_META(),
            position: { map: { mode: "fixed", width: 72, height: 48 }, objects: [ship] },
        };
        const next = applyCommand(fold, {
            name: "resolveThresholdCheck",
            ship: "HMS Test",
            thresholdIndex: 1,
            rolls: [1],
        }).state;
        const updated = next.position.objects![0] as ReturnType<typeof testShip> & {
            pendingThresholds?: unknown;
            thresholdRowsResolved?: number;
        };
        expect(updated.pendingThresholds).toBeUndefined();
        expect(updated.thresholdRowsResolved).toBe(1);
    });
});

describe("phase 13 prompt", () => {
    it("uses threshold prompt instead of generic dice", () => {
        expect(phaseAdvancePrompt(13)).toBe("threshold");
        expect(phaseAdvancePrompt(14)).toBe(null);
    });

    it("computes dice count from pending ships", () => {
        const position: FullThrustGamePosition = {
            map: { mode: "fixed", width: 72, height: 48 },
            objects: [
                testShip({
                    pendingThreshold: {
                        failOnOrAbove: 5,
                        rollBonus: 1,
                        thresholdIndex: 2,
                        crossedRows: 2,
                    },
                }),
            ],
        };
        expect(suggestedThresholdDiceCount(position, DEFAULT_META())).toBeGreaterThan(0);
    });
});

describe("ship fire validation", () => {
    it("warns on damaged weapon orders", () => {
        const ship = testShip({
            systems: [{ id: "beam1", state: "destroyed" }],
        });
        const fold: FoldState = {
            meta: { ...DEFAULT_META(), phase: 11 },
            position: { map: { mode: "fixed", width: 72, height: 48 }, objects: [ship] },
        };
        const issues = validateDeclareShipFireBatch(fold, "HMS Test", [
            {
                name: "declareShipFire",
                ship: "HMS Test",
                weapon: "beam1",
                target: "Enemy",
            },
        ]);
        expect(
            issues.some((i) => i.message.includes("destroyed") && i.severity === "warning")
        ).toBe(true);
    });

    it("warns when damaged fire control assigned a target", () => {
        const ship = testShip({
            systems: [
                { id: "fc1", state: "damaged" },
                { id: "beam1", state: "repaired" },
            ],
            object: {
                systems: [{ id: "fc1", name: "fireControl" }],
                weapons: [{ id: "beam1", name: "beam" }],
            },
        });
        const msgs = fireDeclarationModeratorLogMessages(
            "HMS Test",
            ship,
            [
                {
                    name: "declareShipFire",
                    ship: "HMS Test",
                    weapon: "beam1",
                    target: "Enemy",
                    notes: JSON.stringify({ fireControlId: "fc1" }),
                },
            ],
            { fc1: "Enemy" }
        );
        expect(msgs.some((m) => m.includes("damaged fire control fc1"))).toBe(true);
    });

    it("functionalFireControls excludes damaged fire control", () => {
        const ship = testShip({
            systems: [{ id: "fc1", state: "damaged" }],
            object: { systems: [{ id: "fc1", name: "fireControl" }] },
        });
        expect(functionalFireControls(ship)).toHaveLength(0);
        expect(shipRequiresFireControl(ship)).toBe(true);
    });
});

describe("applyHullDamageThreshold queue", () => {
    it("appends worse row when re-hit before resolve", () => {
        const ship = {
            dmgHull: 4,
            thresholdRowsResolved: 0,
            pendingThreshold: {
                failOnOrAbove: 6,
                rollBonus: 0,
                thresholdIndex: 1,
                crossedRows: 1,
            },
            object: { hull: { points: 12, rows: 3 } },
        };
        ship.dmgHull = 8;
        applyHullDamageThreshold(ship, 4, 4);
        expect(ship.pendingThresholds?.map((p) => p.thresholdIndex)).toEqual([1, 2]);
        expect(ship.pendingThresholds?.[1]?.failOnOrAbove).toBe(5);
    });

    it("queues separate checks for separate row crossings", () => {
        const ship = {
            dmgHull: 0,
            thresholdRowsResolved: 0,
            object: { hull: { points: 12, rows: 3 } },
        };
        ship.dmgHull = 4;
        applyHullDamageThreshold(ship, 0, 4);
        ship.dmgHull = 8;
        applyHullDamageThreshold(ship, 4, 4);
        expect(ship.pendingThresholds?.length).toBe(2);
        expect(ship.pendingThresholds?.map((p) => p.thresholdIndex)).toEqual([1, 2]);
    });
});

describe("boarder threshold targets", () => {
    it("includes invaders except those boarded this turn", () => {
        const ship = testShip({
            boarders: {
                units: [
                    { id: "brd-1", type: "marine", owner: "P2", boardedTurn: 1 },
                    { id: "brd-2", type: "dcp", owner: "P2", boardedTurn: 2 },
                ],
            },
        });
        const targets = thresholdTargetsForShip(ship, DEFAULT_META(), 2);
        expect(targets.some((t) => t.id === "brd-1" && t.kind === "boarder")).toBe(true);
        expect(targets.some((t) => t.id === "brd-2")).toBe(false);
    });

    it("removes boarders on failed threshold", () => {
        const ship = testShip({
            boarders: {
                units: [{ id: "brd-1", type: "marine", owner: "P2", boardedTurn: 1 }],
            },
            pendingThresholds: [
                {
                    failOnOrAbove: 6,
                    rollBonus: 0,
                    thresholdIndex: 1,
                    crossedRows: 1,
                },
            ],
        });
        const meta = { ...DEFAULT_META(), turn: 2 };
        const targets = thresholdTargetsForShip(ship, meta, 2);
        const boarderIdx = targets.findIndex((t) => t.kind === "boarder");
        expect(boarderIdx).toBeGreaterThanOrEqual(0);
        const rolls = targets.map(() => 1);
        rolls[boarderIdx] = 6;
        const outcomes = resolveThresholdRolls(ship, meta, rolls, 6, 0);
        const cmds = buildThresholdResolveCommands(ship, outcomes, rolls, 1);
        expect(cmds.some((c) => c.name === "removeBoarders")).toBe(true);
    });
});

describe("single-use ordnance racks", () => {
    const meta = DEFAULT_META();

    function rackShip(ordnance: { id: string; name: string; magazine?: string }[]) {
        return testShip({
            object: {
                hull: { points: 12, rows: 3 },
                ordnance,
                systems: [{ id: "drive1", name: "drive", thrust: 4 }],
            },
        });
    }

    it("marks salvo rack permanent and destroyed on threshold fail", () => {
        const ship = rackShip([{ id: "salvoR1", name: "salvo" }]);
        const targets = thresholdTargetsForShip(ship, meta);
        const salvo = targets.find((t) => t.id === "salvoR1");
        expect(salvo?.permanent).toBe(true);
        const rolls = targets.map((t) => (t.id === "salvoR1" ? 6 : 1));
        const outcomes = resolveThresholdRolls(ship, meta, rolls, 6, 0);
        const cmds = buildThresholdResolveCommands(ship, outcomes, rolls, 1);
        const disable = cmds.find(
            (c) => c.name === "sysDisable" && (c as { system?: string }).system === "salvoR1"
        ) as { state?: string };
        expect(disable?.state).toBe("destroyed");
    });

    it("marks heavy missile rack permanent and destroyed on threshold fail", () => {
        const ship = rackShip([{ id: "hm1", name: "missile" }]);
        const targets = thresholdTargetsForShip(ship, meta);
        expect(targets.find((t) => t.id === "hm1")?.permanent).toBe(true);
        const rolls = targets.map((t) => (t.id === "hm1" ? 6 : 1));
        const outcomes = resolveThresholdRolls(ship, meta, rolls, 6, 0);
        const cmds = buildThresholdResolveCommands(ship, outcomes, rolls, 1);
        const disable = cmds.find(
            (c) => c.name === "sysDisable" && (c as { system?: string }).system === "hm1"
        ) as { state?: string };
        expect(disable?.state).toBe("destroyed");
    });

    it("destroys magazine on threshold fail", () => {
        const ship = testShip({
            object: {
                hull: { points: 12, rows: 3 },
                systems: [{ id: "mag1", name: "magazine" }],
            },
        });
        const targets = thresholdTargetsForShip(ship, meta);
        const rolls = targets.map(() => 6);
        const outcomes = resolveThresholdRolls(ship, meta, rolls, 6, 0);
        const cmds = buildThresholdResolveCommands(ship, outcomes, rolls, 1);
        const disable = cmds.find(
            (c) => c.name === "sysDisable" && (c as { system?: string }).system === "mag1"
        ) as { state?: string };
        expect(disable?.state).toBe("destroyed");
    });
});

describe("fragile sensor threshold checks", () => {
    const meta = DEFAULT_META();

    it("adds sensor dice to threshold count", () => {
        const ship = testShip({
            object: {
                hull: { points: 12, rows: 3 },
                systems: [
                    { id: "sens1", name: "sensors" },
                    { id: "drive1", name: "drive", thrust: 4 },
                ],
            },
            pendingThreshold: {
                failOnOrAbove: 6,
                rollBonus: 0,
                thresholdIndex: 1,
                crossedRows: 1,
            },
        });
        const position: FullThrustGamePosition = {
            map: { mode: "fixed", width: 72, height: 48 },
            objects: [ship],
        };
        const noCoreMeta = { ...DEFAULT_META(), includeCoreSystemsInThreshold: false };
        const summary = thresholdDiceCount(position, noCoreMeta);
        expect(summary.checks[0]?.sensorDice).toBe(1);
        expect(summary.checks[0]?.systemDice).toBe(1);
        expect(summary.checks[0]?.dice).toBe(2);
    });

    it("damages sensors on 5 and destroys on natural 6 at fail 6+", () => {
        const ship = testShip({
            object: {
                hull: { points: 12, rows: 3 },
                systems: [{ id: "sens1", name: "sensors" }],
            },
        });
        const damaged = resolveFragileSensorThresholds(ship, [5], 6, 0);
        expect(damaged[0]?.failed).toBe(true);
        expect(damaged[0]?.state).toBe("damaged");
        const destroyed = resolveFragileSensorThresholds(ship, [6], 6, 0);
        expect(destroyed[0]?.state).toBe("destroyed");
    });
});

describe("AMT rack threshold integration", () => {
    it("emits rack destruction and explosion commands on fail", () => {
        const ship = testShip({
            position: { x: 5, y: 5 },
            object: {
                hull: { points: 12, rows: 3 },
                ordnance: [{ id: "amt1", name: "amt" }],
                systems: [{ id: "drive1", name: "drive", thrust: 4 }],
            },
        });
        const meta = DEFAULT_META();
        const position: FullThrustGamePosition = {
            map: { mode: "fixed", width: 72, height: 48 },
            objects: [ship],
        };
        const targets = thresholdTargetsForShip(ship, meta);
        const rolls = targets.map((t) => (t.id === "amt1" ? 6 : 1));
        const outcomes = resolveThresholdRolls(ship, meta, rolls, 6, 0);
        const cmds = buildThresholdResolveCommands(ship, outcomes, rolls, 1, {
            position,
            rollSource: arrayRollSource([3]),
        });
        expect(
            cmds.some(
                (c) =>
                    c.name === "sysDisable" &&
                    (c as { system?: string }).system === "amt1" &&
                    (c as { state?: string }).state === "destroyed"
            )
        ).toBe(true);
        expect(cmds.some((c) => c.name === "dmgShip")).toBe(true);
        expect(cmds.some((c) => (c as { purpose?: string }).purpose?.includes("amtRackExplosion"))).toBe(
            true
        );
    });
});
