import { describe, expect, it } from "vitest";
import {
    addBoarderUnits,
    boarderUnitsOnShip,
    boardersToInvaderEntries,
    contestedShipsForPhase12,
    resetBoarderIdCounter,
    type ShipWithBoarders,
} from "./boardingState";
import {
    boardingCombatDiceCount,
    resolveBoardingCombat,
    resolveBoardingCombatCommands,
} from "./boarding";
import { encodeAttackerBoardingNotes, encodeDefenderBoardingNotes } from "./boardingOrders";
import { applyCommand, foldCommands, type FoldState } from "./applyCommand";
import { validateDefenderBoardingAllocations } from "./commandValidation";
import { shipBoardingCrewCapacity } from "./shipSystems";
import { arrayRollSource } from "./dice";
import { availableMarineIds } from "./crewDeployment";
import { buildShipRenderOpts } from "../ssdRenderOpts";
import type { RenderOpts } from "ftlibship";
import { applyAdvanceSegment } from "./segmentApply";
import { initSegmentMetaForPhase } from "./activation";
import { boardingDeliveryCommands } from "./boardingDelivery";
import type { FullThrustGamePosition } from "@/schemas/position";

const ship = (
    id: string,
    owner: string,
    units?: ShipWithBoarders["boarders"]
): ShipWithBoarders => {
    resetBoarderIdCounter();
    return {
        objType: "ship",
        id,
        owner,
        object: { hull: { points: 12 } },
        svg: "<symbol></symbol>",
        position: { x: 0, y: 0 },
        facing: 12,
        speed: 0,
        boarders: units,
    } as ShipWithBoarders;
};

describe("boardingState", () => {
    it("maps boarder units to invader entries", () => {
        const s = ship("B2", "P2");
        addBoarderUnits(s, "P1", [
            { type: "dcp" },
            { type: "dcp" },
            { type: "marine" },
        ]);
        const inv = boardersToInvaderEntries(s);
        expect(inv.filter((i) => i.type === "marines")).toHaveLength(1);
        expect(inv.filter((i) => i.type === "damageControl")).toHaveLength(2);
        expect(inv[0].owner).toBe("P1");
    });

    it("builds render opts with damage number and invaders", () => {
        const s = ship("B2", "P2");
        addBoarderUnits(s, "P1", [{ type: "dcp" }]);
        s.dmgHull = 2;
        const opts = buildShipRenderOpts(s);
        expect(opts.damage).toBe(2);
        expect((opts as RenderOpts & { invaders?: unknown[] }).invaders?.length).toBe(1);
    });

    it("lists contested ships", () => {
        const defender = ship("S2", "P2");
        addBoarderUnits(defender, "P1", [{ type: "dcp" }]);
        const pos: FullThrustGamePosition = {
            map: { mode: "fixed", width: 72, height: 48 },
            objects: [ship("S1", "P1"), defender],
        };
        expect(contestedShipsForPhase12(pos)).toEqual(["S2"]);
    });
});

