/** Phase 4/6 fighter movement helpers and soft validation. */

import type { FullThrustGameCommand } from "@/schemas/commands";
import type { FullThrustGamePosition } from "@/schemas/position";
import type { FoldState } from "./applyCommand";
import type { ValidationIssue } from "./commandValidation";
import { fighterGroupLabel } from "./fighterLabel";
import {
    FIGHTER_MOVE_MU,
    FIGHTER_SECONDARY_MU,
} from "./fighters";
import { fighterMoveAllowanceFromProfile } from "./fighterProfiles";
import { fighterWingFromObj } from "./fighterTypeCommand";
import { distance } from "./movement";
import {
    FIGHTER_SCREEN_RANGE_MU,
    type FighterAttachment,
    type LastAttack,
    mapPosition,
    findAttachmentTarget,
} from "./fighterAttachment";
import type { GameMeta, GamePhase } from "./types";
import { activationOrder } from "./phase";
import { commandActingPlayer } from "./moderatorStatus";

type FighterObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "fighters" }
>;

export const FIGHTER_PHASE_ORDER_COMMANDS = new Set([
    "moveFighters",
    "screenFighters",
    "pursueFighters",
]);

export function isDeployedFighter(
    obj: NonNullable<FullThrustGamePosition["objects"]>[number]
): obj is FighterObj {
    if (obj.objType !== "fighters") return false;
    const pos = obj.position;
    return !!pos && typeof pos === "object" && "x" in pos;
}

export function deployedFightersForOwner(
    position: FullThrustGamePosition,
    owner: string
): FighterObj[] {
    return (position.objects ?? []).filter(
        (o): o is FighterObj => isDeployedFighter(o) && o.owner === owner
    );
}

export type ScreenFightersTargetType = "ship" | "fighters";

export function parseScreenFightersTarget(cmd: {
    ship?: string;
    targetType?: string;
    targetId?: string;
}): { targetType: ScreenFightersTargetType; targetId: string } | undefined {
    if (cmd.targetType === "ship" || cmd.targetType === "fighters") {
        if (cmd.targetId) return { targetType: cmd.targetType, targetId: cmd.targetId };
    }
    if (cmd.ship) return { targetType: "ship", targetId: cmd.ship };
    return undefined;
}

export function fighterIsScreeningTarget(
    fighter: FighterObj,
    targetType: ScreenFightersTargetType,
    targetId: string
): boolean {
    const att = (fighter as { fighterAttachment?: FighterAttachment }).fighterAttachment;
    return att?.kind === "screen" && att.targetType === targetType && att.targetId === targetId;
}

export function hasMutualFighterScreen(
    position: FullThrustGamePosition,
    screenerId: string,
    targetFighterId: string,
    phaseCommands: FullThrustGameCommand[] = []
): boolean {
    const target = findFighter(position, targetFighterId);
    if (target && fighterIsScreeningTarget(target, "fighters", screenerId)) return true;
    for (const cmd of phaseCommands) {
        if (cmd.name !== "screenFighters") continue;
        const c = cmd as { id?: string; ship?: string; targetType?: string; targetId?: string };
        const parsed = parseScreenFightersTarget(c);
        if (
            parsed?.targetType === "fighters" &&
            c.id === targetFighterId &&
            parsed.targetId === screenerId
        ) {
            return true;
        }
    }
    return false;
}

export function screenableFriendlyFighterGroups(
    position: FullThrustGamePosition,
    screener: FighterObj,
    owner: string
): FighterObj[] {
    const from = mapPosition(screener);
    if (!from) return [];
    return deployedFightersForOwner(position, owner).filter((g) => {
        if (g.id === screener.id) return false;
        if (fighterIsScreeningTarget(g, "fighters", screener.id)) return false;
        const to = mapPosition(g);
        if (!to) return false;
        return distance(from, to) <= FIGHTER_SCREEN_RANGE_MU;
    });
}

export function fighterMoveAllowanceMu(
    fighterType: string | undefined,
    phase: GamePhase,
    wing?: { type?: string; mods?: string[] }
): number {
    const w =
        wing ??
        (fighterType !== undefined ? fighterWingFromObj({ type: fighterType }) : { type: "standard" });
    if (wing === undefined && fighterType !== undefined && !w.mods) {
        w.type = fighterType;
    }
    return fighterMoveAllowanceFromProfile(w, phase);
}

export function fighterGroupsOrderedThisPhase(
    phaseCommands: FullThrustGameCommand[]
): Set<string> {
    const ids = new Set<string>();
    for (const cmd of phaseCommands) {
        if (!FIGHTER_PHASE_ORDER_COMMANDS.has(cmd.name)) continue;
        const id = (cmd as { id?: string }).id;
        if (id) ids.add(id);
    }
    return ids;
}

