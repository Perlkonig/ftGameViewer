import { describe, expect, it } from "vitest";
import type { FullThrustGamePosition } from "@/schemas/position";
import type { FullThrustGameCommand } from "@/schemas/commands";
import { arrayRollSource } from "./dice";
import {
    buildAutoInterceptCommands,
    furballWorkNeeded,
    uncoveredFurballGroups,
    validateDeclareFurball,
    validateResolvePhase8Furballs,
    applyPhase8FurballBatchFromRolls,
    buildPhase8FurballResolveCommands,
    declaredFurballsFromCommands,
    effectivePhase8FurballDeclarations,
    phase8FurballsResolvedInLog,
} from "./fighterPhase8";
import { applyCommand, type FoldState } from "./applyCommand";
import { DEFAULT_META } from "./types";

function fighter(
    id: string,
    alloc?: { targetType: "ordnance" | "fighters"; targetId: string }
) {
    return {
        objType: "fighters" as const,
        id,
        owner: "P1",
        type: "standard" as const,
        number: 1,
        endurance: 6,
        skill: "standard" as const,
        position: { x: 10, y: 10 },
        facing: 12,
        ...(alloc
            ? {
                  attackAllocation: {
                      turn: 1,
                      targetType: alloc.targetType,
                      targetId: alloc.targetId,
                  },
              }
            : {}),
    };
}

function salvo(id: string) {
    return {
        objType: "ordnance" as const,
        id,
        owner: "P2",
        type: "salvo" as const,
        position: { x: 11, y: 10 },
        salvoCount: 6,
    };
}