describe("boarding resolver", () => {
    it("DCP repel succeeds on roll <= assigned DCP", () => {
        const defender = ship("D1", "P2");
        const ids = addBoarderUnits(defender, "P1", [{ type: "marine" }]);
        const result = resolveBoardingCombat({
            defenderShip: defender,
            attackerOrders: [],
            defenderOrders: [
                {
                    v: 2,
                    role: "defender",
                    dcpRepel: [{ boarderId: ids[0], dcp: 3 }],
                },
            ],
            dice: { dcp: [3], combat: [] },
        });
        expect(result.killedByDcp).toBe(1);
        expect(result.removedUnitIds).toEqual([ids[0]]);
    });

    it("DCP kill wastes co-assigned marine (no reallocation)", () => {
        const defender = ship("D1", "P2");
        const ids = addBoarderUnits(defender, "P1", [{ type: "marine" }]);
        const result = resolveBoardingCombat({
            defenderShip: defender,
            attackerOrders: [],
            defenderOrders: [
                {
                    v: 2,
                    role: "defender",
                    dcpRepel: [{ boarderId: ids[0], dcp: 6 }],
                    marineFight: [{ boarderId: ids[0], marineId: "m1" }],
                },
            ],
            dice: { dcp: [4], combat: [6] },
        });
        expect(result.killedByDcp).toBe(1);
        expect(result.killedByDefenderMarines).toBe(0);
    });

    it("no overkill: two marine hits on same boarder remove once", () => {
        const defender = ship("D1", "P2");
        const ids = addBoarderUnits(defender, "P1", [{ type: "dcp" }]);
        const result = resolveBoardingCombat({
            defenderShip: defender,
            attackerOrders: [],
            defenderOrders: [
                {
                    v: 2,
                    role: "defender",
                    marineFight: [
                        { boarderId: ids[0], marineId: "m1" },
                        { boarderId: ids[0], marineId: "m2" },
                    ],
                },
            ],
            dice: { dcp: [], combat: [4, 5] },
        });
        expect(result.killedByDefenderMarines).toBe(1);
        expect(result.removedUnitIds).toHaveLength(1);
    });

    it("computes dice count from per-unit assignments", () => {
        const defender = ship("D1", "P2");
        const ids = addBoarderUnits(defender, "P1", [
            { type: "marine" },
            { type: "marine" },
        ]);
        const count = boardingCombatDiceCount(
            defender,
            [
                {
                    v: 2,
                    role: "attacker",
                    attackerOwner: "P1",
                    unitAllocations: [{ unitId: ids[0], allocation: "kill" }],
                },
            ],
            [
                {
                    v: 2,
                    role: "defender",
                    dcpRepel: [{ boarderId: ids[1], dcp: 2 }],
                    marineFight: [{ boarderId: ids[0], marineId: "m1" }],
                },
            ]
        );
        expect(count.dcp).toBe(1);
        expect(count.combat).toBe(2);
        expect(count.total).toBe(3);
    });

    it("Wulkan example: raze survivors only damage hull", () => {
        const wulkan = ship("Wulkan", "UDG");
        const ids = addBoarderUnits(wulkan, "IKV", [
            { type: "marine" },
            { type: "marine" },
            { type: "marine" },
            { type: "marine" },
        ]);
        wulkan.object = {
            hull: { points: 12 },
            systems: [
                { id: "m1", name: "marines" },
                { id: "m2", name: "marines" },
            ],
        };

        const result = resolveBoardingCombat({
            defenderShip: wulkan,
            attackerOrders: [
                {
                    v: 2,
                    role: "attacker",
                    attackerOwner: "IKV",
                    unitAllocations: [
                        { unitId: ids[0], allocation: "raze" },
                        { unitId: ids[1], allocation: "raze" },
                        { unitId: ids[2], allocation: "kill" },
                        { unitId: ids[3], allocation: "kill" },
                    ],
                },
            ],
            defenderOrders: [
                {
                    v: 2,
                    role: "defender",
                    dcpRepel: [
                        { boarderId: ids[0], dcp: 3 },
                        { boarderId: ids[1], dcp: 3 },
                    ],
                    marineFight: [
                        { boarderId: ids[2], marineId: "m1" },
                        { boarderId: ids[3], marineId: "m2" },
                    ],
                },
            ],
            dice: {
                dcp: [2, 5],
                combat: [3, 6, 5, 6],
            },
        });

        expect(result.killedByDcp).toBe(1);
        expect(result.defenderMarinesKilled).toBe(2);
        expect(result.killedByDefenderMarines).toBe(1);
        expect(result.hullDamage).toBe(1);
        expect(result.removedUnitIds.length).toBe(2);
    });

    it("raze vs kill allocation", () => {
        const defender = ship("D1", "P2");
        const ids = addBoarderUnits(defender, "P1", [{ type: "marine" }]);
        const razeOnly = resolveBoardingCombat({
            defenderShip: defender,
            attackerOrders: [
                {
                    v: 2,
                    role: "attacker",
                    attackerOwner: "P1",
                    unitAllocations: [{ unitId: ids[0], allocation: "raze" }],
                },
            ],
            defenderOrders: [{ v: 2, role: "defender" }],
            dice: { dcp: [], combat: [] },
        });
        expect(razeOnly.hullDamage).toBe(1);

        const defender2 = ship("D2", "P2");
        const ids2 = addBoarderUnits(defender2, "P1", [{ type: "marine" }, { type: "marine" }]);
        const killOnly = resolveBoardingCombat({
            defenderShip: defender2,
            attackerOrders: [
                {
                    v: 2,
                    role: "attacker",
                    attackerOwner: "P1",
                    unitAllocations: ids2.map((id) => ({ unitId: id, allocation: "kill" as const })),
                },
            ],
            defenderOrders: [{ v: 2, role: "defender" }],
            dice: { dcp: [], combat: [] },
        });
        expect(killOnly.hullDamage).toBe(0);
    });

    it("emits setShipCaptured when raze empties remaining hull", () => {
        const defender = ship("D1", "P2");
        defender.dmgHull = 11;
        const ids = addBoarderUnits(defender, "P1", [{ type: "marine" }]);
        const cmds = resolveBoardingCombatCommands(
            "D1",
            defender,
            [
                {
                    name: "declareBoardingAttackerOrders",
                    ship: "D1",
                    notes: encodeAttackerBoardingNotes({
                        v: 2,
                        attackerOwner: "P1",
                        unitAllocations: [{ unitId: ids[0], allocation: "raze" }],
                    }),
                },
            ],
            arrayRollSource([])
        );
        expect(cmds.some((c) => c.name === "setShipCaptured")).toBe(true);
        const cap = cmds.find((c) => c.name === "setShipCaptured") as {
            ship?: string;
            capturedBy?: string;
        };
        expect(cap.ship).toBe("D1");
        expect(cap.capturedBy).toBe("P1");
    });
});