export function countFighterOrdersByPlayer(
    phaseCommands: FullThrustGameCommand[],
    position: FullThrustGamePosition
): Map<string, number> {
    const counts = new Map<string, number>();
    for (const cmd of phaseCommands) {
        if (!FIGHTER_PHASE_ORDER_COMMANDS.has(cmd.name)) continue;
        const owner = commandActingPlayer(cmd, position);
        if (!owner) continue;
        counts.set(owner, (counts.get(owner) ?? 0) + 1);
    }
    return counts;
}

export function expectedFighterOrderPlayer(
    order: string[],
    orderCount: number
): string | undefined {
    if (order.length === 0) return undefined;
    return order[orderCount % order.length];
}

export function formatUndeclaredFightersByPlayer(
    position: FullThrustGamePosition,
    orderedIds: Set<string>
): string {
    const byOwner = new Map<string, string[]>();
    for (const obj of position.objects ?? []) {
        if (!isDeployedFighter(obj)) continue;
        if (orderedIds.has(obj.id)) continue;
        if (!obj.owner) continue;
        if (!byOwner.has(obj.owner)) byOwner.set(obj.owner, []);
        byOwner.get(obj.owner)!.push(fighterGroupLabel(obj));
    }
    const parts: string[] = [];
    for (const [owner, ids] of [...byOwner.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        ids.sort();
        parts.push(`${owner}: ${ids.join(", ")}`);
    }
    return parts.join("; ");
}

function findFighter(position: FullThrustGamePosition, id: string | undefined): FighterObj | undefined {
    if (!id) return undefined;
    const obj = position.objects?.find((o) => o.objType === "fighters" && o.id === id);
    return obj as FighterObj | undefined;
}

function isEnemy(
    position: FullThrustGamePosition,
    ownerA: string | undefined,
    ownerB: string | undefined
): boolean {
    return !!ownerA && !!ownerB && ownerA !== ownerB;
}

export function isFighterScreenPursuePhase(phase: GamePhase): boolean {
    return phase === 4 || phase === 6;
}

export function fighterActionCostsEndurance(phase: GamePhase): boolean {
    return phase !== 4;
}

export function validateFighterSecondaryEndurance(
    phase: GamePhase,
    endurance?: number,
    action = "a secondary move"
): ValidationIssue[] {
    if (fighterActionCostsEndurance(phase) && (endurance ?? 0) <= 0) {
        return [
            {
                message: `No endurance remaining for ${action}.`,
                severity: "warning",
            },
        ];
    }
    return [];
}

export function decrementFighterEnduranceIfSecondary(
    fighter: { endurance?: number },
    phase: GamePhase
): void {
    if (fighterActionCostsEndurance(phase)) {
        fighter.endurance = Math.max(0, (fighter.endurance ?? 6) - 1);
    }
}

export function validateMoveFightersSoft(
    from: { x: number; y: number },
    to: { x: number; y: number },
    opts: {
        phase: GamePhase;
        fighterType?: string;
        endurance?: number;
    }
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const allowance = fighterMoveAllowanceMu(opts.fighterType, opts.phase);
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
            message: `moveFighters is not typical in phase ${opts.phase}.`,
            severity: "warning",
        });
    }
    return issues;
}

export function validateFighterPhaseOrderCommon(
    fold: FoldState,
    cmd: FullThrustGameCommand,
    groupId: string | undefined
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (!groupId) {
        issues.push({ message: "Missing fighter group id.", severity: "error" });
        return issues;
    }
    const fighter = findFighter(fold.position, groupId);
    if (!fighter) {
        issues.push({ message: `Fighter group not found: ${groupId}`, severity: "error" });
        return issues;
    }
    if (!isDeployedFighter(fighter)) {
        issues.push({
            message: `${groupId} is not deployed on the map.`,
            severity: "error",
        });
        return issues;
    }
    return issues;
}

export function validateFighterDuplicateOrder(
    phaseCommands: FullThrustGameCommand[],
    groupId: string,
    cmdName: string,
    exclude?: FullThrustGameCommand
): ValidationIssue[] {
    let seen = 0;
    for (const cmd of phaseCommands) {
        if (exclude && cmd === exclude) continue;
        if (!FIGHTER_PHASE_ORDER_COMMANDS.has(cmd.name)) continue;
        if ((cmd as { id?: string }).id === groupId) seen++;
    }
    if (seen > 0) {
        return [
            {
                message: `${groupId} already has a fighter order this phase (${cmdName} is additional).`,
                severity: "warning",
            },
        ];
    }
    return [];
}

