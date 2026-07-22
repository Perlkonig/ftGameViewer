/** Phase 8 orchestration: auto ordnance intercept, furball declarations, batch resolve. */

import type { FullThrustGameCommand } from "@/schemas/commands";
import type { FullThrustGamePosition } from "@/schemas/position";
import type { RollSource } from "./dice";
import { arrayRollSource } from "./dice";
import type { FighterAttackAlloc } from "./fighterEngagement";
import { fighterAttackAllocations } from "./fighterEngagement";
import {
    applyFurballToPosition,
    resolveFurballEngagement,
    type FurballEngagement,
    type FurballResolution,
} from "./fighterDogfight";
import { fighterCanIntercept, isFighterExhausted } from "./fighterEndurance";
import { fighterGroupLabel } from "./fighterLabel";
import { resolveFighterIntercept } from "./fighterIntercept";
import { isDeployedFighter } from "./fighterMove";
import {
    screeningEngagementPlan,
    validateFurballAgainstScreening,
    furballSkirmishes,
    allSkirmishCards,
    validateEngagementSingleSkirmish,
    skirmishForEngagement,
    screeningBypassTargets,
} from "./fighterScreening";
import { isSalvoOrdnanceType, salvoMissileCount } from "./salvoOrdnance";
import type { ValidationIssue } from "./commandValidation";
import { mutuallyEngagedFighterIds } from "./incomingThreats";
import {
    gunboatAttackAllocations,
    type GunboatAttackAlloc,
} from "./gunboatEngagement";
import { gunboatOrdnanceInterceptAllocations } from "./gunboatFurball";
import { furballParticipantLabel, isFurballParticipant } from "./gunboatFurball";
import {
    applyInterceptToGunboat,
    gunboatCanIntercept,
    validateGunboatInterceptOrdnance,
} from "./gunboatIntercept";
import { isDeployedGunboat } from "./gunboatMove";

type FighterObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "fighters" }
>;

type OrdnanceObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "ordnance" }
>;

export function ordnanceInterceptAllocations(
    allocations: FighterAttackAlloc[]
): FighterAttackAlloc[] {
    return allocations.filter((a) => a.targetType === "ordnance");
}

function findFighter(position: FullThrustGamePosition, id: string): FighterObj | undefined {
    const obj = position.objects?.find((o) => o.id === id);
    return obj?.objType === "fighters" ? (obj as FighterObj) : undefined;
}

function findOrdnance(position: FullThrustGamePosition, id: string): OrdnanceObj | undefined {
    const obj = position.objects?.find((o) => o.id === id);
    return obj?.objType === "ordnance" ? (obj as OrdnanceObj) : undefined;
}

function ordnanceInterceptable(ord: OrdnanceObj): boolean {
    if (isSalvoOrdnanceType(ord.type) && (salvoMissileCount(ord) ?? 0) <= 0) return false;
    return true;
}

export interface AutoInterceptResult {
    commands: FullThrustGameCommand[];
    warnings: string[];
}

/** Build replay commands for phase-7 ordnance attack allocations (does not mutate position). */
export function buildAutoInterceptCommands(
    position: FullThrustGamePosition,
    allocations: FighterAttackAlloc[],
    source: RollSource
): AutoInterceptResult {
    const commands: FullThrustGameCommand[] = [];
    const warnings: string[] = [];
    const sorted = [...ordnanceInterceptAllocations(allocations)].sort((a, b) =>
        a.groupId.localeCompare(b.groupId)
    );

    for (const alloc of sorted) {
        const fighter = findFighter(position, alloc.groupId);
        if (!fighter || !isDeployedFighter(fighter)) {
            warnings.push(`${alloc.groupId}: not deployed — skip ordnance intercept.`);
            continue;
        }
        if (!fighterCanIntercept(fighter)) {
            warnings.push(`${alloc.groupId}: cannot intercept — skip.`);
            continue;
        }
        const ord = findOrdnance(position, alloc.targetId);
        if (!ord || !ordnanceInterceptable(ord)) {
            warnings.push(
                `${alloc.groupId} → ${alloc.targetId}: ordnance missing or depleted — skip.`
            );
            continue;
        }

        const mark = source.mark();
        const count = fighter.number ?? 6;
        const result = resolveFighterIntercept(count, ord.type, ord, source);
        const rolls = source.consumedSince(mark);
        const note = result.notes.join("; ");

        commands.push({
            name: "logDice",
            purpose: `intercept ${alloc.groupId} vs ${alloc.targetId}`,
            rolls,
            source: "client",
            result: note,
        } as FullThrustGameCommand);
        commands.push({
            name: "interceptOrdnance",
            id: alloc.groupId,
            ordnanceId: alloc.targetId,
            rolls,
        } as FullThrustGameCommand);
        if (note) {
            commands.push({
                name: "_custom",
                msg: `Intercept: ${alloc.groupId} vs ${alloc.targetId} — ${note}`,
            } as FullThrustGameCommand);
        }
    }

    return { commands, warnings };
}