describe("resolveBoardingCombatCommands integration", () => {
    it("applies boarder removal, hull damage, and defender marine losses", () => {
        const wulkan = ship("Wulkan", "UDG");
        const ids = addBoarderUnits(wulkan, "IKV", [
            { type: "marine" },
            { type: "marine" },
            { type: "marine" },
            { type: "marine" },
        ]);
        wulkan.object = {
            hull: { points: 12 },
            systems: [
                { id: "m1", name: "marines" },
                { id: "m2", name: "marines" },
            ],
        };

        const orderDecls = [
            {
                name: "declareBoardingDefenderOrders",
                ship: "Wulkan",
                notes: encodeDefenderBoardingNotes({
                    v: 2,
                    dcpRepel: [
                        { boarderId: ids[0], dcp: 3 },
                        { boarderId: ids[1], dcp: 3 },
                    ],
                    marineFight: [
                        { boarderId: ids[2], marineId: "m1" },
                        { boarderId: ids[3], marineId: "m2" },
                    ],
                }),
            },
            {
                name: "declareBoardingAttackerOrders",
                ship: "Wulkan",
                notes: encodeAttackerBoardingNotes({
                    v: 2,
                    attackerOwner: "IKV",
                    unitAllocations: [
                        { unitId: ids[0], allocation: "raze" },
                        { unitId: ids[1], allocation: "raze" },
                        { unitId: ids[2], allocation: "kill" },
                        { unitId: ids[3], allocation: "kill" },
                    ],
                }),
            },
        ] as import("@/schemas/commands").FullThrustGameCommand[];

        const cmds = resolveBoardingCombatCommands(
            "Wulkan",
            wulkan,
            orderDecls,
            arrayRollSource([2, 5, 3, 6, 5, 6])
        );

        const fold: FoldState = {
            meta: {
                phase: 12,
                turn: 1,
                version: "",
                name: "",
                createdAt: "",
                dicePolicy: "hybrid",
            },
            position: {
                map: { mode: "fixed", width: 72, height: 48 },
                objects: [wulkan],
            },
        };

        let state = fold;
        for (const cmd of cmds) {
            state = applyCommand(state, cmd).state;
        }

        const updated = state.position.objects![0] as ShipWithBoarders;
        expect(updated.boarders?.units?.length).toBe(2);
        expect(updated.dmgHull).toBe(1);
        expect(availableMarineIds(updated).length).toBe(0);
        expect(cmds.some((c) => c.name === "sysDisable")).toBe(true);
        expect(cmds.some((c) => c.name === "removeBoarders")).toBe(true);
    });
});

