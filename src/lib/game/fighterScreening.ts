/** Screening vs phase 7 attack allocations — mandatory dogfight pairings. */

import type { FullThrustGamePosition } from "@/schemas/position";
import type { FighterAttackTargetType } from "./fighterAttack";
import { fighterGroupLabel } from "./fighterLabel";
import type { FighterAttackAlloc } from "./fighterEngagement";
import { attackersOnTarget } from "./fighterEngagement";
import { isDeployedFighter } from "./fighterMove";
import { gunboatDogfightSkirmishes } from "./gunboatFurball";
import type { GunboatAttackAlloc } from "./gunboatEngagement";
import type { FighterAttachment } from "./fighterAttachment";
import type { FurballEngagement, FurballGroupSide } from "./fighterDogfight";
import type { ValidationIssue } from "./commandValidation";

type FighterObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "fighters" }
>;

export interface ScreeningTarget {
    targetType: FighterAttackTargetType;
    targetId: string;
}

export interface ScreeningSituation {
    target: ScreeningTarget;
    screeners: FighterObj[];
    attackers: FighterAttackAlloc[];
}

export type SkirmishKind = "dogfight" | "screening" | "derived";

/** parentSkirmishId -> bypassTargetId -> attacker group ids */
export type BypassAssignments = Record<string, Record<string, string[]>>;

export interface FurballPairing {
    attackerId: string;
    defenderIds: string[];
}

export interface SkirmishCoverageAnalysis {
    furballAttackers: Set<string>;
    furballDefenders: Set<string>;
    engagedScreeners: Set<string>;
    shipStrikeThroughAttackers: Set<string>;
    fighterBypassAttackers: Map<string, string[]>;
    unaccountedIds: Set<string>;
}

/** Direct and chained screeners (screeners on escorted fighters count for the protected unit). */
export function screeningGroupsFor(
    position: FullThrustGamePosition,
    targetType: FighterAttackTargetType,
    targetId: string
): FighterObj[] {
    const out: FighterObj[] = [];
    const seen = new Set<string>();
    const queue: ScreeningTarget[] = [{ targetType, targetId }];

    while (queue.length > 0) {
        const t = queue.shift()!;
        for (const obj of position.objects ?? []) {
            if (!isDeployedFighter(obj)) continue;
            const id = obj.id;
            if (seen.has(id)) continue;
            const att = (obj as { fighterAttachment?: FighterAttachment }).fighterAttachment;
            if (!att || att.kind !== "screen") continue;
            if (att.targetType !== t.targetType || att.targetId !== t.targetId) continue;
            seen.add(id);
            out.push(obj as FighterObj);
            queue.push({ targetType: "fighters", targetId: id });
        }
    }
    return out;
}

function directScreeners(
    position: FullThrustGamePosition,
    target: ScreeningTarget
): FighterObj[] {
    const list: FighterObj[] = [];
    for (const obj of position.objects ?? []) {
        if (!isDeployedFighter(obj)) continue;
        const att = (obj as { fighterAttachment?: FighterAttachment }).fighterAttachment;
        if (!att || att.kind !== "screen") continue;
        if (att.targetType === target.targetType && att.targetId === target.targetId) {
            list.push(obj as FighterObj);
        }
    }
    return list;
}

