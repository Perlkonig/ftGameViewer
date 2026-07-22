import { describe, expect, it } from "vitest";
import type { FullThrustGamePosition } from "@/schemas/position";
import { arrayRollSource } from "./dice";
import {
    buildPhase10ResolveCommands,
    phase10StrikeQueue,
    phase10StrikesCompleteInLog,
} from "./phase10Strikes";
import { isAttackRunInterceptPair } from "./fighterPhase8";
import type { FighterAttackAlloc } from "./fighterEngagement";

describe("phase10Strikes", () => {
    it("phase10StrikeQueue orders open-space AMT before homing strikes", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            objects: [
                {
                    objType: "ordnance" as const,
                    id: "AMT1",
                    type: "amt",
                    position: { x: 0, y: 0 },
                    amtWarheadStrength: 6,
                    detonateOpenSpace: true,
                },
                {
                    objType: "ordnance" as const,
                    id: "SAL1",
                    owner: "P2",
                    type: "salvo",
                    position: { x: 5, y: 0 },
                    targetShip: "T1",
                    salvoCount: 4,
                },
                {
                    objType: "ship" as const,
                    id: "T1",
                    owner: "P1",
                    position: { x: 6, y: 0 },
                    object: {},
                },
            ],
        } as FullThrustGamePosition;
        const cmds = [
            { name: "advancePhase", phase: 7, turn: 1 },
            {
                name: "declareFighterAttack",
                id: "F1",
                targetType: "ship",
                targetId: "T1",
            },
            { name: "advancePhase", phase: 9, turn: 1 },
            {
                name: "resolvePhase9Complete",
                count: 0,
                pdKillsByOrdnance: {},
                survivingFighterAttackers: [],
            },
        ] as never[];
        const queue = phase10StrikeQueue(position, cmds, 1);
        expect(queue[0]?.kind).toBe("amtOpenSpace");
        expect(queue.some((e) => e.kind === "salvoStrike")).toBe(true);
    });

    it("buildPhase10ResolveCommands emits scrub-back stream", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            objects: [
                {
                    objType: "ordnance" as const,
                    id: "M1",
                    owner: "P2",
                    type: "missile",
                    position: { x: 1, y: 0 },
                    targetShip: "S1",
                },
                {
                    objType: "ship" as const,
                    id: "S1",
                    owner: "P1",
                    position: { x: 0, y: 0 },
                    object: { hull: { points: 12, rows: 3 } },
                },
            ],
        } as FullThrustGamePosition;
        const { commands } = buildPhase10ResolveCommands(
            position,
            [
                { name: "declareFighterAttack", id: "F1", targetType: "ship", targetId: "S1" },
            ] as never[],
            1,
            arrayRollSource([4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4])
        );
        expect(commands.some((c) => c.name === "logDice")).toBe(true);
        expect(commands.some((c) => c.name === "strikeOrdnance")).toBe(true);
        expect(commands.at(-1)?.name).toBe("resolvePhase10Complete");
    });

    it("phase10StrikesCompleteInLog detects marker", () => {
        const cmds = [
            { name: "advancePhase", phase: 10, turn: 1 },
            { name: "resolvePhase10Complete", count: 2 },
        ] as never[];
        expect(phase10StrikesCompleteInLog(cmds, 1)).toBe(true);
    });

    it("isAttackRunInterceptPair detects interceptor vs ship attacker", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            objects: [
                {
                    objType: "fighters" as const,
                    id: "I1",
                    owner: "P1",
                    number: 6,
                    position: { x: 0, y: 0 },
                },
                {
                    objType: "fighters" as const,
                    id: "A1",
                    owner: "P2",
                    number: 6,
                    position: { x: 1, y: 0 },
                },
            ],
        } as FullThrustGamePosition;
        const allocations: FighterAttackAlloc[] = [
            { groupId: "I1", targetType: "fighters", targetId: "A1", turn: 1 },
            { groupId: "A1", targetType: "ship", targetId: "S1", turn: 1 },
        ];
        expect(isAttackRunInterceptPair(allocations[0], allocations, position)).toBe(true);
    });
});