describe("phase 12 segment flow", () => {
    const baseMeta = {
        phase: 12 as const,
        turn: 1,
        version: "",
        name: "",
        createdAt: "",
        dicePolicy: "hybrid" as const,
        activation: { queue: ["S2"], index: 0 },
    };

    it("orders attacker → defender → resolve → orders attacker", () => {
        let meta = { ...baseMeta, segment: "orders" as const, boardingStep: "attacker" as const };
        meta = applyAdvanceSegment(meta);
        expect(meta.segment).toBe("orders");
        expect(meta.boardingStep).toBe("defender");

        meta = applyAdvanceSegment(meta);
        expect(meta.segment).toBe("resolve");
        expect(meta.boardingStep).toBe("attacker");

        meta = applyAdvanceSegment(meta);
        expect(meta.segment).toBe("orders");
        expect(meta.boardingStep).toBe("attacker");
        expect(meta.activation?.index).toBe(0);
    });

    it("phase 12 resolve→orders does not advance activation index", () => {
        const meta = {
            ...baseMeta,
            segment: "resolve" as const,
        };
        const next = applyAdvanceSegment(meta);
        expect(next.segment).toBe("orders");
        expect(next.activation?.index).toBe(0);
    });

    it("init segment meta for phase 12 with boarders", () => {
        const defender = ship("S2", "P2");
        addBoarderUnits(defender, "P1", [{ type: "dcp" }]);
        const pos: FullThrustGamePosition = {
            map: { mode: "fixed", width: 72, height: 48 },
            players: [
                { id: "P1", colour: "#f00" },
                { id: "P2", colour: "#00f" },
            ],
            objects: [defender] as FullThrustGamePosition["objects"],
        };
        const init = initSegmentMetaForPhase(12, pos, ["P1", "P2"], { winner: "P1", rolls: [] });
        expect(init?.activation.queue).toEqual(["S2"]);
        expect(init?.segment).toBe("orders");
    });
});

describe("boarding delivery", () => {
    it("boarding torpedo adds two marine units", () => {
        const pos: FullThrustGamePosition = {
            map: { mode: "fixed", width: 72, height: 48 },
            objects: [ship("F1", "P1"), ship("T1", "P2")] as FullThrustGamePosition["objects"],
        };
        const cmds = boardingDeliveryCommands(
            {
                name: "declareShipFire",
                ship: "F1",
                target: "T1",
                weapon: "bt1",
                notes: JSON.stringify({
                    profile: "boardingTorpedo",
                    weaponName: "boardingTorpedoLauncher",
                }),
            },
            pos,
            1
        );
        const adj = cmds.find((c) => c.name === "adjustBoarders") as { marines?: number; fromShip?: string };
        expect(adj?.marines).toBe(2);
        expect(adj?.fromShip).toBe("F1");
    });
});

describe("boarder ID replay determinism", () => {
    it("foldCommands assigns stable unit ids across replays", () => {
        const defender = ship("CruiserA1", "Player 1");
        const position: FullThrustGamePosition = {
            map: { mode: "fixed", width: 72, height: 48 },
            objects: [defender],
        };
        const meta = {
            version: "1.0.0",
            name: "test",
            createdAt: "",
            turn: 1,
            phase: 11 as const,
            dicePolicy: "hybrid" as const,
        };
        const commands = [
            {
                name: "setBoarders",
                ship: "CruiserA1",
                owner: "Player 2",
                dcp: 2,
                marines: 3,
            },
        ] as import("@/schemas/commands").FullThrustGameCommand[];

        const fold1 = foldCommands(meta, position, commands, 0);
        const ids1 = boarderUnitsOnShip(
            fold1.state.position.objects![0] as ShipWithBoarders
        ).map((u) => u.id);
        expect(ids1).toEqual(["brd-1", "brd-2", "brd-3", "brd-4", "brd-5"]);

        const fold2 = foldCommands(meta, position, commands, 0);
        const ids2 = boarderUnitsOnShip(
            fold2.state.position.objects![0] as ShipWithBoarders
        ).map((u) => u.id);
        expect(ids2).toEqual(ids1);
    });

    it("attacker boarding orders stay valid after append and re-fold", () => {
        const defender = ship("CruiserA1", "Player 1");
        const position: FullThrustGamePosition = {
            map: { mode: "fixed", width: 72, height: 48 },
            objects: [defender],
        };
        const headerMeta = {
            version: "1.0.0",
            name: "test",
            createdAt: "",
            turn: 1,
            phase: 12 as const,
            segment: "orders" as const,
            boardingStep: "attacker" as const,
            dicePolicy: "hybrid" as const,
            activation: { queue: ["CruiserA1"], index: 0 },
        };
        const setup = [
            {
                name: "setBoarders",
                ship: "CruiserA1",
                owner: "Player 2",
                dcp: 2,
                marines: 3,
            },
            { name: "advancePhase", phase: 12, turn: 1 },
        ] as import("@/schemas/commands").FullThrustGameCommand[];

        const foldedSetup = foldCommands(
            { ...headerMeta, phase: 11 },
            position,
            setup,
            0
        );
        const unitIds = boarderUnitsOnShip(
            foldedSetup.state.position.objects![0] as ShipWithBoarders,
            "Player 2"
        ).map((u) => u.id);

        const commands = [
            ...setup,
            {
                name: "declareBoardingAttackerOrders",
                ship: "CruiserA1",
                notes: encodeAttackerBoardingNotes({
                    v: 2,
                    attackerOwner: "Player 2",
                    unitAllocations: unitIds.map((unitId) => ({
                        unitId,
                        allocation: "raze" as const,
                    })),
                }),
            },
        ] as import("@/schemas/commands").FullThrustGameCommand[];

        const { warnings } = foldCommands(headerMeta, position, commands, 0);
        const declareWarnings = warnings.filter(
            (w) => w.command === "declareBoardingAttackerOrders"
        );
        expect(declareWarnings).toEqual([]);
    });
});

