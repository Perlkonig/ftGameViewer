/** Phase 7 fighter attack allocation (simultaneous). */

import type { FullThrustGameCommand } from "@/schemas/commands";
import type { FullThrustGamePosition } from "@/schemas/position";
import { fighterGroupLabel } from "./fighterLabel";
import { isFighterMissionConfigured } from "./fighterWing";
import { fighterWingFromObj } from "./fighterTypeCommand";
import type { FoldState } from "./applyCommand";
import type { ValidationIssue } from "./commandValidation";
import { distance, bearingArc, normalizeFacing, type ClockFacing, type Point } from "./movement";
import { isDeployedFighter } from "./fighterMove";
import type { GameMeta, GamePhase } from "./types";
import {
    homingOrdnanceWithoutTarget,
    ordnanceNeedsPhase7Allocation,
    type PendingOrdnanceAllocation,
} from "./ordnanceAllocation";

export const FIGHTER_ATTACK_RANGE_MU = 6;

export type FighterAttackTargetType = "ship" | "fighters" | "ordnance";

export interface FighterAttackAllocation {
    turn: number;
    targetType: FighterAttackTargetType;
    targetId: string;
}

type FighterObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "fighters" }
>;

function mapPosition(obj: {
    position?: unknown;
}): Point | undefined {
    const pos = obj.position;
    if (!pos || typeof pos !== "object" || !("x" in pos)) return undefined;
    return pos as Point;
}

export function bearingInFrontArc(
    from: Point,
    facing: ClockFacing,
    to: Point
): boolean {
    const arc = bearingArc(from, facing, to);
    return arc === "FWD" || arc === "FS" || arc === "FP";
}

export function findFighterAttackTarget(
    position: FullThrustGamePosition,
    targetType: FighterAttackTargetType,
    targetId: string
) {
    const obj = position.objects?.find((o) => o.id === targetId);
    if (!obj) return undefined;
    if (targetType === "ship" && obj.objType === "ship") return obj;
    if (targetType === "fighters" && obj.objType === "fighters") return obj;
    if (targetType === "ordnance" && obj.objType === "ordnance") return obj;
    return undefined;
}

export function fighterGroupsWithAttackAllocation(
    position: FullThrustGamePosition,
    turn: number
): Set<string> {
    const ids = new Set<string>();
    for (const obj of position.objects ?? []) {
        if (!isDeployedFighter(obj)) continue;
        const alloc = (obj as FighterObj & { attackAllocation?: FighterAttackAllocation })
            .attackAllocation;
        if (alloc && alloc.turn === turn) ids.add(obj.id);
    }
    return ids;
}

export function fighterGroupsDeclaredAttackThisPhase(
    phaseCommands: FullThrustGameCommand[],
    excludeCommandIndex?: number
): Set<string> {
    const ids = new Set<string>();
    phaseCommands.forEach((cmd, index) => {
        if (excludeCommandIndex !== undefined && index === excludeCommandIndex) return;
        if (cmd.name !== "declareFighterAttack") return;
        const id = (cmd as { id?: string }).id;
        if (id) ids.add(id);
    });
    return ids;
}

export function formatUndeclaredFighterAttacksByPlayer(
    position: FullThrustGamePosition,
    declared: Set<string>
): string {
    const byOwner = new Map<string, string[]>();
    for (const obj of position.objects ?? []) {
        if (!isDeployedFighter(obj)) continue;
        if (declared.has(obj.id)) continue;
        if (!obj.owner) continue;
        if (!byOwner.has(obj.owner)) byOwner.set(obj.owner, []);
        byOwner.get(obj.owner)!.push(fighterGroupLabel(obj));
    }
    return [...byOwner.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([owner, ids]) => `${owner}: ${ids.sort().join(", ")}`)
        .join("; ");
}

export function fighterAttackRangeWarnings(
    position: FullThrustGamePosition,
    groupId: string,
    targetType: FighterAttackTargetType,
    targetId: string
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const group = position.objects?.find(
        (o) => o.objType === "fighters" && o.id === groupId
    ) as FighterObj | undefined;
    if (!group || !isDeployedFighter(group)) return issues;

    const target = findFighterAttackTarget(position, targetType, targetId);
    if (!target) return issues;

    const fpos = mapPosition(group);
    const tpos = mapPosition(target);
    if (!fpos || !tpos) return issues;

    const dist = distance(fpos, tpos);
    if (dist > FIGHTER_ATTACK_RANGE_MU) {
        issues.push({
            message: `Target is ${dist.toFixed(1)} MU away (typical max ${FIGHTER_ATTACK_RANGE_MU} MU).`,
            severity: "warning",
        });
    }

    const facing = normalizeFacing(group.facing ?? 12);
    if (!bearingInFrontArc(fpos, facing, tpos)) {
        issues.push({
            message: "Target is outside the fighter group's front 180° arc.",
            severity: "warning",
        });
    }
    return issues;
}

