/** Phase 7 attack allocations for phase 8 resolution. */

import type { FullThrustGameCommand } from "@/schemas/commands";
import type { FullThrustGamePosition } from "@/schemas/position";
import type { FighterAttackAllocation, FighterAttackTargetType } from "./fighterAttack";
import { isDeployedFighter } from "./fighterMove";

export interface FighterAttackAlloc {
    groupId: string;
    targetType: FighterAttackTargetType;
    targetId: string;
    turn: number;
}

type FighterObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "fighters" }
>;

/** Replay-safe: scan declareFighterAttack commands for a given turn. */
export function fighterAttackAllocationsFromLog(
    commands: FullThrustGameCommand[],
    turn: number
): FighterAttackAlloc[] {
    const out: FighterAttackAlloc[] = [];
    let cmdTurn = 1;
    let phase = 1;
    for (const cmd of commands) {
        if (cmd.name === "advancePhase") {
            const p = (cmd as { phase?: number }).phase;
            if (typeof p === "number") {
                phase = p;
                if (phase === 1) cmdTurn += 1;
            }
        }
        if (cmd.name !== "declareFighterAttack") continue;
        if (cmdTurn !== turn || phase !== 7) continue;
        const c = cmd as { id?: string; targetType?: FighterAttackTargetType; targetId?: string };
        if (!c.id || !c.targetType || !c.targetId) continue;
        out.push({
            groupId: c.id,
            targetType: c.targetType,
            targetId: c.targetId,
            turn,
        });
    }
    return out;
}

export function fighterAttackAllocationsFromPosition(
    position: FullThrustGamePosition,
    turn: number
): FighterAttackAlloc[] {
    const out: FighterAttackAlloc[] = [];
    for (const obj of position.objects ?? []) {
        if (!isDeployedFighter(obj)) continue;
        const alloc = (obj as FighterObj & { attackAllocation?: FighterAttackAllocation })
            .attackAllocation;
        if (!alloc || alloc.turn !== turn) continue;
        out.push({
            groupId: obj.id,
            targetType: alloc.targetType,
            targetId: alloc.targetId,
            turn,
        });
    }
    return out;
}

/** Prefer live object state; fall back to command log. */
export function fighterAttackAllocations(
    position: FullThrustGamePosition,
    commands: FullThrustGameCommand[],
    turn: number
): FighterAttackAlloc[] {
    const fromPos = fighterAttackAllocationsFromPosition(position, turn);
    if (fromPos.length > 0) return fromPos;
    return fighterAttackAllocationsFromLog(commands, turn);
}

export function allocationsByAttacker(
    allocations: FighterAttackAlloc[]
): Map<string, FighterAttackAlloc> {
    return new Map(allocations.map((a) => [a.groupId, a]));
}

export function attackersOnTarget(
    allocations: FighterAttackAlloc[],
    targetType: FighterAttackTargetType,
    targetId: string
): FighterAttackAlloc[] {
    return allocations.filter(
        (a) => a.targetType === targetType && a.targetId === targetId
    );
}