describe("fighterPhase8", () => {
    it("builds auto intercept commands from ordnance allocations", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            players: [],
            objects: [
                fighter("FG1", { targetType: "ordnance", targetId: "SAL1" }),
                salvo("SAL1"),
            ],
        } as FullThrustGamePosition;
        const allocations = [
            {
                groupId: "FG1",
                targetType: "ordnance" as const,
                targetId: "SAL1",
                turn: 1,
            },
        ];
        const { commands, warnings } = buildAutoInterceptCommands(
            position,
            allocations,
            arrayRollSource([3])
        );
        expect(warnings).toEqual([]);
        expect(commands.some((c) => c.name === "interceptOrdnance")).toBe(true);
        expect(commands.some((c) => c.name === "logDice")).toBe(true);
        const intercept = commands.find((c) => c.name === "interceptOrdnance") as {
            id?: string;
            ordnanceId?: string;
            rolls?: number[];
        };
        expect(intercept?.id).toBe("FG1");
        expect(intercept?.ordnanceId).toBe("SAL1");
        expect(intercept?.rolls?.length).toBeGreaterThan(0);
    });

    it("skips invalid interceptors with warnings", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            players: [],
            objects: [salvo("SAL1")],
        } as FullThrustGamePosition;
        const allocations = [
            {
                groupId: "MISSING",
                targetType: "ordnance" as const,
                targetId: "SAL1",
                turn: 1,
            },
        ];
        const { commands, warnings } = buildAutoInterceptCommands(
            position,
            allocations,
            arrayRollSource([6])
        );
        expect(commands).toHaveLength(0);
        expect(warnings.some((w) => w.includes("MISSING"))).toBe(true);
    });

    it("detects furball work from fighter-on-fighter allocations", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            players: [],
            objects: [
                fighter("A1", { targetType: "fighters", targetId: "B1" }),
                fighter("B1"),
            ],
        } as FullThrustGamePosition;
        const allocations = [
            {
                groupId: "A1",
                targetType: "fighters" as const,
                targetId: "B1",
                turn: 1,
            },
        ];
        expect(furballWorkNeeded(position, allocations)).toBe(true);
        expect(
            furballWorkNeeded(position, [
                {
                    groupId: "A1",
                    targetType: "ordnance",
                    targetId: "SAL1",
                    turn: 1,
                },
            ])
        ).toBe(false);
    });

    it("validates furball coverage before batch resolve", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            players: [],
            objects: [
                fighter("A1", { targetType: "fighters", targetId: "B1" }),
                fighter("B1"),
            ],
        } as FullThrustGamePosition;
        const allocations = [
            {
                groupId: "A1",
                targetType: "fighters" as const,
                targetId: "B1",
                turn: 1,
            },
        ];
        const uncovered = uncoveredFurballGroups(position, allocations, []);
        expect(uncovered.sort()).toEqual(["A1", "B1"]);

        const engagement = {
            attackers: [{ id: "A1", targetIds: ["B1"] }],
            defenders: [{ id: "B1", targetIds: ["A1"] }],
        };
        const declareIssues = validateDeclareFurball(position, engagement, [], allocations);
        expect(declareIssues.filter((i) => i.severity === "error")).toHaveLength(0);
        expect(uncoveredFurballGroups(position, allocations, [engagement])).toEqual([]);

        const resolveIssues = validateResolvePhase8Furballs(position, allocations, [engagement]);
        expect(resolveIssues.filter((i) => i.severity === "error")).toHaveLength(0);
    });

    it("replays declareFurball from command log", () => {
        const cmds: FullThrustGameCommand[] = [
            { name: "advancePhase", phase: 8, turn: 1 } as FullThrustGameCommand,
            {
                name: "declareFurball",
                engagement: {
                    attackers: [{ id: "A1", targetIds: ["B1"] }],
                    defenders: [{ id: "B1", targetIds: ["A1"] }],
                },
            } as FullThrustGameCommand,
        ];
        const decls = declaredFurballsFromCommands(cmds, 1);
        expect(decls).toHaveLength(1);
        expect(decls[0].attackers[0].id).toBe("A1");
    });

    it("effectivePhase8FurballDeclarations falls back to command log", () => {
        const cmds: FullThrustGameCommand[] = [
            { name: "advancePhase", phase: 8, turn: 1 } as FullThrustGameCommand,
            {
                name: "declareFurball",
                engagement: {
                    attackers: [{ id: "A1", targetIds: ["B1"] }],
                    defenders: [{ id: "B1", targetIds: ["A1"] }],
                },
            } as FullThrustGameCommand,
        ];
        expect(effectivePhase8FurballDeclarations([], cmds, 1)).toHaveLength(1);
        expect(phase8FurballsResolvedInLog(cmds, 1)).toBe(false);
    });

    it("detects phase 8 resolve in command log", () => {
        const cmds: FullThrustGameCommand[] = [
            { name: "advancePhase", phase: 8, turn: 1 } as FullThrustGameCommand,
            {
                name: "declareFurball",
                engagement: {
                    attackers: [{ id: "A1", targetIds: ["B1"] }],
                    defenders: [{ id: "B1", targetIds: ["A1"] }],
                },
            } as FullThrustGameCommand,
            { name: "resolvePhase8Furballs", rolls: [3, 3] } as FullThrustGameCommand,
        ];
        expect(phase8FurballsResolvedInLog(cmds, 1)).toBe(true);
        expect(effectivePhase8FurballDeclarations([], cmds, 1)).toEqual([]);
    });

    it("batch resolve consumes rolls across engagements", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            players: [],
            objects: [
                {
                    objType: "fighters" as const,
                    id: "A",
                    owner: "P1",
                    type: "standard",
                    number: 2,
                    endurance: 3,
                    skill: "standard",
                    position: { x: 0, y: 0 },
                },
                {
                    objType: "fighters" as const,
                    id: "B",
                    owner: "P2",
                    type: "standard",
                    number: 2,
                    endurance: 6,
                    skill: "standard",
                    position: { x: 1, y: 0 },
                },
            ],
        } as FullThrustGamePosition;
        const engagement = {
            attackers: [{ id: "A", targetIds: ["B"] }],
            defenders: [{ id: "B", targetIds: ["A"] }],
        };
        const rolls = [3, 3, 3, 3];
        applyPhase8FurballBatchFromRolls(position, [engagement], rolls);
        const a = position.objects?.find((o) => o.id === "A") as { endurance?: number };
        const b = position.objects?.find((o) => o.id === "B") as { endurance?: number };
        expect(a?.endurance).toBe(2);
        expect(b?.endurance).toBe(5);
    });

    it("buildPhase8FurballResolveCommands includes per-engagement narrative", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            players: [],
            objects: [
                {
                    objType: "fighters" as const,
                    id: "A",
                    owner: "P1",
                    type: "standard",
                    number: 2,
                    endurance: 3,
                    skill: "standard",
                    position: { x: 0, y: 0 },
                    callsign: "Blue 1",
                },
                {
                    objType: "fighters" as const,
                    id: "B",
                    owner: "P2",
                    type: "standard",
                    number: 2,
                    endurance: 6,
                    skill: "standard",
                    position: { x: 1, y: 0 },
                    callsign: "Red 1",
                },
            ],
        } as FullThrustGamePosition;
        const engagement = {
            attackers: [{ id: "A", targetIds: ["B"] }],
            defenders: [{ id: "B", targetIds: ["A"] }],
        };
        const result = applyPhase8FurballBatchFromRolls(position, [engagement], [3, 3, 3, 3]);
        expect(result.summaries).toHaveLength(1);
        expect(result.summaries[0].summary).toContain("Blue 1");
        expect(result.summaries[0].summary).toContain("Red 1");
        expect(result.summaries[0].summary).toContain("kills");

        const commands = buildPhase8FurballResolveCommands(result, 1);
        expect(commands.map((c) => c.name)).toEqual([
            "logDice",
            "resolvePhase8Furballs",
            "_custom",
        ]);
        const resolve = commands.find((c) => c.name === "resolvePhase8Furballs") as {
            notes?: string;
        };
        expect(resolve.notes).toContain("Blue 1");
        const custom = commands.find((c) => c.name === "_custom") as { msg?: string };
        expect(custom.msg).toMatch(/^Furball:/);
    });

    it("applyCommand declareFurball accumulates and resolvePhase8Furballs clears", () => {
        let fold: FoldState = {
            meta: {
                ...DEFAULT_META(),
                phase: 8,
                segment: "orders",
                turn: 1,
                activation: { queue: [], index: 0 },
            },
            position: {
                map: { mode: "fixed", width: 72, height: 48 },
                players: [],
                objects: [
                    {
                        ...fighter("A1", { targetType: "fighters", targetId: "B1" }),
                        number: 1,
                    },
                    { ...fighter("B1"), number: 1 },
                ],
            },
        };
        const engagement = {
            attackers: [{ id: "A1", targetIds: ["B1"] }],
            defenders: [{ id: "B1", targetIds: ["A1"] }],
        };
        fold = applyCommand(fold, {
            name: "declareFurball",
            engagement,
        } as never).state;
        expect(fold.phase8FurballDeclarations).toHaveLength(1);

        fold = applyCommand(fold, { name: "advanceSegment" } as never).state;
        expect(fold.meta.segment).toBe("resolve");

        const rolls = [3, 3];
        fold = applyCommand(fold, {
            name: "resolvePhase8Furballs",
            rolls,
        } as never).state;
        expect(fold.phase8FurballDeclarations).toEqual([]);
    });

    it("rejects fighter bypass via empty-defender declaration", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            players: [],
            objects: [
                {
                    objType: "fighters" as const,
                    id: "SCR1",
                    owner: "P1",
                    type: "standard",
                    number: 6,
                    endurance: 6,
                    skill: "standard",
                    position: { x: 0, y: 0 },
                    fighterAttachment: {
                        kind: "screen" as const,
                        targetType: "fighters" as const,
                        targetId: "F1",
                    },
                },
                {
                    objType: "fighters" as const,
                    id: "F1",
                    owner: "P1",
                    type: "standard",
                    number: 6,
                    endurance: 6,
                    skill: "standard",
                    position: { x: 1, y: 0 },
                },
                {
                    objType: "fighters" as const,
                    id: "ATK1",
                    owner: "P2",
                    type: "standard",
                    number: 6,
                    endurance: 6,
                    skill: "standard",
                    position: { x: 5, y: 5 },
                },
                {
                    objType: "fighters" as const,
                    id: "ATK2",
                    owner: "P2",
                    type: "standard",
                    number: 6,
                    endurance: 6,
                    skill: "standard",
                    position: { x: 6, y: 5 },
                },
            ],
        } as FullThrustGamePosition;
        const allocations = [
            { groupId: "ATK1", targetType: "fighters" as const, targetId: "F1", turn: 1 },
            { groupId: "ATK2", targetType: "fighters" as const, targetId: "F1", turn: 1 },
        ];
        const furball = {
            attackers: [{ id: "ATK1", targetIds: ["SCR1"] }],
            defenders: [{ id: "SCR1", targetIds: ["ATK1"] }],
        };
        const badBypass = {
            attackers: [{ id: "ATK2", targetIds: ["F1"] }],
            defenders: [],
        };
        const issues = validateDeclareFurball(position, badBypass, [furball], allocations);
        expect(issues.some((i) => i.severity === "error")).toBe(true);
    });

    it("accepts merged furball A1→D1,D2 plus A2→D3 in screening skirmish", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            players: [],
            objects: [
                {
                    objType: "fighters" as const,
                    id: "SCR1",
                    owner: "P2",
                    type: "standard",
                    number: 6,
                    endurance: 6,
                    skill: "standard",
                    position: { x: 0, y: 0 },
                    fighterAttachment: {
                        kind: "screen" as const,
                        targetType: "ship" as const,
                        targetId: "S1",
                    },
                },
                {
                    objType: "fighters" as const,
                    id: "SCR2",
                    owner: "P2",
                    type: "standard",
                    number: 6,
                    endurance: 6,
                    skill: "standard",
                    position: { x: 1, y: 0 },
                    fighterAttachment: {
                        kind: "screen" as const,
                        targetType: "ship" as const,
                        targetId: "S1",
                    },
                },
                {
                    objType: "ship" as const,
                    id: "S1",
                    owner: "P2",
                    position: { x: 0, y: 2 },
                    facing: 12 as const,
                    speed: 0,
                    object: {},
                    svg: "",
                },
                ...["A1", "A2"].map((id) => ({
                    objType: "fighters" as const,
                    id,
                    owner: "P1",
                    type: "standard" as const,
                    number: 6,
                    endurance: 6,
                    skill: "standard" as const,
                    position: { x: 5, y: 5 },
                })),
            ],
        } as FullThrustGamePosition;
        const allocations = [
            { groupId: "A1", targetType: "ship" as const, targetId: "S1", turn: 1 },
            { groupId: "A2", targetType: "ship" as const, targetId: "S1", turn: 1 },
        ];
        const eng = {
            attackers: [
                { id: "A1", targetIds: ["SCR1", "SCR2"] },
                { id: "A2", targetIds: ["SCR2"] },
            ],
            defenders: [
                { id: "SCR1", targetIds: ["A1"] },
                { id: "SCR2", targetIds: ["A1", "A2"] },
            ],
        };
        const issues = validateDeclareFurball(position, eng, [], allocations);
        expect(issues.filter((i) => i.severity === "error")).toHaveLength(0);
    });
});
