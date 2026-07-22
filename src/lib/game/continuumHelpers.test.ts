import { describe, it, expect } from "vitest";
import { resolvePdsPoolFromRolls, applyAdvancedScreenReduction } from "./combat";
import {
    resolveSalvoStrike,
    resolveHeavyMissile,
    resolveFighterStrikeFromRolls,
} from "./ordnanceAttack";
import { resolveBoardingCombat } from "./boarding";
import { addBoarderUnits, type ShipWithBoarders } from "./boardingState";
import {
    resolveReactorExplosion,
    tickCoreState,
    mergeCoreState,
    shipsNeedingReactorRoll,
    buildReactorResolveCommands,
} from "./coreSystems";
import { resolveDogfightSideFromRolls } from "./fighters";
import { systemFailsThreshold, nextDriveState } from "./thresholds";

describe("resolvePdsPool", () => {
    it("sums kills across dice", () => {
        const r = resolvePdsPoolFromRolls([4, 6, 3], 2);
        expect(r.kills).toBe(3);
        expect(r.used).toEqual([4, 6, 3]);
    });
});

describe("advanced screens", () => {
    it("reduces per-die damage", () => {
        expect(applyAdvancedScreenReduction([4, 5, 1], 2)).toEqual([2, 3, 0]);
    });
});

describe("ordnanceAttack", () => {
    it("resolves salvo survivors to SAP", () => {
        const r = resolveSalvoStrike(4, 1, [3, 5, 6]);
        expect(r.missilesOnTarget).toBe(4);
        expect(r.survivors).toBe(3);
        expect(r.totalSap).toBe(14);
    });

    it("resolves heavy missile 3d6 SAP", () => {
        expect(resolveHeavyMissile([2, 3, 4]).totalSap).toBe(9);
    });

    it("resolves fighter strike as beam-1 pool", () => {
        const r = resolveFighterStrikeFromRolls(2, 0, [4, 3]);
        expect(r.totalDamage).toBe(1);
    });
});

describe("boarding", () => {
    it("DCP repel uses roll <= assigned count", () => {
        const defender = {
            objType: "ship",
            id: "D1",
            object: { systems: [] },
            boarders: { units: [] },
        } as ShipWithBoarders;
        const ids = addBoarderUnits(defender, "P1", [{ type: "marine" }]);
        const r = resolveBoardingCombat({
            defenderShip: defender,
            attackerOrders: [],
            defenderOrders: [
                { v: 2, role: "defender", dcpRepel: [{ boarderId: ids[0], dcp: 3 }] },
            ],
            dice: { dcp: [3], combat: [] },
        });
        expect(r.killedByDcp).toBe(1);
    });

    it("raze survivors damage hull", () => {
        const defender = {
            objType: "ship",
            id: "D1",
            object: { systems: [] },
            boarders: { units: [] },
        } as ShipWithBoarders;
        const ids = addBoarderUnits(defender, "P1", [{ type: "marine" }, { type: "marine" }]);
        const r = resolveBoardingCombat({
            defenderShip: defender,
            attackerOrders: [
                {
                    v: 2,
                    role: "attacker",
                    attackerOwner: "P1",
                    unitAllocations: [
                        { unitId: ids[0], allocation: "raze" },
                        { unitId: ids[1], allocation: "raze" },
                    ],
                },
            ],
            defenderOrders: [{ v: 2, role: "defender" }],
            dice: { dcp: [], combat: [] },
        });
        expect(r.hullDamage).toBe(2);
    });
});

describe("coreSystems", () => {
    it("explodes on 5-6 when powerless", () => {
        expect(resolveReactorExplosion(5, { powerless: true }, 1).exploded).toBe(true);
        expect(resolveReactorExplosion(4, { powerless: true }, 1).exploded).toBe(false);
        expect(resolveReactorExplosion(6, { powerless: true, dumped: true }, 1).skipped).toBe(
            true
        );
    });

    it("ticks countdowns", () => {
        expect(tickCoreState({ uncontrolled: 1, lifeless: 2 })).toEqual({
            lifeless: 1,
        });
    });

    it("merges patches", () => {
        expect(mergeCoreState({ powerless: true }, { dumped: true, powerless: true })).toEqual({
            powerless: true,
            dumped: true,
        });
    });

    it("lists ships needing reactor rolls", () => {
        const meta = { includeCoreSystemsInThreshold: true } as import("./types").GameMeta;
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            objects: [
                { objType: "ship", id: "A", coreState: { powerless: true } },
                { objType: "ship", id: "B", coreState: { powerless: true, dumped: true } },
            ],
        };
        expect(shipsNeedingReactorRoll(position, meta)).toEqual(["A"]);
        const cmds = buildReactorResolveCommands(position, meta, [6]);
        expect(cmds.some((c) => c.name === "objDestroy" && (c as { uuid?: string }).uuid === "A")).toBe(
            true
        );
        expect(cmds.some((c) => c.name === "resolveReactorBreaches")).toBe(true);
    });
});

describe("dogfight side", () => {
    it("rolls one die per fighter", () => {
        const { result } = resolveDogfightSideFromRolls(2, [4, 5]);
        expect(result.killsDealt).toBe(2);
    });
});

describe("thresholds helpers", () => {
    it("drive progression", () => {
        expect(nextDriveState("ok", true)).toBe("half");
        expect(nextDriveState("half", true)).toBe("disabled");
        expect(systemFailsThreshold(6, 6)).toBe(true);
        expect(systemFailsThreshold(5, 6)).toBe(false);
    });
});