export function buildAutoGunboatInterceptCommands(
    position: FullThrustGamePosition,
    allocations: GunboatAttackAlloc[],
    source: RollSource
): AutoInterceptResult {
    const commands: FullThrustGameCommand[] = [];
    const warnings: string[] = [];
    const sorted = [...gunboatOrdnanceInterceptAllocations(allocations)].sort((a, b) =>
        a.groupId.localeCompare(b.groupId)
    );

    for (const alloc of sorted) {
        const gunboat = position.objects?.find(
            (o) => o.objType === "gunboats" && o.id === alloc.groupId
        ) as GunboatObj | undefined;
        if (!gunboat || !isDeployedGunboat(gunboat)) {
            warnings.push(`${alloc.groupId}: not deployed — skip ordnance intercept.`);
            continue;
        }
        if (!gunboatCanIntercept(gunboat)) {
            warnings.push(`${alloc.groupId}: cannot intercept — skip.`);
            continue;
        }
        const ord = findOrdnance(position, alloc.targetId);
        if (!ord || !ordnanceInterceptable(ord)) {
            warnings.push(
                `${alloc.groupId} → ${alloc.targetId}: ordnance missing or depleted — skip.`
            );
            continue;
        }

        const mark = source.mark();
        const count = gunboat.number ?? 6;
        const result = resolveFighterIntercept(count, ord.type, ord, source);
        const rolls = source.consumedSince(mark);
        const note = result.notes.join("; ");

        commands.push({
            name: "logDice",
            purpose: `intercept ${alloc.groupId} vs ${alloc.targetId}`,
            rolls,
            source: "client",
            result: note,
        } as FullThrustGameCommand);
        commands.push({
            name: "interceptOrdnance",
            id: alloc.groupId,
            ordnanceId: alloc.targetId,
            rolls,
        } as FullThrustGameCommand);
        if (note) {
            commands.push({
                name: "_custom",
                msg: `Intercept: ${alloc.groupId} vs ${alloc.targetId} — ${note}`,
            } as FullThrustGameCommand);
        }
    }

    return { commands, warnings };
}

type GunboatObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "gunboats" }
>;

export function phase8GunboatAllocations(
    position: FullThrustGamePosition,
    commands: FullThrustGameCommand[],
    turn: number
): GunboatAttackAlloc[] {
    return gunboatAttackAllocations(position, commands, turn);
}

export function furballWorkNeeded(
    position: FullThrustGamePosition,
    allocations: FighterAttackAlloc[],
    gunboatAllocations: GunboatAttackAlloc[] = []
): boolean {
    if (allocations.some((a) => a.targetType === "fighters")) return true;
    if (
        gunboatAllocations.some(
            (a) => a.targetType === "fighters" || a.targetType === "gunboats"
        )
    ) {
        return true;
    }
    return screeningEngagementPlan(position, allocations).length > 0;
}

export function requiredFurballGroupIds(
    position: FullThrustGamePosition,
    allocations: FighterAttackAlloc[]
): Set<string> {
    const required = new Set<string>();
    for (const a of allocations) {
        if (a.targetType !== "fighters") continue;
        const attacker = findFighter(position, a.groupId);
        if (attacker && isDeployedFighter(attacker)) required.add(a.groupId);
        const target = findFighter(position, a.targetId);
        if (target && isDeployedFighter(target)) required.add(a.targetId);
    }
    for (const sit of screeningEngagementPlan(position, allocations)) {
        for (const s of sit.screeners) {
            if (isDeployedFighter(s)) required.add(s.id);
        }
    }
    return required;
}


export function participantIdsInEngagements(engagements: FurballEngagement[]): Set<string> {
    const ids = new Set<string>();
    for (const eng of engagements) {
        for (const a of eng.attackers) ids.add(a.id);
        for (const d of eng.defenders) ids.add(d.id);
    }
    return ids;
}