export function validateFighterOutOfTurn(
    phaseCommands: FullThrustGameCommand[],
    meta: GameMeta,
    position: FullThrustGamePosition,
    actingOwner: string | undefined
): ValidationIssue[] {
    if (!actingOwner || meta.phase !== 4) return [];
    const playerIds = position.players?.map((p) => p.id) ?? [];
    const order = activationOrder(playerIds, meta.initiative, meta.phase);
    const counts = countFighterOrdersByPlayer(phaseCommands, position);
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    const expected = expectedFighterOrderPlayer(order, total);
    if (expected && expected !== actingOwner) {
        return [
            {
                message: `Alternation expects ${expected} to act next (not ${actingOwner}).`,
                severity: "warning",
            },
        ];
    }
    return [];
}

export function validateScreenFighters(
    fold: FoldState,
    cmd: FullThrustGameCommand,
    phaseCommands: FullThrustGameCommand[] = []
): ValidationIssue[] {
    const c = cmd as {
        id?: string;
        ship?: string;
        targetType?: string;
        targetId?: string;
    };
    const issues = validateFighterPhaseOrderCommon(fold, cmd, c.id);
    if (issues.some((i) => i.severity === "error")) return issues;

    if (!isFighterScreenPursuePhase(fold.meta.phase)) {
        issues.push({
            message: `screenFighters is not typical in phase ${fold.meta.phase}.`,
            severity: "warning",
        });
    }

    const fighter = findFighter(fold.position, c.id)!;
    issues.push(...validateFighterSecondaryEndurance(fold.meta.phase, fighter.endurance));

    const target = parseScreenFightersTarget(c);
    if (!target) {
        issues.push({ message: "Missing screen target.", severity: "error" });
        return issues;
    }

    if (target.targetType === "fighters" && target.targetId === c.id) {
        issues.push({ message: "A fighter group cannot screen itself.", severity: "warning" });
        return issues;
    }

    const screenee = findAttachmentTarget(
        fold.position,
        target.targetType,
        target.targetId
    );
    if (!screenee) {
        issues.push({
            message: `${target.targetType} not found: ${target.targetId}`,
            severity: "error",
        });
        return issues;
    }

    if ((screenee as { owner?: string }).owner !== fighter.owner) {
        issues.push({
            message: `Screening requires a friendly ${target.targetType} (same owner).`,
            severity: "warning",
        });
    }

    if (target.targetType === "fighters") {
        if (!isDeployedFighter(screenee)) {
            issues.push({
                message: "Can only screen a deployed fighter group.",
                severity: "warning",
            });
        }
        if (
            hasMutualFighterScreen(
                fold.position,
                c.id!,
                target.targetId,
                phaseCommands
            )
        ) {
            issues.push({
                message: `${fighterGroupLabel(screenee as FighterObj)} is already screening this group; two groups cannot screen each other.`,
                severity: "warning",
            });
        }
    }

    const fPos = mapPosition(fighter);
    const tPos = mapPosition(screenee);
    if (fPos && tPos) {
        const dist = distance(fPos, tPos);
        if (dist > FIGHTER_SCREEN_RANGE_MU) {
            issues.push({
                message: `Screen range is ${dist.toFixed(1)} MU (typical max ${FIGHTER_SCREEN_RANGE_MU} MU).`,
                severity: "warning",
            });
        }
    }

    issues.push(...validateFighterDuplicateOrder(phaseCommands, c.id!, cmd.name, cmd));
    issues.push(
        ...validateFighterOutOfTurn(
            phaseCommands,
            fold.meta,
            fold.position,
            fighter.owner
        )
    );
    return issues;
}

export function isEligiblePursuitTarget(
    position: FullThrustGamePosition,
    fighter: FighterObj,
    targetType: "ship" | "fighters",
    targetId: string,
    lastAttack: LastAttack | undefined,
    currentTurn: number
): boolean {
    if (!lastAttack || lastAttack.turn !== currentTurn - 1) return false;
    if (lastAttack.targetType !== targetType || lastAttack.targetId !== targetId) {
        return false;
    }
    const target = findAttachmentTarget(position, targetType, targetId);
    if (!target) return false;
    if (!isEnemy(position, fighter.owner, (target as { owner?: string }).owner)) {
        return false;
    }
    if (targetType === "fighters") {
        const att = (target as { fighterAttachment?: FighterAttachment }).fighterAttachment;
        if (att?.kind !== "screen") return false;
    }
    return true;
}