/** Eligible bypass destinations for a screening skirmish, innermost first. */
export function screeningBypassTargets(
    position: FullThrustGamePosition,
    protectedTarget: ScreeningTarget
): ScreeningTarget[] {
    const out: ScreeningTarget[] = [protectedTarget];
    const seen = new Set([`${protectedTarget.targetType}:${protectedTarget.targetId}`]);

    let frontier: ScreeningTarget[] = [protectedTarget];
    while (frontier.length > 0) {
        const next: ScreeningTarget[] = [];
        for (const t of frontier) {
            for (const s of directScreeners(position, t)) {
                if (t.targetType === "fighters") {
                    const key = `fighters:${t.targetId}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        out.push({ targetType: "fighters", targetId: t.targetId });
                    }
                }
                next.push({ targetType: "fighters", targetId: s.id });
            }
        }
        frontier = next;
    }
    return out;
}

/** Collect unique escorted targets that have both screeners and phase-7 attackers. */
export function screeningEngagementPlan(
    position: FullThrustGamePosition,
    allocations: FighterAttackAlloc[]
): ScreeningSituation[] {
    const seen = new Set<string>();
    const situations: ScreeningSituation[] = [];

    for (const alloc of allocations) {
        if (alloc.targetType !== "ship" && alloc.targetType !== "fighters") continue;
        const key = `${alloc.targetType}:${alloc.targetId}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const screeners = screeningGroupsFor(position, alloc.targetType, alloc.targetId);
        const attackers = attackersOnTarget(allocations, alloc.targetType, alloc.targetId);
        if (screeners.length === 0 || attackers.length === 0) continue;

        situations.push({
            target: { targetType: alloc.targetType, targetId: alloc.targetId },
            screeners,
            attackers,
        });
    }
    return situations;
}

export function suggestedFurballsFromScreening(
    plan: ScreeningSituation[]
): FurballEngagement[] {
    const suggestions: FurballEngagement[] = [];
    for (const sit of plan) {
        const screeners = [...sit.screeners];
        const attackers = [...sit.attackers];
        let si = 0;
        for (let ai = 0; ai < attackers.length && si < screeners.length; ai++, si++) {
            suggestions.push({
                attackers: [
                    {
                        id: attackers[ai].groupId,
                        targetIds: [screeners[si].id],
                    },
                ],
                defenders: [
                    {
                        id: screeners[si].id,
                        targetIds: [attackers[ai].groupId],
                    },
                ],
            });
        }
        for (let ai = si; ai < attackers.length; ai++) {
            suggestions.push({
                attackers: [
                    {
                        id: attackers[ai].groupId,
                        targetIds: [sit.target.targetId],
                    },
                ],
                defenders: [],
            });
        }
    }
    return suggestions;
}

export function engagementTouchesSituation(
    sit: ScreeningSituation,
    engagement: FurballEngagement
): boolean {
    const sitAttackerIds = new Set(sit.attackers.map((a) => a.groupId));
    const sitScreenerIds = new Set(sit.screeners.map((s) => s.id));

    for (const a of engagement.attackers) {
        if (sitAttackerIds.has(a.id)) return true;
        for (const tid of a.targetIds) {
            if (sitScreenerIds.has(tid)) return true;
            if (tid === sit.target.targetId) return true;
        }
    }
    for (const d of engagement.defenders) {
        if (sitScreenerIds.has(d.id)) return true;
    }
    return false;
}

export function validateFurballAgainstScreening(
    plan: ScreeningSituation[],
    engagement: FurballEngagement,
    existingDeclarations: FurballEngagement[] = []
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const allDecls = [...existingDeclarations, engagement];

    for (const sit of plan) {
        if (!engagementTouchesSituation(sit, engagement)) continue;

        const sitAttackerIds = new Set(sit.attackers.map((a) => a.groupId));
        const sitScreenerIds = new Set(sit.screeners.map((s) => s.id));
        const engagedScreeners = new Set<string>();
        const engagedAttackers = new Set<string>();

        for (const decl of allDecls) {
            for (const a of decl.attackers) {
                if (!sitAttackerIds.has(a.id)) continue;
                engagedAttackers.add(a.id);
                for (const tid of a.targetIds) {
                    if (sitScreenerIds.has(tid)) engagedScreeners.add(tid);
                }
            }
        }

        for (const screener of sit.screeners) {
            if (!engagedScreeners.has(screener.id)) {
                issues.push({
                    message: `Screening group ${fighterGroupLabel(screener)} is not engaged by any attacker in this furball.`,
                    severity: "warning",
                });
            }
        }
        const unassigned = sit.attackers.filter((a) => !engagedAttackers.has(a.groupId));
        if (unassigned.length > 0 && sit.screeners.some((s) => !engagedScreeners.has(s.id))) {
            issues.push({
                message: `Attackers ${unassigned.map((a) => a.groupId).join(", ")} not assigned; each screener needs at least one attacker before striking ${sit.target.targetId}.`,
                severity: "warning",
            });
        }
    }
    return issues;
}

export function screeningModeratorHints(
    position: FullThrustGamePosition,
    allocations: FighterAttackAlloc[]
): string[] {
    const hints: string[] = [];
    const plan = screeningEngagementPlan(position, allocations);
    if (plan.length === 0) return hints;

    for (const sit of plan) {
        const screenerNames = sit.screeners.map((s) => fighterGroupLabel(s)).join(", ");
        const attackerNames = sit.attackers.map((a) => a.groupId).join(", ");
        hints.push(
            `${sit.target.targetType} ${sit.target.targetId}: screeners [${screenerNames}] — attackers [${attackerNames}]; each screener needs ≥1 attacker before direct strikes.`
        );
    }
    return hints;
}

export interface FurballSkirmish {
    id: string;
    label: string;
    hint: string;
    kind: SkirmishKind;
    attackerIds: string[];
    defenderIds: string[];
    suggested: FurballEngagement[];
    protectedTarget?: ScreeningTarget;
    parentSkirmishId?: string;
    bypassTarget?: ScreeningTarget;
}

function skirmishParticipantIds(skirmish: FurballSkirmish): Set<string> {
    return new Set([...skirmish.attackerIds, ...skirmish.defenderIds]);
}

function engagementParticipantIds(engagement: FurballEngagement): Set<string> {
    const ids = new Set<string>();
    if (!Array.isArray(engagement.attackers) || !Array.isArray(engagement.defenders)) {
        return ids;
    }
    for (const a of engagement.attackers) ids.add(a.id);
    for (const d of engagement.defenders) ids.add(d.id);
    return ids;
}

function wellFormedEngagements(
    declarations: FurballEngagement[]
): FurballEngagement[] {
    return declarations.filter(
        (decl) => Array.isArray(decl.attackers) && Array.isArray(decl.defenders)
    );
}

/** Merge furball pairings + ship strike-through into one screening engagement. */
export function buildEngagementFromPairings(
    pairings: FurballPairing[],
    shipStrikeThroughIds: string[],
    protectedTarget?: ScreeningTarget
): FurballEngagement {
    const attackerMap = new Map<string, Set<string>>();
    const defenderReturn = new Map<string, Set<string>>();

    for (const p of pairings) {
        const targets = attackerMap.get(p.attackerId) ?? new Set<string>();
        for (const did of p.defenderIds) {
            targets.add(did);
            const ret = defenderReturn.get(did) ?? new Set<string>();
            ret.add(p.attackerId);
            defenderReturn.set(did, ret);
        }
        attackerMap.set(p.attackerId, targets);
    }

    for (const aid of shipStrikeThroughIds) {
        if (!protectedTarget || protectedTarget.targetType !== "ship") continue;
        const targets = attackerMap.get(aid) ?? new Set<string>();
        targets.add(protectedTarget.targetId);
        attackerMap.set(aid, targets);
    }

    const attackers: FurballGroupSide[] = [...attackerMap.entries()].map(([id, tids]) => ({
        id,
        targetIds: [...tids],
    }));
    const defenders: FurballGroupSide[] = [...defenderReturn.entries()].map(([id, tids]) => ({
        id,
        targetIds: [...tids],
    }));

    return { attackers, defenders };
}

/** Build a standard dogfight engagement from pairings with auto return-fire. */
export function buildDogfightEngagement(pairings: FurballPairing[]): FurballEngagement {
    return buildEngagementFromPairings(pairings, [], undefined);
}

/** Skirmishes derived from phase-7 fighter allocations and screening situations. */
export function furballSkirmishes(
    position: FullThrustGamePosition,
    allocations: FighterAttackAlloc[]
): FurballSkirmish[] {
    const skirmishes: FurballSkirmish[] = [];
    const seenDogfights = new Set<string>();

    for (const alloc of allocations) {
        if (alloc.targetType !== "fighters") continue;
        const attacker = position.objects?.find((o) => o.id === alloc.groupId);
        const defender = position.objects?.find((o) => o.id === alloc.targetId);
        if (
            !attacker ||
            attacker.objType !== "fighters" ||
            !isDeployedFighter(attacker) ||
            !defender ||
            defender.objType !== "fighters" ||
            !isDeployedFighter(defender)
        ) {
            continue;
        }
        const key = `dogfight:${alloc.groupId}:${alloc.targetId}`;
        if (seenDogfights.has(key)) continue;
        seenDogfights.add(key);

        const aLabel = fighterGroupLabel(attacker as FighterObj);
        const dLabel = fighterGroupLabel(defender as FighterObj);
        skirmishes.push({
            id: key,
            kind: "dogfight",
            label: `Fighter dogfight: ${aLabel} vs ${dLabel}`,
            hint: `${alloc.groupId} declared attack on ${alloc.targetId} in phase 7`,
            attackerIds: [alloc.groupId],
            defenderIds: [alloc.targetId],
            suggested: [
                {
                    attackers: [{ id: alloc.groupId, targetIds: [alloc.targetId] }],
                    defenders: [{ id: alloc.targetId, targetIds: [alloc.groupId] }],
                },
            ],
        });
    }

    for (const sit of screeningEngagementPlan(position, allocations)) {
        const { targetType, targetId } = sit.target;
        skirmishes.push({
            id: `screen:${targetType}:${targetId}`,
            kind: "screening",
            label: `Screening ${targetType} ${targetId}`,
            hint: `Screeners protecting ${targetType} ${targetId}`,
            attackerIds: sit.attackers.map((a) => a.groupId),
            defenderIds: sit.screeners.map((s) => s.id),
            protectedTarget: { targetType, targetId },
            suggested: suggestedFurballsFromScreening([sit]),
        });
    }

    return skirmishes;
}

/** Derived dogfight skirmishes from fighter bypass assignments on screening cards. */
export function deriveStrikeThroughSkirmishes(
    position: FullThrustGamePosition,
    skirmishes: FurballSkirmish[],
    bypassAssignments: BypassAssignments
): FurballSkirmish[] {
    const derived: FurballSkirmish[] = [];

    for (const sk of skirmishes) {
        if (sk.kind !== "screening" || !sk.protectedTarget) continue;
        const assignments = bypassAssignments[sk.id];
        if (!assignments) continue;

        const bypassTargets = screeningBypassTargets(position, sk.protectedTarget);
        for (const bt of bypassTargets) {
            if (bt.targetType === "ship") continue;
            const attackerIds = assignments[bt.targetId] ?? [];
            if (attackerIds.length === 0) continue;

            const derivedId = `derived:${sk.id}:${bt.targetType}:${bt.targetId}`;
            const defender = position.objects?.find((o) => o.id === bt.targetId);
            const dLabel =
                defender && defender.objType === "fighters"
                    ? fighterGroupLabel(defender as FighterObj)
                    : bt.targetId;
            const aLabels = attackerIds
                .map((id) => {
                    const f = position.objects?.find((o) => o.id === id);
                    return f && f.objType === "fighters"
                        ? fighterGroupLabel(f as FighterObj)
                        : id;
                })
                .join(", ");

            derived.push({
                id: derivedId,
                kind: "derived",
                label: `Strike-through: ${aLabels} vs ${dLabel}`,
                hint: `Bypass to ${dLabel} from ${sk.label}`,
                attackerIds: [...attackerIds],
                defenderIds: [bt.targetId],
                protectedTarget: bt,
                parentSkirmishId: sk.id,
                bypassTarget: bt,
                suggested: [
                    {
                        attackers: attackerIds.map((id) => ({
                            id,
                            targetIds: [bt.targetId],
                        })),
                        defenders: [{ id: bt.targetId, targetIds: [...attackerIds] }],
                    },
                ],
            });
        }
    }
    return derived;
}

/** Infer fighter bypass assignments from existing declarations. */
export function inferBypassAssignmentsFromDeclarations(
    position: FullThrustGamePosition,
    skirmishes: FurballSkirmish[],
    declarations: FurballEngagement[]
): BypassAssignments {
    const out: BypassAssignments = {};

    for (const sk of skirmishes) {
        if (sk.kind !== "screening" || !sk.protectedTarget) continue;
        const bypassTargets = screeningBypassTargets(position, sk.protectedTarget).filter(
            (t) => t.targetType === "fighters"
        );

        for (const decl of declarations) {
            for (const a of decl.attackers) {
                if (!sk.attackerIds.includes(a.id)) continue;
                for (const d of decl.defenders) {
                    const match = bypassTargets.find((t) => t.targetId === d.id);
                    if (!match || !a.targetIds.includes(d.id)) continue;
                    out[sk.id] ??= {};
                    out[sk.id][d.id] ??= [];
                    if (!out[sk.id][d.id].includes(a.id)) {
                        out[sk.id][d.id].push(a.id);
                    }
                }
            }
        }
    }
    return out;
}

/** Primary skirmishes plus derived strike-through dogfights. */
export function allSkirmishCards(
    position: FullThrustGamePosition,
    allocations: FighterAttackAlloc[],
    bypassAssignments: BypassAssignments = {},
    declarations: FurballEngagement[] = [],
    gunboatAllocations: GunboatAttackAlloc[] = []
): FurballSkirmish[] {
    const primary = [
        ...furballSkirmishes(position, allocations),
        ...gunboatDogfightSkirmishes(position, gunboatAllocations),
    ];
    const inferred =
        Object.keys(bypassAssignments).length > 0
            ? bypassAssignments
            : inferBypassAssignmentsFromDeclarations(position, primary, declarations);
    const derived = deriveStrikeThroughSkirmishes(position, primary, inferred);
    return [...primary, ...derived];
}

export function declarationsForSkirmish(
    skirmish: FurballSkirmish,
    declarations: FurballEngagement[]
): FurballEngagement[] {
    const pool = skirmishParticipantIds(skirmish);
    return declarations.filter((decl) => {
        const participants = engagementParticipantIds(decl);
        for (const id of participants) {
            if (!pool.has(id)) return false;
        }
        return participants.size > 0;
    });
}

export function analyzeSkirmishCoverage(
    skirmish: FurballSkirmish,
    position: FullThrustGamePosition,
    declarations: FurballEngagement[],
    allSkirmishes?: FurballSkirmish[]
): SkirmishCoverageAnalysis {
    declarations = wellFormedEngagements(declarations);
    const furballAttackers = new Set<string>();
    const furballDefenders = new Set<string>();
    const engagedScreeners = new Set<string>();
    const shipStrikeThroughAttackers = new Set<string>();
    const fighterBypassAttackers = new Map<string, string[]>();
    const unaccountedIds = new Set<string>();

    if (skirmish.kind === "dogfight" || skirmish.kind === "derived") {
        const covered = new Set<string>();
        for (const decl of declarations) {
            for (const id of engagementParticipantIds(decl)) covered.add(id);
        }
        for (const id of skirmishParticipantIds(skirmish)) {
            if (!covered.has(id)) unaccountedIds.add(id);
        }
        return {
            furballAttackers,
            furballDefenders,
            engagedScreeners,
            shipStrikeThroughAttackers,
            fighterBypassAttackers,
            unaccountedIds,
        };
    }

    const screenerIds = new Set(skirmish.defenderIds);
    const protectedTarget = skirmish.protectedTarget;
    const bypassTargets = protectedTarget
        ? screeningBypassTargets(position, protectedTarget)
        : [];
    const fighterBypassTargetIds = new Set(
        bypassTargets.filter((t) => t.targetType === "fighters").map((t) => t.targetId)
    );

    const cards = allSkirmishes ?? [];

    for (const decl of declarations) {
        for (const a of decl.attackers) {
            if (!skirmish.attackerIds.includes(a.id)) continue;

            const screenerTargets = a.targetIds.filter((t) => screenerIds.has(t));
            if (screenerTargets.length > 0) {
                furballAttackers.add(a.id);
                for (const sid of screenerTargets) {
                    engagedScreeners.add(sid);
                    furballDefenders.add(sid);
                }
            }

            if (
                protectedTarget?.targetType === "ship" &&
                a.targetIds.length === 1 &&
                a.targetIds[0] === protectedTarget.targetId &&
                decl.defenders.every((d) => d.id !== a.id)
            ) {
                shipStrikeThroughAttackers.add(a.id);
            }
        }

        for (const a of decl.attackers) {
            if (!skirmish.attackerIds.includes(a.id)) continue;
            for (const d of decl.defenders) {
                if (!fighterBypassTargetIds.has(d.id)) continue;
                if (!a.targetIds.includes(d.id)) continue;
                const list = fighterBypassAttackers.get(d.id) ?? [];
                if (!list.includes(a.id)) list.push(a.id);
                fighterBypassAttackers.set(d.id, list);
            }
        }
    }

    for (const sid of skirmish.defenderIds) {
        if (!engagedScreeners.has(sid)) unaccountedIds.add(sid);
    }

    for (const aid of skirmish.attackerIds) {
        if (furballAttackers.has(aid)) continue;
        if (shipStrikeThroughAttackers.has(aid)) continue;
        let bypassed = false;
        for (const ids of fighterBypassAttackers.values()) {
            if (ids.includes(aid)) {
                bypassed = true;
                break;
            }
        }
        if (!bypassed) unaccountedIds.add(aid);
    }

    for (const [targetId, attackers] of fighterBypassAttackers) {
        const derivedId = `derived:${skirmish.id}:fighters:${targetId}`;
        const derived = cards.find((s) => s.id === derivedId);
        if (derived) {
            const covered = new Set<string>();
            for (const decl of declarations) {
                for (const id of engagementParticipantIds(decl)) covered.add(id);
            }
            for (const id of skirmishParticipantIds(derived)) {
                if (!covered.has(id)) unaccountedIds.add(id);
            }
        }
        void attackers;
    }

    return {
        furballAttackers,
        furballDefenders,
        engagedScreeners,
        shipStrikeThroughAttackers,
        fighterBypassAttackers,
        unaccountedIds,
    };
}

export function skirmishIdsForGroup(
    groupId: string,
    skirmishes: FurballSkirmish[]
): string[] {
    return skirmishes
        .filter(
            (s) => s.attackerIds.includes(groupId) || s.defenderIds.includes(groupId)
        )
        .map((s) => s.id);
}

/** Skirmish that fully contains every participant in the engagement, if unique. */
export function skirmishForEngagement(
    engagement: FurballEngagement,
    skirmishes: FurballSkirmish[]
): FurballSkirmish | undefined {
    const participants = engagementParticipantIds(engagement);
    if (participants.size === 0) return undefined;

    const matching = skirmishes.filter((s) => {
        const pool = skirmishParticipantIds(s);
        for (const id of participants) {
            if (!pool.has(id)) return false;
        }
        return true;
    });
    return matching.length === 1 ? matching[0] : undefined;
}

export function validateEngagementSingleSkirmish(
    engagement: FurballEngagement,
    skirmishes: FurballSkirmish[]
): ValidationIssue[] {
    const participants = [...engagementParticipantIds(engagement)];
    if (participants.length === 0 || skirmishes.length === 0) return [];

    let common: Set<string> | undefined;
    for (const id of participants) {
        const ids = new Set(skirmishIdsForGroup(id, skirmishes));
        if (ids.size === 0) {
            return [
                {
                    message: `Group ${id} is not part of any skirmish this phase.`,
                    severity: "error",
                },
            ];
        }
        if (!common) {
            common = ids;
        } else {
            common = new Set([...common].filter((x) => ids.has(x)));
        }
    }

    if (!common || common.size === 0) {
        return [
            {
                message:
                    "Engagement mixes fighter groups from different skirmishes — declare each battle separately.",
                severity: "error",
            },
        ];
    }
    return [];
}

export function isSkirmishCovered(
    skirmish: FurballSkirmish,
    declarations: FurballEngagement[],
    context?: {
        position: FullThrustGamePosition;
        allocations: FighterAttackAlloc[];
        allSkirmishes?: FurballSkirmish[];
    }
): boolean {
    if (skirmish.kind === "dogfight" || skirmish.kind === "derived") {
        const required = skirmishParticipantIds(skirmish);
        const covered = new Set<string>();
        for (const decl of declarations) {
            for (const id of engagementParticipantIds(decl)) covered.add(id);
        }
        for (const id of required) {
            if (!covered.has(id)) return false;
        }
        return true;
    }

    if (!context) {
        const required = skirmishParticipantIds(skirmish);
        const covered = new Set<string>();
        for (const decl of declarations) {
            for (const id of engagementParticipantIds(decl)) covered.add(id);
        }
        for (const id of required) {
            if (!covered.has(id)) return false;
        }
        return true;
    }

    const analysis = analyzeSkirmishCoverage(
        skirmish,
        context.position,
        declarations,
        context.allSkirmishes
    );
    return analysis.unaccountedIds.size === 0;
}

export function skirmishCoverage(
    skirmishes: FurballSkirmish[],
    declarations: FurballEngagement[],
    context?: {
        position: FullThrustGamePosition;
        allocations: FighterAttackAlloc[];
    }
): Map<string, boolean> {
    const allCards =
        context != null
            ? allSkirmishCards(context.position, context.allocations, {}, declarations)
            : skirmishes;
    const ctx = context
        ? { ...context, allSkirmishes: allCards }
        : undefined;

    const map = new Map<string, boolean>();
    for (const s of allCards) {
        map.set(s.id, isSkirmishCovered(s, declarations, ctx));
    }
    return map;
}

/** Uncovered skirmishes first, fully declared last. Parent before derived. */
export function sortSkirmishCards(
    skirmishes: FurballSkirmish[],
    declarations: FurballEngagement[],
    context?: {
        position: FullThrustGamePosition;
        allocations: FighterAttackAlloc[];
    }
): FurballSkirmish[] {
    const allCards =
        context != null
            ? allSkirmishCards(context.position, context.allocations, {}, declarations)
            : skirmishes;
    const coverage = skirmishCoverage(allCards, declarations, context);
    return [...allCards].sort((a, b) => {
        const aDone = coverage.get(a.id) ? 1 : 0;
        const bDone = coverage.get(b.id) ? 1 : 0;
        if (aDone !== bDone) return aDone - bDone;
        if (a.parentSkirmishId && !b.parentSkirmishId) return 1;
        if (!a.parentSkirmishId && b.parentSkirmishId) return -1;
        return a.label.localeCompare(b.label);
    });
}

/** Attackers committed to furball pairings on a screening skirmish (not bypass). */
export function furballAttackersForScreening(
    pairings: FurballPairing[],
    shipStrikeThroughIds: string[],
    fighterBypassByTarget: Record<string, string[]>
): Set<string> {
    const out = new Set<string>();
    for (const p of pairings) out.add(p.attackerId);
    for (const id of shipStrikeThroughIds) out.add(id);
    for (const ids of Object.values(fighterBypassByTarget)) {
        for (const id of ids) out.add(id);
    }
    return out;
}