export function declaredFurballsFromCommands(
    commands: FullThrustGameCommand[],
    turn: number,
    phase = 8
): FurballEngagement[] {
    const out: FurballEngagement[] = [];
    let cmdTurn = 1;
    let cmdPhase = 1;
    for (const cmd of commands) {
        if (cmd.name === "advancePhase") {
            const p = (cmd as { phase?: number }).phase;
            if (typeof p === "number") {
                cmdPhase = p;
                if (cmdPhase === 1) cmdTurn += 1;
            }
        }
        if (cmd.name !== "declareFurball") continue;
        if (cmdTurn !== turn || cmdPhase !== phase) continue;
        const eng = (cmd as { engagement?: FurballEngagement }).engagement;
        if (eng) out.push(eng);
    }
    return out;
}

/** True when resolvePhase8Furballs was recorded for this turn in the applied command log. */
export function phase8FurballsResolvedInLog(
    commands: FullThrustGameCommand[],
    turn: number
): boolean {
    let cmdTurn = 1;
    let cmdPhase = 1;
    for (const cmd of commands) {
        if (cmd.name === "advancePhase") {
            const p = (cmd as { phase?: number }).phase;
            if (typeof p === "number") {
                cmdPhase = p;
                if (cmdPhase === 1) cmdTurn += 1;
            }
        }
        if (cmd.name === "resolvePhase8Furballs" && cmdTurn === turn && cmdPhase === 8) {
            return true;
        }
    }
    return false;
}

/**
 * Declarations for resolve UI: fold state while orders are open; command log when
 * fold was cleared (e.g. replay head before resolve); empty once resolve is logged.
 */
export function effectivePhase8FurballDeclarations(
    foldDeclarations: FurballEngagement[] | undefined,
    commands: FullThrustGameCommand[],
    turn: number
): FurballEngagement[] {
    if (foldDeclarations && foldDeclarations.length > 0) return foldDeclarations;
    if (phase8FurballsResolvedInLog(commands, turn)) return [];
    return declaredFurballsFromCommands(commands, turn);
}

export function uncoveredFurballGroups(
    position: FullThrustGamePosition,
    allocations: FighterAttackAlloc[],
    declarations: FurballEngagement[],
    gunboatAllocations: GunboatAttackAlloc[] = []
): string[] {
    const allCards = allSkirmishCards(
        position,
        allocations,
        {},
        declarations,
        gunboatAllocations
    );
    const covered = participantIdsInEngagements(declarations);
    const missing = new Set<string>();

    for (const sit of screeningEngagementPlan(position, allocations)) {
        for (const a of sit.attackers) {
            const f = findFighter(position, a.groupId);
            if (f && isDeployedFighter(f) && !covered.has(a.groupId)) {
                missing.add(a.groupId);
            }
        }
    }

    for (const s of allCards) {
        if (s.kind === "dogfight" || s.kind === "derived") {
            for (const id of [...s.attackerIds, ...s.defenderIds]) {
                if (!covered.has(id)) missing.add(id);
            }
        }
    }

    for (const sit of screeningEngagementPlan(position, allocations)) {
        for (const s of sit.screeners) {
            if (isDeployedFighter(s) && !covered.has(s.id)) missing.add(s.id);
        }
    }

    return [...missing].sort();
}

/** Section 8.9: one-way interceptor vs ship-attack-run attacker (may defer to phase 10). */
export function isAttackRunInterceptPair(
    interceptorAlloc: FighterAttackAlloc,
    allocations: FighterAttackAlloc[],
    position: FullThrustGamePosition
): boolean {
    if (interceptorAlloc.targetType !== "fighters") return false;
    const attackerId = interceptorAlloc.targetId;
    const attackerAlloc = allocations.find((a) => a.groupId === attackerId);
    if (!attackerAlloc || attackerAlloc.targetType !== "ship") return false;
    const interceptor = findFighter(position, interceptorAlloc.groupId);
    if (!interceptor || !isDeployedFighter(interceptor)) return false;
    const attachment = (interceptor as { fighterAttachment?: { kind?: string } })
        .fighterAttachment;
    if (attachment?.kind === "screen") return false;
    return true;
}

