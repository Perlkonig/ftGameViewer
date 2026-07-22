/** Gunboat engagement allocations (phase 7). */

import type { FullThrustGameCommand } from "@/schemas/commands";
import type { FullThrustGamePosition } from "@/schemas/position";
import type { GunboatAttackAllocation, GunboatAttackTargetType } from "./gunboatAttack";
import { isDeployedGunboat } from "./gunboatMove";

export interface GunboatAttackAlloc {
    groupId: string;
    targetType: GunboatAttackTargetType;
    targetId: string;
    turn: number;
}

type GunboatObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "gunboats" }
>;

export function gunboatAttackAllocationsFromLog(
    commands: FullThrustGameCommand[],
    turn: number
): GunboatAttackAlloc[] {
    const out: GunboatAttackAlloc[] = [];
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
        if (cmd.name !== "declareGunboatAttack") continue;
        if (cmdTurn !== turn || phase !== 7) continue;
        const c = cmd as { id?: string; targetType?: GunboatAttackTargetType; targetId?: string };
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

export function gunboatAttackAllocationsFromPosition(
    position: FullThrustGamePosition,
    turn: number
): GunboatAttackAlloc[] {
    const out: GunboatAttackAlloc[] = [];
    for (const obj of position.objects ?? []) {
        if (!isDeployedGunboat(obj)) continue;
        const alloc = (obj as GunboatObj & { attackAllocation?: GunboatAttackAllocation })
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

export function gunboatAttackAllocations(
    position: FullThrustGamePosition,
    commands: FullThrustGameCommand[],
    turn: number
): GunboatAttackAlloc[] {
    const fromPos = gunboatAttackAllocationsFromPosition(position, turn);
    if (fromPos.length > 0) return fromPos;
    return gunboatAttackAllocationsFromLog(commands, turn);
}
