/** Phase 4/6 gunboat movement (18 MU primary, 9 MU secondary). */

import type { FullThrustGameCommand } from "@/schemas/commands";
import type { FullThrustGamePosition } from "@/schemas/position";
import type { FoldState } from "./applyCommand";
import type { ValidationIssue } from "./commandValidation";
import { gunboatGroupLabel } from "./gunboatLabel";
import { distance } from "./movement";
import type { GameMeta, GamePhase } from "./types";
import { validateFighterSecondaryEndurance } from "./fighterMove";
import { findGunboatAttachmentTarget } from "./gunboatAttachment";

export const GUNBOAT_MOVE_MU = 18;
export const GUNBOAT_SECONDARY_MU = 9;

export const GUNBOAT_PHASE_ORDER_COMMANDS = new Set(["moveGunboats"]);

export const GUNBOAT_PURSUE_NOT_ALLOWED = "Gunboats cannot pursue.";
export const GUNBOAT_SCREEN_PURSE_NOT_ALLOWED = GUNBOAT_PURSUE_NOT_ALLOWED;

type GunboatObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "gunboats" }
>;

export function isDeployedGunboat(
    obj: NonNullable<FullThrustGamePosition["objects"]>[number]
): obj is GunboatObj {
    if (obj.objType !== "gunboats") return false;
    const pos = obj.position;
    return !!pos && typeof pos === "object" && "x" in pos;
}

export function deployedGunboatsForOwner(
    position: FullThrustGamePosition,
    owner: string
): GunboatObj[] {
    return (position.objects ?? []).filter(
        (o): o is GunboatObj => isDeployedGunboat(o) && o.owner === owner
    );
}

export function gunboatMoveAllowanceMu(phase: GamePhase): number {
    return phase === 4 ? GUNBOAT_MOVE_MU : GUNBOAT_SECONDARY_MU;
}

export function decrementGunboatEnduranceIfSecondary(
    gunboat: { endurance?: number },
    phase: GamePhase
): void {
    if (fighterActionCostsEndurance(phase)) {
        gunboat.endurance = Math.max(0, (gunboat.endurance ?? 6) - 1);
    }
}

export function validateMoveGunboatsSoft(
    from: { x: number; y: number },
    to: { x: number; y: number },
    opts: { phase: GamePhase; endurance?: number }
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const allowance = gunboatMoveAllowanceMu(opts.phase);
    const dist = distance(from, to);
    if (dist > allowance) {
        issues.push({
            message: `Move is ${dist.toFixed(1)} MU (allowance ${allowance} MU).`,
            severity: "warning",
        });
    }
    issues.push(...validateFighterSecondaryEndurance(opts.phase, opts.endurance));
    if (opts.phase !== 4 && opts.phase !== 6) {
        issues.push({
            message: `moveGunboats is not typical in phase ${opts.phase}.`,
            severity: "warning",
        });
    }
    return issues;
}

function findGunboat(position: FullThrustGamePosition, id: string | undefined): GunboatObj | undefined {
    if (!id) return undefined;
    const obj = position.objects?.find((o) => o.objType === "gunboats" && o.id === id);
    return obj as GunboatObj | undefined;
}

export function validateMoveGunboatsCommand(
    fold: FoldState,
    cmd: FullThrustGameCommand
): ValidationIssue[] {
    const c = cmd as { id?: string; position?: unknown };
    const issues: ValidationIssue[] = [];
    if (!c.id) {
        issues.push({ message: "Missing gunboat squadron id.", severity: "error" });
        return issues;
    }
    const obj = findGunboat(fold.position, c.id);
    if (!obj) {
        issues.push({ message: `Gunboat squadron not found: ${c.id}`, severity: "error" });
        return issues;
    }
    if (!isDeployedGunboat(obj) && c.position && typeof c.position === "object" && "x" in c.position) {
        return issues;
    }
    const oldPos = obj.position;
    const newPos = c.position;
    if (
        isDeployedGunboat(obj) &&
        oldPos &&
        typeof oldPos === "object" &&
        "x" in oldPos &&
        newPos &&
        typeof newPos === "object" &&
        "x" in newPos
    ) {
        issues.push(
            ...validateMoveGunboatsSoft(oldPos, newPos, {
                phase: fold.meta.phase,
                endurance: obj.endurance,
            })
        );
    }
    return issues;
}

export function validateScreenGunboats(
    fold: FoldState,
    cmd: FullThrustGameCommand
): ValidationIssue[] {
    const c = cmd as {
        id?: string;
        targetType?: "ship" | "fighters" | "gunboats";
        targetId?: string;
    };
    const issues: ValidationIssue[] = [];
    if (!c.id) {
        issues.push({ message: "Missing gunboat squadron id.", severity: "error" });
        return issues;
    }
    const obj = findGunboat(fold.position, c.id);
    if (!obj || !isDeployedGunboat(obj)) {
        issues.push({ message: "Select a deployed gunboat squadron.", severity: "error" });
        return issues;
    }
    if (fold.meta.phase !== 4 && fold.meta.phase !== 6) {
        issues.push({
            message: `screenGunboats is not typical in phase ${fold.meta.phase}.`,
            severity: "warning",
        });
    }
    issues.push(...validateFighterSecondaryEndurance(fold.meta.phase, obj.endurance));
    if (!c.targetType || !c.targetId) {
        issues.push({ message: "Missing screen target.", severity: "error" });
        return issues;
    }
    const target = findGunboatAttachmentTarget(fold.position, c.targetType, c.targetId);
    if (!target) {
        issues.push({
            message: `${c.targetType} not found: ${c.targetId}`,
            severity: "error",
        });
        return issues;
    }
    if ((target as { owner?: string }).owner !== obj.owner) {
        issues.push({
            message: "Screening requires a friendly target (same owner).",
            severity: "warning",
        });
    }
    return issues;
}

export function validatePursueGunboats(
    fold: FoldState,
    cmd: FullThrustGameCommand,
    phaseCommands: FullThrustGameCommand[] = []
): ValidationIssue[] {
    void fold;
    void cmd;
    void phaseCommands;
    return [{ message: GUNBOAT_PURSUE_NOT_ALLOWED, severity: "error" }];
}

export function formatUndeclaredGunboatsByPlayer(
    position: FullThrustGamePosition,
    orderedIds: Set<string>
): string {
    const byOwner = new Map<string, string[]>();
    for (const obj of position.objects ?? []) {
        if (!isDeployedGunboat(obj)) continue;
        if (orderedIds.has(obj.id)) continue;
        if (!obj.owner) continue;
        if (!byOwner.has(obj.owner)) byOwner.set(obj.owner, []);
        byOwner.get(obj.owner)!.push(gunboatGroupLabel(obj));
    }
    return [...byOwner.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([owner, ids]) => `${owner}: ${ids.sort().join(", ")}`)
        .join("; ");
}
