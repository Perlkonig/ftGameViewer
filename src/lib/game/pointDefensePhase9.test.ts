import { describe, expect, it } from "vitest";
import type { FullThrustGamePosition } from "@/schemas/position";
import { applyCommand, type FoldState } from "./applyCommand";
import { DEFAULT_META } from "./types";
import {
    applyPhase9PointDefenseBatchFromRolls,
    buildPhase9PdResolveCommands,
    declaredPointDefenseFromCommands,
    expandPointDefenseAllocations,
    phase9PointDefenseResolvedInLog,
    pointDefenseFighterTargetWarnings,
    pointDefenseSupportIssues,
    shipLaunchedOrRecoveredFightersThisTurn,
    validateDeclarePointDefense,
    validatePointDefenseAllocationBatch,
} from "./pointDefensePhase9";
import { incomingThreatsForPhase9 } from "./incomingThreats";

describe("pointDefensePhase9", () => {
    it("applyPhase9 destroys ordnance on kill", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            players: [],
            objects: [
                {
                    objType: "ship" as const,
                    id: "S1",
                    owner: "P1",
                    position: { x: 0, y: 0 },
                    object: { weapons: [{ name: "pds", id: "p1" }] },
                },
                {
                    objType: "ordnance" as const,
                    id: "M1",
                    owner: "P2",
                    type: "salvo",
                    position: { x: 1, y: 0 },
                    targetShip: "S1",
                    salvoCount: 4,
                },
            ],
        } as FullThrustGamePosition;
        const decls = [
            {
                defenderShip: "S1",
                weapon: "p1",
                supportedShip: "S1",
                threatId: "M1",
                profile: "pds" as const,
            },
        ];
        const result = applyPhase9PointDefenseBatchFromRolls(
            position,
            decls,
            [6, 3],
            [],
            1
        );
        expect(result.allocations[0].kills).toBeGreaterThan(0);
        expect(position.objects?.some((o) => o.id === "M1")).toBe(false);
        expect(result.pdKillsByOrdnance.M1).toBeGreaterThan(0);
    });

    it("buildPhase9PdResolveCommands emits per-mount scrub-back stream", () => {
        const result = {
            rolls: [4],
            notes: "test",
            allocations: [
                {
                    declaration: {
                        defenderShip: "S1",
                        weapon: "p1",
                        supportedShip: "S1",
                        threatId: "M1",
                        profile: "pds" as const,
                    },
                    kills: 1,
                    rolls: [4],
                    summary: "S1/pds → M1: 1 kill(s)",
                },
            ],
            pdKillsByOrdnance: { M1: 1 },
            survivingFighterAttackers: [],
        };
        const cmds = buildPhase9PdResolveCommands(result);
        expect(cmds.map((c) => c.name)).toEqual([
            "logDice",
            "resolvePointDefenseMount",
            "_custom",
            "resolvePhase9Complete",
        ]);
    });

    it("applyCommand declare and resolve phase 9", () => {
        let fold: FoldState = {
            meta: {
                ...DEFAULT_META(),
                phase: 9,
                segment: "orders",
                turn: 1,
                activation: { queue: [], index: 0 },
            },
            position: {
                map: { mode: "fixed", width: 72, height: 48 },
                players: [],
                objects: [
                    {
                        objType: "ship",
                        id: "S1",
                        owner: "P1",
                        position: { x: 0, y: 0 },
                        object: { weapons: [{ name: "pds", id: "p1" }] },
                    },
                    {
                        objType: "ordnance",
                        id: "M1",
                        owner: "P2",
                        type: "salvo",
                        position: { x: 1, y: 0 },
                        targetShip: "S1",
                        salvoCount: 4,
                    },
                ],
            },
        };
        fold = applyCommand(fold, {
            name: "declarePointDefense",
            defenderShip: "S1",
            weapon: "p1",
            supportedShip: "S1",
            threatId: "M1",
            profile: "pds",
        } as never).state;
        expect(fold.phase9PdDeclarations).toHaveLength(1);

        fold = applyCommand(fold, { name: "advanceSegment" } as never).state;
        expect(fold.meta.segment).toBe("resolve");

        const resolveCmds = buildPhase9PdResolveCommands({
            rolls: [5],
            notes: "S1/pds → M1: 1 kill(s)",
            allocations: [
                {
                    declaration: {
                        defenderShip: "S1",
                        weapon: "p1",
                        supportedShip: "S1",
                        threatId: "M1",
                        profile: "pds",
                    },
                    kills: 1,
                    rolls: [5],
                    summary: "S1/pds → M1: 1 kill(s)",
                },
            ],
            pdKillsByOrdnance: { M1: 1 },
            survivingFighterAttackers: [],
        });
        for (const cmd of resolveCmds) {
            fold = applyCommand(fold, cmd as never).state;
        }
        expect(fold.phase9PdDeclarations).toEqual([]);
        expect(fold.position.objects?.some((o) => o.id === "M1")).toBe(false);
    });

    it("replays declarePointDefense from command log", () => {
        const cmds = [
            { name: "advancePhase", phase: 9, turn: 1 },
            {
                name: "declarePointDefense",
                defenderShip: "S1",
                weapon: "p1",
                threatId: "M1",
            },
        ] as never[];
        expect(declaredPointDefenseFromCommands(cmds, 1, 9)).toHaveLength(1);
    });

    it("phase9PointDefenseResolvedInLog detects resolve", () => {
        const cmds = [
            { name: "advancePhase", phase: 9, turn: 1 },
            { name: "resolvePhase9Complete", count: 1 },
        ] as never[];
        expect(phase9PointDefenseResolvedInLog(cmds, 1)).toBe(true);
    });

    it("expandPointDefenseAllocations assigns multiple mounts to one threat", () => {
        const mounts = [
            { name: "pds", id: "p1" },
            { name: "pds", id: "p2" },
            { name: "pds", id: "p3" },
            { name: "pds", id: "p4" },
            { name: "pds", id: "p5" },
            { name: "pds", id: "p6" },
        ];
        const decls = expandPointDefenseAllocations("S1", "S1", mounts, [
            { threatId: "F1", byProfile: { pds: 4 } },
            { threatId: "F2", byProfile: { pds: 2 } },
        ]);
        expect(decls).toHaveLength(6);
        expect(decls.filter((d) => d.threatId === "F1")).toHaveLength(4);
        expect(decls.filter((d) => d.threatId === "F2")).toHaveLength(2);
        expect(new Set(decls.map((d) => d.weapon)).size).toBe(6);
    });

    it("applyPhase9 resolves multiple PDS against one fighter wing", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            players: [],
            objects: [
                {
                    objType: "ship" as const,
                    id: "S1",
                    owner: "P1",
                    position: { x: 0, y: 0 },
                    object: {
                        weapons: [
                            { name: "pds", id: "p1" },
                            { name: "pds", id: "p2" },
                            { name: "pds", id: "p3" },
                            { name: "pds", id: "p4" },
                        ],
                    },
                },
                {
                    objType: "fighters" as const,
                    id: "F1",
                    owner: "P2",
                    number: 6,
                    position: { x: 1, y: 0 },
                    attackAllocation: { targetId: "S1", targetType: "ship" },
                },
            ],
        } as FullThrustGamePosition;
        const decls = expandPointDefenseAllocations(
            "S1",
            "S1",
            [
                { name: "pds", id: "p1" },
                { name: "pds", id: "p2" },
                { name: "pds", id: "p3" },
                { name: "pds", id: "p4" },
            ],
            [{ threatId: "F1", byProfile: { pds: 4 } }]
        );
        const result = applyPhase9PointDefenseBatchFromRolls(
            position,
            decls,
            [4, 4, 4, 4],
            [],
            1
        );
        expect(result.allocations).toHaveLength(4);
        expect(result.allocations.every((a) => a.declaration.threatId === "F1")).toBe(true);
        const fighter = position.objects?.find((o) => o.id === "F1");
        expect(fighter?.objType === "fighters" ? fighter.number : -1).toBe(2);
    });

    it("validatePointDefenseAllocationBatch rejects over-allocation", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            objects: [
                {
                    objType: "ship" as const,
                    id: "S1",
                    owner: "P1",
                    position: { x: 0, y: 0 },
                    object: {
                        weapons: [
                            { name: "pds", id: "p1" },
                            { name: "pds", id: "p2" },
                        ],
                    },
                },
                {
                    objType: "fighters" as const,
                    id: "F1",
                    owner: "P2",
                    number: 6,
                    position: { x: 1, y: 0 },
                    attackAllocation: { targetId: "S1", targetType: "ship" },
                },
                {
                    objType: "fighters" as const,
                    id: "F2",
                    owner: "P2",
                    number: 6,
                    position: { x: 2, y: 0 },
                    attackAllocation: { targetId: "S1", targetType: "ship" },
                },
            ],
        } as FullThrustGamePosition;
        const mounts = [
            { name: "pds", id: "p1" },
            { name: "pds", id: "p2" },
        ];
        const issues = validatePointDefenseAllocationBatch(
            position,
            "S1",
            "S1",
            mounts,
            [
                { threatId: "F1", byProfile: { pds: 2 } },
                { threatId: "F2", byProfile: { pds: 2 } },
            ],
            [],
            [],
            1
        );
        expect(issues.some((i) => i.severity === "error")).toBe(true);
    });

    it("warns when allocating PD against unengaged fighters", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            objects: [
                {
                    objType: "ship" as const,
                    id: "S1",
                    owner: "P1",
                    position: { x: 0, y: 0 },
                    object: { weapons: [{ name: "pds", id: "p1" }] },
                },
                {
                    objType: "fighters" as const,
                    id: "F1",
                    owner: "P2",
                    number: 6,
                    callsign: "Alpha",
                    position: { x: 1, y: 0 },
                },
            ],
        } as FullThrustGamePosition;
        const board = incomingThreatsForPhase9(position, [], 1);
        const warnings = pointDefenseFighterTargetWarnings(position, board, "F1");
        expect(warnings).toHaveLength(1);
        expect(warnings[0].severity).toBe("warning");
        expect(warnings[0].message).toContain("unengaged");

        const declIssues = validateDeclarePointDefense(
            position,
            {
                defenderShip: "S1",
                weapon: "p1",
                supportedShip: "S1",
                threatId: "F1",
                profile: "pds",
            },
            [],
            [],
            1
        );
        expect(declIssues.some((i) => i.severity === "warning" && i.message.includes("unengaged"))).toBe(
            true
        );
    });

    it("pointDefenseSupportIssues warns ally support without ADFC", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            objects: [
                {
                    objType: "ship" as const,
                    id: "A1",
                    owner: "P1",
                    position: { x: 0, y: 0 },
                    object: { weapons: [{ name: "pds", id: "p1" }] },
                },
                {
                    objType: "ship" as const,
                    id: "A2",
                    owner: "P1",
                    position: { x: 2, y: 0 },
                    object: {},
                },
            ],
        } as FullThrustGamePosition;
        const issues = pointDefenseSupportIssues(position, "A1", "A2");
        expect(issues.some((i) => i.severity === "warning" && i.message.includes("ADFC"))).toBe(
            true
        );
    });

    it("pointDefenseSupportIssues allows direct self-defense without ADFC warnings", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            objects: [
                {
                    objType: "ship" as const,
                    id: "A1",
                    owner: "P1",
                    position: { x: 0, y: 0 },
                    object: {
                        systems: [{ name: "adfc", id: "adfc1" }],
                        weapons: [{ name: "pds", id: "p1" }],
                    },
                },
            ],
        } as FullThrustGamePosition;
        const issues = pointDefenseSupportIssues(position, "A1", "A1");
        expect(issues).toHaveLength(0);
    });

    it("pointDefenseSupportIssues warns when ADFC ship launched fighters this turn", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            objects: [
                {
                    objType: "ship" as const,
                    id: "A1",
                    owner: "P1",
                    position: { x: 0, y: 0 },
                    object: {
                        systems: [{ name: "adfc", id: "adfc1" }],
                        weapons: [{ name: "pds", id: "p1" }],
                    },
                },
                {
                    objType: "ship" as const,
                    id: "A2",
                    owner: "P1",
                    position: { x: 2, y: 0 },
                    object: {},
                },
            ],
        } as FullThrustGamePosition;
        const commands = [
            { name: "launchFighters", ship: "A1", hangarId: "h1" },
        ] as never[];
        const issues = pointDefenseSupportIssues(position, "A1", "A2", [], {
            commands,
            turn: 1,
        });
        expect(
            issues.some((i) => i.severity === "warning" && i.message.includes("launched or recovered"))
        ).toBe(true);
    });

    it("shipLaunchedOrRecoveredFightersThisTurn detects launch and recovery", () => {
        const cmds = [
            { name: "launchFighters", ship: "S1", hangarId: "h1" },
            {
                name: "moveFighters",
                id: "F1",
                position: { ship: "S2", hangar: "h1" },
            },
        ] as never[];
        expect(shipLaunchedOrRecoveredFightersThisTurn(cmds, 1, "S1")).toBe(true);
        expect(shipLaunchedOrRecoveredFightersThisTurn(cmds, 1, "S2")).toBe(true);
        expect(shipLaunchedOrRecoveredFightersThisTurn(cmds, 1, "S3")).toBe(false);
    });

    it("pointDefenseSupportIssues warns out-of-range ADFC support", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            objects: [
                {
                    objType: "ship" as const,
                    id: "A1",
                    owner: "P1",
                    position: { x: 0, y: 0 },
                    object: {
                        systems: [{ name: "adfc", id: "adfc1" }],
                        weapons: [{ name: "pds", id: "p1" }],
                    },
                },
                {
                    objType: "ship" as const,
                    id: "B1",
                    owner: "P1",
                    position: { x: 20, y: 0 },
                    object: {},
                },
            ],
        } as FullThrustGamePosition;
        const issues = pointDefenseSupportIssues(position, "A1", "B1");
        expect(issues.some((i) => i.severity === "warning" && i.message.includes("within 6 MU"))).toBe(
            true
        );
    });

    it("pointDefenseSupportIssues allows PDS gunboat area defense within 6 MU", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            objects: [
                {
                    objType: "gunboats" as const,
                    id: "GB1",
                    owner: "P1",
                    squadronKey: "r1",
                    type: "pointDefense",
                    number: 2,
                    endurance: 6,
                    skill: "standard" as const,
                    position: { x: 0, y: 0 },
                    boats: [
                        { type: "pointDefense", id: "b0" },
                        { type: "pointDefense", id: "b1" },
                    ],
                },
                {
                    objType: "ship" as const,
                    id: "A1",
                    owner: "P1",
                    position: { x: 4, y: 0 },
                    object: {},
                },
            ],
        } as FullThrustGamePosition;
        const issues = pointDefenseSupportIssues(position, "GB1", "A1");
        expect(issues.filter((i) => i.severity === "warning")).toEqual([]);
    });

    it("validateDeclarePointDefense accepts gunboat PDS mount vs fighters", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            objects: [
                {
                    objType: "gunboats" as const,
                    id: "GB1",
                    owner: "P1",
                    squadronKey: "r1",
                    type: "pointDefense",
                    number: 1,
                    endurance: 6,
                    skill: "standard" as const,
                    position: { x: 0, y: 0 },
                    boats: [{ type: "pointDefense", id: "b0" }],
                },
                {
                    objType: "ship" as const,
                    id: "A1",
                    owner: "P1",
                    position: { x: 3, y: 0 },
                    object: {},
                },
                {
                    objType: "fighters" as const,
                    id: "F1",
                    owner: "P2",
                    type: "standard",
                    number: 6,
                    endurance: 6,
                    skill: "standard" as const,
                    position: { x: 5, y: 0 },
                },
            ],
        } as FullThrustGamePosition;
        const decl = {
            defenderShip: "GB1",
            weapon: "GB1:pds:b0:0",
            supportedShip: "A1",
            threatId: "F1",
            profile: "pds" as const,
        };
        const issues = validateDeclarePointDefense(position, decl, [], [], 1);
        expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    });
});