/** Fighter groups that may resolve in phase 10 attack-run intercept instead of phase 8 furball. */
export function attackRunInterceptDeferredGroupIds(
    position: FullThrustGamePosition,
    allocations: FighterAttackAlloc[]
): Set<string> {
    const mutual = mutuallyEngagedFighterIds(position, allocations);
    const ids = new Set<string>();
    for (const alloc of allocations) {
        if (!isAttackRunInterceptPair(alloc, allocations, position)) continue;
        if (mutual.has(alloc.groupId) || mutual.has(alloc.targetId)) continue;
        ids.add(alloc.groupId);
        ids.add(alloc.targetId);
    }
    return ids;
}

function validateStrikeThroughRules(
    position: FullThrustGamePosition,
    engagement: FurballEngagement,
    allocations: FighterAttackAlloc[],
    existingDeclarations: FurballEngagement[]
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const skirmishes = furballSkirmishes(position, allocations);
    const allDecl = [...existingDeclarations, engagement];

    for (const sk of skirmishes) {
        if (sk.kind !== "screening" || !sk.protectedTarget) continue;
        const screenerIds = new Set(sk.defenderIds);
        const bypassTargets = screeningBypassTargets(position, sk.protectedTarget);
        const fighterBypassIds = new Set(
            bypassTargets.filter((t) => t.targetType === "fighters").map((t) => t.targetId)
        );

        for (const a of engagement.attackers) {
            if (!sk.attackerIds.includes(a.id)) continue;

            const targetsScreener = a.targetIds.some((t) => screenerIds.has(t));
            const targetsShip =
                sk.protectedTarget.targetType === "ship" &&
                a.targetIds.length === 1 &&
                a.targetIds[0] === sk.protectedTarget.targetId;
            const targetsFighterBypass = a.targetIds.some((t) => fighterBypassIds.has(t));

            if (
                targetsFighterBypass &&
                engagement.defenders.length === 0 &&
                !targetsScreener
            ) {
                issues.push({
                    message: `Attacker ${a.id} bypassing a fighter wing must be declared in a dogfight engagement with that wing as defender.`,
                    severity: "error",
                });
            }

            if (targetsShip && targetsScreener) {
                issues.push({
                    message: `Attacker ${a.id} cannot both furball screeners and ship strike-through in one side entry.`,
                    severity: "error",
                });
            }
        }
    }

    for (const sk of skirmishes) {
        if (sk.kind !== "screening" || !sk.protectedTarget) continue;
        const engagedScreeners = new Set<string>();
        for (const decl of allDecl) {
            for (const a of decl.attackers) {
                if (!sk.attackerIds.includes(a.id)) continue;
                for (const tid of a.targetIds) {
                    if (sk.defenderIds.includes(tid)) engagedScreeners.add(tid);
                }
            }
        }
        for (const a of engagement.attackers) {
            if (!sk.attackerIds.includes(a.id)) continue;
            const isBypass =
                (sk.protectedTarget.targetType === "ship" &&
                    a.targetIds.length === 1 &&
                    a.targetIds[0] === sk.protectedTarget.targetId) ||
                a.targetIds.some((t) =>
                    screeningBypassTargets(position, sk.protectedTarget!)
                        .filter((bt) => bt.targetType === "fighters")
                        .some((bt) => bt.targetId === t)
                );
            if (!isBypass) continue;
            for (const sid of sk.defenderIds) {
                if (!engagedScreeners.has(sid)) {
                    issues.push({
                        message: `Cannot bypass until screener ${sid} is engaged by a furball attacker.`,
                        severity: "error",
                    });
                }
            }
        }
    }

    return issues;
}