export function validatePursueFighters(
    fold: FoldState,
    cmd: FullThrustGameCommand,
    phaseCommands: FullThrustGameCommand[] = []
): ValidationIssue[] {
    const c = cmd as {
        id?: string;
        targetType?: "ship" | "fighters";
        targetId?: string;
    };
    const issues = validateFighterPhaseOrderCommon(fold, cmd, c.id);
    if (issues.some((i) => i.severity === "error")) return issues;

    if (!isFighterScreenPursuePhase(fold.meta.phase)) {
        issues.push({
            message: `pursueFighters is not typical in phase ${fold.meta.phase}.`,
            severity: "warning",
        });
    }

    const fighter = findFighter(fold.position, c.id)!;
    issues.push(...validateFighterSecondaryEndurance(fold.meta.phase, fighter.endurance));
    if (!c.targetType || !c.targetId) {
        issues.push({ message: "Missing pursuit target.", severity: "error" });
        return issues;
    }
    const target = findAttachmentTarget(fold.position, c.targetType, c.targetId);
    if (!target) {
        issues.push({
            message: `Pursuit target not found: ${c.targetType} ${c.targetId}`,
            severity: "error",
        });
        return issues;
    }
    if (!isEnemy(fold.position, fighter.owner, (target as { owner?: string }).owner)) {
        issues.push({
            message: "Pursuit target must be an enemy.",
            severity: "warning",
        });
    }

    const lastAttack = (fighter as { lastAttack?: LastAttack }).lastAttack;
    if (
        !isEligiblePursuitTarget(
            fold.position,
            fighter,
            c.targetType,
            c.targetId,
            lastAttack,
            fold.meta.turn
        )
    ) {
        issues.push({
            message: `${c.id} did not attack ${c.targetType} ${c.targetId} last turn, or target is ineligible.`,
            severity: "warning",
        });
    }

    issues.push(...validateFighterDuplicateOrder(phaseCommands, c.id!, cmd.name, cmd));
    issues.push(
        ...validateFighterOutOfTurn(
            phaseCommands,
            fold.meta,
            fold.position,
            fighter.owner
        )
    );
    return issues;
}

export function validateMoveFightersCommand(
    fold: FoldState,
    cmd: FullThrustGameCommand,
    phaseCommands: FullThrustGameCommand[] = []
): ValidationIssue[] {
    const c = cmd as {
        id?: string;
        position?: { x: number; y: number };
        distanceMu?: number;
    };
    const issues = validateFighterPhaseOrderCommon(fold, cmd, c.id);
    if (issues.some((i) => i.severity === "error")) return issues;

    const fighter = findFighter(fold.position, c.id)!;
    const from = fighter.position;
    const to = c.position;
    if (
        from &&
        to &&
        typeof from === "object" &&
        "x" in from &&
        typeof to === "object" &&
        "x" in to
    ) {
        issues.push(
            ...validateMoveFightersSoft(from as { x: number; y: number }, to, {
                phase: fold.meta.phase,
                fighterType: fighter.type,
                endurance: fighter.endurance,
            })
        );
        const allowance = fighterMoveAllowanceMu(fighter.type, fold.meta.phase);
        const dist = c.distanceMu ?? distance(from as Point, to as Point);
        if (dist > allowance) {
            // validateMoveFightersSoft already warns; ensure distanceMu consistency
            void allowance;
        }
    }

    issues.push(...validateFighterDuplicateOrder(phaseCommands, c.id!, cmd.name, cmd));
    issues.push(
        ...validateFighterOutOfTurn(
            phaseCommands,
            fold.meta,
            fold.position,
            fighter.owner
        )
    );
    return issues;
}

type Point = { x: number; y: number };

export function fighterOrderModeratorHints(
    fold: FoldState,
    phaseCommands: FullThrustGameCommand[]
): string[] {
    const hints: string[] = [];
    for (const cmd of phaseCommands) {
        if (!FIGHTER_PHASE_ORDER_COMMANDS.has(cmd.name)) continue;
        let issues: ValidationIssue[] = [];
        if (cmd.name === "moveFighters") {
            issues = validateMoveFightersCommand(fold, cmd, phaseCommands);
        } else if (cmd.name === "screenFighters") {
            issues = validateScreenFighters(fold, cmd, phaseCommands);
        } else if (cmd.name === "pursueFighters") {
            issues = validatePursueFighters(fold, cmd, phaseCommands);
        }
        for (const issue of issues.filter((i) => i.severity === "warning")) {
            hints.push(`Warning: ${issue.message}`);
        }
    }
    return hints;
}
