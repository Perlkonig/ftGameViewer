/** Phase 7 gunboat attack allocation. */

import type { FullThrustGameCommand } from "@/schemas/commands";
import type { FullThrustGamePosition } from "@/schemas/position";
import { gunboatGroupLabel } from "./gunboatLabel";
import type { FoldState } from "./applyCommand";
import type { ValidationIssue } from "./commandValidation";
import { distance } from "./movement";
import { isDeployedGunboat } from "./gunboatMove";
import type { GameMeta } from "./types";

export const GUNBOAT_ATTACK_RANGE_MU = 12;

export type GunboatAttackTargetType = "ship" | "fighters" | "gunboats" | "ordnance";

export interface GunboatAttackAllocation {
    turn: number;
    targetType: GunboatAttackTargetType;
    targetId: string;
}

type GunboatObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "gunboats" }
>;

function mapPosition(obj: { position?: unknown }) {
    const pos = obj.position;
    if (!pos || typeof pos !== "object" || !("x" in pos)) return undefined;
    return pos as { x: number; y: number };
}

export function findGunboatAttackTarget(
    position: FullThrustGamePosition,
    targetType: GunboatAttackTargetType,
    targetId: string
) {
    const obj = position.objects?.find((o) => o.id === targetId);
    if (!obj) return undefined;
    if (targetType === "ship" && obj.objType === "ship") return obj;
    if (targetType === "fighters" && obj.objType === "fighters") return obj;
    if (targetType === "gunboats" && obj.objType === "gunboats") return obj;
    if (targetType === "ordnance" && obj.objType === "ordnance") return obj;
    return undefined;
}

export function gunboatAttackRangeWarnings(
    position: FullThrustGamePosition,
    groupId: string,
    targetType: GunboatAttackTargetType,
    targetId: string
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const group = position.objects?.find(
        (o) => o.objType === "gunboats" && o.id === groupId
    ) as GunboatObj | undefined;
    if (!group || !isDeployedGunboat(group)) return issues;
    const from = mapPosition(group);
    const target = findGunboatAttackTarget(position, targetType, targetId);
    if (!from || !target) return issues;
    const to = mapPosition(target);
    if (!to) return issues;
    const d = distance(from, to);
    if (d > GUNBOAT_ATTACK_RANGE_MU) {
        issues.push({
            message: `${gunboatGroupLabel(group)} is ${d.toFixed(1)} MU from target (max ${GUNBOAT_ATTACK_RANGE_MU} MU).`,
            severity: "warning",
        });
    }
    if (targetType === "ship") {
        const others = (position.objects ?? []).filter(
            (o) =>
                o.objType === "gunboats" &&
                o.id !== groupId &&
                isDeployedGunboat(o) &&
                (o as GunboatObj & { attackAllocation?: GunboatAttackAllocation }).attackAllocation
                    ?.targetId === targetId
        );
        if (others.length > 0) {
            issues.push({
                message: `Multiple gunboat squadrons targeting ship ${targetId} — entire squadron must share one ship target.`,
                severity: "warning",
            });
        }
    }
    return issues;
}

export function validateDeclareGunboatAttack(
    fold: FoldState,
    cmd: FullThrustGameCommand,
    phaseCommands: FullThrustGameCommand[] = []
): ValidationIssue[] {
    const c = cmd as {
        id?: string;
        targetType?: GunboatAttackTargetType;
        targetId?: string;
    };
    const issues: ValidationIssue[] = [];
    if (!c.id || !c.targetType || !c.targetId) {
        issues.push({ message: "Incomplete gunboat attack declaration.", severity: "error" });
        return issues;
    }
    const group = fold.position.objects?.find(
        (o) => o.objType === "gunboats" && o.id === c.id
    ) as GunboatObj | undefined;
    if (!group) {
        issues.push({ message: `Gunboat squadron not found: ${c.id}`, severity: "error" });
        return issues;
    }
    if (!isDeployedGunboat(group)) {
        issues.push({ message: `${c.id} is not deployed.`, severity: "error" });
        return issues;
    }
    if (!findGunboatAttackTarget(fold.position, c.targetType, c.targetId)) {
        issues.push({ message: "Attack target not found.", severity: "error" });
    }
    issues.push(...gunboatAttackRangeWarnings(fold.position, c.id, c.targetType, c.targetId));
    for (const pc of phaseCommands) {
        if (pc.name !== "declareGunboatAttack") continue;
        if ((pc as { id?: string }).id === c.id && pc !== cmd) {
            issues.push({
                message: `${gunboatGroupLabel(group)} already declared an attack this phase.`,
                severity: "warning",
            });
        }
    }
    return issues;
}

export function gunboatGroupsDeclaredAttackThisPhase(
    phaseCommands: FullThrustGameCommand[]
): Set<string> {
    const ids = new Set<string>();
    for (const cmd of phaseCommands) {
        if (cmd.name !== "declareGunboatAttack") continue;
        const id = (cmd as { id?: string }).id;
        if (id) ids.add(id);
    }
    return ids;
}

export function gunboatAttackModeratorHints(
    meta: GameMeta,
    position: FullThrustGamePosition,
    phaseCommands: FullThrustGameCommand[]
): string[] {
    const hints: string[] = [];
    const declared = gunboatGroupsDeclaredAttackThisPhase(phaseCommands);
    const undeclared: string[] = [];
    for (const obj of position.objects ?? []) {
        if (!isDeployedGunboat(obj)) continue;
        if (declared.has(obj.id)) continue;
        if (
            (obj as GunboatObj & { attackAllocation?: GunboatAttackAllocation }).attackAllocation
                ?.turn === meta.turn
        ) {
            continue;
        }
        undeclared.push(gunboatGroupLabel(obj));
    }
    if (undeclared.length) {
        hints.push(`Gunboat squadrons without attack allocation — ${undeclared.join(", ")}.`);
    }
    return hints;
}
