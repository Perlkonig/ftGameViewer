import { describe, expect, it } from "vitest";
import { fighterAttackAllocationsFromLog } from "./fighterEngagement";
import type { FullThrustGameCommand } from "@/schemas/commands";

describe("fighterEngagement", () => {
    it("reconstructs phase 7 allocations from command log", () => {
        const cmds: FullThrustGameCommand[] = [
            { name: "advancePhase", phase: 7, turn: 1 } as FullThrustGameCommand,
            {
                name: "declareFighterAttack",
                id: "FG1",
                targetType: "ship",
                targetId: "S1",
            } as FullThrustGameCommand,
            {
                name: "declareFighterAttack",
                id: "FG2",
                targetType: "fighters",
                targetId: "EF1",
            } as FullThrustGameCommand,
            { name: "advancePhase", phase: 8, turn: 1 } as FullThrustGameCommand,
        ];
        const allocs = fighterAttackAllocationsFromLog(cmds, 1);
        expect(allocs).toHaveLength(2);
        expect(allocs[0]).toMatchObject({
            groupId: "FG1",
            targetType: "ship",
            targetId: "S1",
        });
    });
});