export function validateDeclareFighterAttack(
    fold: FoldState,
    cmd: FullThrustGameCommand,
    phaseCommands: FullThrustGameCommand[] = [],
    excludeCommandIndex?: number
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const phase = fold.meta.phase as GamePhase;
    const segment = fold.meta.segment ?? "orders";

    if (phase !== 7) {
        issues.push({ message: "Fighter attack allocation is only in phase 7.", severity: "warning" });
    }
    if (segment !== "resolve") {
        issues.push({
            message: "Fighter attack allocation is in the fighter allocation step.",
            severity: "warning",
        });
    }

    const c = cmd as {
        id?: string;
        targetType?: FighterAttackTargetType;
        targetId?: string;
    };
    const group = fold.position.objects?.find(
        (o) => o.objType === "fighters" && o.id === c.id
    ) as FighterObj | undefined;

    if (!group || !isDeployedFighter(group)) {
        issues.push({ message: "Select a deployed fighter group.", severity: "warning" });
        return issues;
    }

    if (!isFighterMissionConfigured(fighterWingFromObj(group))) {
        issues.push({
            message: "Configure multiRole wing via setFighterType before allocating attacks.",
            severity: "error",
        });
        return issues;
    }

    const targetType = c.targetType;
    const targetId = c.targetId;
    if (!targetType || !targetId) {
        issues.push({ message: "Select a target.", severity: "warning" });
        return issues;
    }

    const target = findFighterAttackTarget(fold.position, targetType, targetId);
    if (!target) {
        issues.push({ message: "Target not found on the map.", severity: "warning" });
        return issues;
    }

    const fpos = mapPosition(group);
    const tpos = mapPosition(target);
    if (!fpos || !tpos) {
        issues.push({ message: "Fighter or target has no map position.", severity: "warning" });
        return issues;
    }

    issues.push(...fighterAttackRangeWarnings(fold.position, group.id, targetType, targetId));

    const declared = fighterGroupsDeclaredAttackThisPhase(phaseCommands, excludeCommandIndex);
    const allocated = fighterGroupsWithAttackAllocation(fold.position, fold.meta.turn);
    if (declared.has(group.id) || allocated.has(group.id)) {
        issues.push({
            message: `${fighterGroupLabel(group)} already has an attack allocation this turn.`,
            severity: "warning",
        });
    }

    return issues;
}

export function validateAllocateOrdnanceTarget(
    fold: FoldState,
    ordnanceId: string,
    targetShipId: string | undefined,
    action: "target" | "destroy" | "skip"
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const phase = fold.meta.phase as GamePhase;
    const segment = fold.meta.segment ?? "orders";

    if (phase !== 7) {
        issues.push({ message: "Ordnance allocation is only in phase 7.", severity: "warning" });
    }
    if (segment !== "orders") {
        issues.push({
            message: "Ordnance allocation is in the missile allocation step.",
            severity: "warning",
        });
    }

    const ord = fold.position.objects?.find(
        (o) => o.objType === "ordnance" && o.id === ordnanceId
    );
    if (!ord || ord.objType !== "ordnance") {
        issues.push({ message: "Ordnance not found.", severity: "warning" });
        return issues;
    }

    if (action === "target" && targetShipId) {
        const ship = fold.position.objects?.find(
            (o) => o.objType === "ship" && o.id === targetShipId
        );
        if (!ship || ship.objType !== "ship") {
            issues.push({ message: "Target must be a ship.", severity: "warning" });
        }
        if (ord.targetShip && ord.targetShip !== targetShipId) {
            issues.push({
                message: "Re-allocating ordnance that already has a target.",
                severity: "warning",
            });
        }
    }

    return issues;
}

export function fighterAttackModeratorHints(
    meta: GameMeta,
    position: FullThrustGamePosition,
    phaseCommands: FullThrustGameCommand[]
): string[] {
    const hints: string[] = [];
    const declared = fighterGroupsDeclaredAttackThisPhase(phaseCommands);
    const allocated = fighterGroupsWithAttackAllocation(position, meta.turn);
    const done = new Set([...declared, ...allocated]);
    const undeclared = formatUndeclaredFighterAttacksByPlayer(position, done);
    if (undeclared) {
        hints.push(`Fighter groups without attack allocation — ${undeclared}.`);
    } else {
        const count = (position.objects ?? []).filter((o) => isDeployedFighter(o)).length;
        if (count > 0) {
            hints.push("All deployed fighter groups have attack allocations.");
        }
    }

    for (const obj of position.objects ?? []) {
        if (!isDeployedFighter(obj)) continue;
        const alloc = (obj as FighterObj & { attackAllocation?: FighterAttackAllocation })
            .attackAllocation;
        if (!alloc || alloc.turn !== meta.turn) continue;
        const reach = fighterAttackRangeWarnings(
            position,
            obj.id,
            alloc.targetType,
            alloc.targetId
        );
        if (reach.length > 0 && alloc.targetType === "ordnance") {
            hints.push(
                `${fighterGroupLabel(obj)} → ordnance ${alloc.targetId}: ${reach.map((r) => r.message).join(" ")}`
            );
        }
    }
    for (const cmd of phaseCommands) {
        if (cmd.name !== "declareFighterAttack") continue;
        const c = cmd as {
            id?: string;
            targetType?: FighterAttackTargetType;
            targetId?: string;
        };
        if (!c.id || c.targetType !== "ordnance" || !c.targetId || done.has(c.id)) continue;
        const reach = fighterAttackRangeWarnings(position, c.id, "ordnance", c.targetId);
        if (reach.length > 0) {
            hints.push(
                `${c.id} → ordnance ${c.targetId}: ${reach.map((r) => r.message).join(" ")}`
            );
        }
    }
    return hints;
}

export function ordnanceAllocationModeratorHints(
    position: FullThrustGamePosition,
    pending: PendingOrdnanceAllocation[] | undefined
): string[] {
    const hints: string[] = [];
    const list = pending ?? [];
    const actionable = list.filter((p) => p.action === "target" || p.action === "destroy");
    hints.push(
        `${actionable.length} homing ordnance proposal(s) pending (${list.length} total; rockets/plasma/open-space AMT skipped).`
    );
    const unalloc = homingOrdnanceWithoutTarget(position, list);
    if (unalloc.length > 0) {
        hints.push(`Unallocated homing ordnance: ${unalloc.join(", ")}.`);
    }
    return hints;
}

export { ordnanceNeedsPhase7Allocation };