export function validateDeclareFurball(
    position: FullThrustGamePosition,
    engagement: FurballEngagement,
    existingDeclarations: FurballEngagement[],
    allocations: FighterAttackAlloc[],
    gunboatAllocations: GunboatAttackAlloc[] = []
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const ids = participantIdsInEngagements([engagement]);
    if (ids.size === 0) {
        issues.push({ message: "Select at least one squadron.", severity: "error" });
        return issues;
    }
    for (const side of [...engagement.attackers, ...engagement.defenders]) {
        if (side.targetIds.length === 0) {
            issues.push({
                message: `Group ${side.id} needs at least one target.`,
                severity: "error",
            });
        }
        if (!isFurballParticipant(position, side.id)) {
            issues.push({
                message: `Group ${side.id} is not deployed.`,
                severity: "error",
            });
        }
    }
    for (const prior of existingDeclarations) {
        for (const id of participantIdsInEngagements([prior])) {
            if (ids.has(id)) {
                issues.push({
                    message: `Group ${id} is already in another furball declaration.`,
                    severity: "error",
                });
            }
        }
    }
    const plan = screeningEngagementPlan(position, allocations);
    issues.push(...validateFurballAgainstScreening(plan, engagement, existingDeclarations));
    issues.push(
        ...validateStrikeThroughRules(position, engagement, allocations, existingDeclarations)
    );
    const allCards = allSkirmishCards(
        position,
        allocations,
        {},
        [...existingDeclarations, engagement],
        gunboatAllocations
    );
    issues.push(...validateEngagementSingleSkirmish(engagement, allCards));
    return issues;
}

export function validateResolvePhase8Furballs(
    position: FullThrustGamePosition,
    allocations: FighterAttackAlloc[],
    declarations: FurballEngagement[],
    gunboatAllocations: GunboatAttackAlloc[] = []
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (declarations.length === 0) {
        issues.push({
            message: "No furball declarations to resolve.",
            severity: "error",
        });
    }
    const uncovered = uncoveredFurballGroups(
        position,
        allocations,
        declarations,
        gunboatAllocations
    );
    const deferred = attackRunInterceptDeferredGroupIds(position, allocations);
    const hardUncovered = uncovered.filter((id) => !deferred.has(id));
    const softUncovered = uncovered.filter((id) => deferred.has(id));
    if (hardUncovered.length > 0) {
        issues.push({
            message: `Furball declarations missing groups: ${hardUncovered.join(", ")}.`,
            severity: "error",
        });
    }
    if (softUncovered.length > 0) {
        issues.push({
            message: `Groups ${softUncovered.join(", ")} may resolve in Phase 8 furball or defer to Phase 10 attack-run intercept.`,
            severity: "warning",
        });
    }
    return issues;
}

export interface Phase8EngagementSummary {
    engagement: FurballEngagement;
    notes: string;
    summary: string;
}

export interface Phase8FurballBatchResult {
    rolls: number[];
    notes: string;
    summaries: Phase8EngagementSummary[];
}

function labeledFurballSideNotes(
    position: FullThrustGamePosition,
    resolution: FurballResolution
): string {
    return resolution.sideRolls
        .map((sr) => {
            const label = furballParticipantLabel(position, sr.groupId);
            const obj = position.objects?.find((o) => o.id === sr.groupId);
            const exhausted =
                obj?.objType === "fighters"
                    ? isFighterExhausted(obj as FighterObj)
                    : ((obj as { endurance?: number } | undefined)?.endurance ?? 6) <= 0;
            const kills = [...sr.killsByTarget.values()].reduce((a, b) => a + b, 0);
            return `${label}: ${sr.diceUsed} dice${exhausted ? " (exhausted)" : ""} → ${kills} kills`;
        })
        .join("; ");
}

function formatEngagementSummary(
    preLabels: Map<string, string>,
    engagement: FurballEngagement,
    resolution: FurballResolution,
    preNumbers: Map<string, number>,
    sideNotes: string
): string {
    const label = (id: string) => preLabels.get(id) ?? id;
    const a = engagement.attackers.map((x) => label(x.id)).join(", ");
    const d = engagement.defenders.map((x) => label(x.id)).join(", ") || "—";
    const parts = [a, "vs", d];
    if (sideNotes) parts.push(sideNotes);

    const participantIds = new Set<string>();
    for (const side of [...engagement.attackers, ...engagement.defenders]) {
        participantIds.add(side.id);
    }
    const casualties: string[] = [];
    for (const id of participantIds) {
        const kills = resolution.incomingKills.get(id) ?? 0;
        if (kills <= 0) continue;
        const before = preNumbers.get(id) ?? 0;
        const after = Math.max(0, before - kills);
        const name = label(id);
        casualties.push(
            after === 0 ? `${name} −${kills} (destroyed)` : `${name} −${kills} (${before}→${after})`
        );
    }
    if (casualties.length) parts.push(`casualties: ${casualties.join("; ")}`);
    return parts.join(" · ");
}