describe("defender boarding allocation validation", () => {
    it("warns when DCP allocation exceeds pool", () => {
        resetBoarderIdCounter();
        const defender = ship("D1", "P2");
        defender.object = { hull: { points: 12, rows: 4 }, mass: 89, systems: [] };
        const ids = addBoarderUnits(defender, "P1", [{ type: "marine" }]);
        const pool = shipBoardingCrewCapacity(defender).dcpPool;
        const issues = validateDefenderBoardingAllocations(defender, {
            dcpRepel: [{ boarderId: ids[0], dcp: pool + 2 }],
        });
        expect(issues.some((i) => /exceeds pool/.test(i.message))).toBe(true);
    });

    it("warns when the same marine is assigned twice", () => {
        resetBoarderIdCounter();
        const defender = ship("D1", "P2");
        defender.object = {
            hull: { points: 12 },
            systems: [
                { id: "m1", name: "marines" },
                { id: "m2", name: "marines" },
            ],
        };
        const ids = addBoarderUnits(defender, "P1", [{ type: "marine" }, { type: "marine" }]);
        const issues = validateDefenderBoardingAllocations(defender, {
            marineFight: [
                { boarderId: ids[0], marineId: "m1" },
                { boarderId: ids[1], marineId: "m1" },
            ],
        });
        expect(issues.some((i) => /assigned more than once/.test(i.message))).toBe(true);
    });

    it("foldCommands surfaces defender overallocation warnings in the log", () => {
        const defender = ship("CruiserA1", "Player 1");
        defender.object = { hull: { points: 26, rows: 4 }, mass: 89, systems: [] };
        const position: FullThrustGamePosition = {
            map: { mode: "fixed", width: 72, height: 48 },
            objects: [defender],
        };
        const headerMeta = {
            version: "1.0.0",
            name: "test",
            createdAt: "",
            turn: 1,
            phase: 12 as const,
            segment: "orders" as const,
            boardingStep: "defender" as const,
            dicePolicy: "hybrid" as const,
            activation: { queue: ["CruiserA1"], index: 0 },
        };
        const setup = [
            {
                name: "setBoarders",
                ship: "CruiserA1",
                owner: "Player 2",
                dcp: 0,
                marines: 1,
            },
            { name: "advancePhase", phase: 12, turn: 1 },
        ] as import("@/schemas/commands").FullThrustGameCommand[];
        const foldedSetup = foldCommands(
            { ...headerMeta, phase: 11 },
            position,
            setup,
            0
        );
        const boarderId = boarderUnitsOnShip(
            foldedSetup.state.position.objects![0] as ShipWithBoarders,
            "Player 2"
        )[0].id;
        const pool = shipBoardingCrewCapacity(
            foldedSetup.state.position.objects![0] as ShipWithBoarders
        ).dcpPool;
        const commands = [
            ...setup,
            {
                name: "declareBoardingAttackerOrders",
                ship: "CruiserA1",
                notes: encodeAttackerBoardingNotes({
                    v: 2,
                    attackerOwner: "Player 2",
                    unitAllocations: [{ unitId: boarderId, allocation: "kill" }],
                }),
            },
            { name: "advanceSegment" },
            {
                name: "declareBoardingDefenderOrders",
                ship: "CruiserA1",
                notes: encodeDefenderBoardingNotes({
                    v: 2,
                    dcpRepel: [{ boarderId, dcp: pool + 3 }],
                }),
            },
        ] as import("@/schemas/commands").FullThrustGameCommand[];

        const { warnings } = foldCommands(headerMeta, position, commands, 0);
        const defenderWarnings = warnings.filter(
            (w) => w.command === "declareBoardingDefenderOrders"
        );
        expect(defenderWarnings.some((w) => /exceeds pool/.test(w.description))).toBe(true);
    });
});