function declarationSortKey(
    engagement: FurballEngagement,
    position: FullThrustGamePosition,
    allocations: FighterAttackAlloc[],
    gunboatAllocations: GunboatAttackAlloc[] = []
): number {
    const allCards = allSkirmishCards(
        position,
        allocations,
        {},
        [],
        gunboatAllocations
    );
    const sk = skirmishForEngagement(engagement, allCards);
    if (!sk) return 1;
    if (sk.kind === "screening") return 0;
    if (sk.kind === "derived") return 2;
    return 1;
}

/**
 * Phase 8 uses a single orders→resolve segment pair per turn. Strike-through derived
 * dogfights are declared in the same orders segment as their parent screening skirmish
 * (not a post-resolve wave). Survivor-dependent strikes without upfront bypass are future work.
 */
export function applyPhase8FurballBatch(
    position: FullThrustGamePosition,
    declarations: FurballEngagement[],
    source: RollSource,
    allocations: FighterAttackAlloc[] = [],
    gunboatAllocations: GunboatAttackAlloc[] = []
): Phase8FurballBatchResult {
    const sorted = [...declarations].sort(
        (a, b) =>
            declarationSortKey(a, position, allocations, gunboatAllocations) -
            declarationSortKey(b, position, allocations, gunboatAllocations)
    );
    const allRolls: number[] = [];
    const summaries: Phase8EngagementSummary[] = [];

    for (const engagement of sorted) {
        const participantIds = new Set<string>();
        for (const side of [...engagement.attackers, ...engagement.defenders]) {
            participantIds.add(side.id);
        }
        const preNumbers = new Map<string, number>();
        const preLabels = new Map<string, string>();
        for (const id of participantIds) {
            const f = findFighter(position, id);
            if (f) {
                preNumbers.set(id, f.number ?? 6);
                preLabels.set(id, fighterGroupLabel(f));
                continue;
            }
            const gb = position.objects?.find(
                (o) => o.objType === "gunboats" && o.id === id
            ) as GunboatObj | undefined;
            if (gb && isDeployedGunboat(gb)) {
                preNumbers.set(id, gb.number ?? 6);
                preLabels.set(id, furballParticipantLabel(position, id));
            }
        }

        const mark = source.mark();
        const resolution = resolveFurballEngagement(position, engagement, source);
        allRolls.push(...source.consumedSince(mark));
        const notes = labeledFurballSideNotes(position, resolution);
        const summary = formatEngagementSummary(
            preLabels,
            engagement,
            resolution,
            preNumbers,
            notes
        );
        applyFurballToPosition(position, engagement, resolution);
        summaries.push({
            engagement,
            notes,
            summary,
        });
    }

    return {
        rolls: allRolls,
        notes: summaries.map((s) => s.summary).join(" | "),
        summaries,
    };
}

/** Replay log entries for a phase-8 furball batch (logDice, resolve, per-engagement narrative). */
export function buildPhase8FurballResolveCommands(
    result: Phase8FurballBatchResult,
    declarationsCount: number,
    diceSource: "client" | "moderatorSequence" = "client"
): FullThrustGameCommand[] {
    const commands: FullThrustGameCommand[] = [];
    if (result.rolls.length > 0) {
        commands.push({
            name: "logDice",
            purpose: "resolvePhase8Furballs",
            rolls: result.rolls,
            source: diceSource,
            result: result.notes,
        } as FullThrustGameCommand);
    }
    commands.push({
        name: "resolvePhase8Furballs",
        rolls: result.rolls,
        notes: result.notes,
        count: declarationsCount,
    } as FullThrustGameCommand);
    for (const s of result.summaries) {
        commands.push({
            name: "_custom",
            msg: `Furball: ${s.summary}`,
        } as FullThrustGameCommand);
    }
    return commands;
}

export function applyPhase8FurballBatchFromRolls(
    position: FullThrustGamePosition,
    declarations: FurballEngagement[],
    rolls: number[],
    allocations: FighterAttackAlloc[] = [],
    gunboatAllocations: GunboatAttackAlloc[] = []
): Phase8FurballBatchResult {
    return applyPhase8FurballBatch(
        position,
        declarations,
        arrayRollSource(rolls),
        allocations,
        gunboatAllocations
    );
}

/** Collect allocations for auto-intercept when entering phase 8. */
export function allocationsForPhase8Entry(
    position: FullThrustGamePosition,
    commands: FullThrustGameCommand[],
    turn: number
): FighterAttackAlloc[] {
    return fighterAttackAllocations(position, commands, turn);
}
