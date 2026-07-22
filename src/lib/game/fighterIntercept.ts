/** Fighter interception of ordnance — rules 8.12 + defense table. */

import type { FullThrustGamePosition } from "@/schemas/position";
import { bearingInFrontArc, FIGHTER_ATTACK_RANGE_MU } from "./fighterAttack";
import { distance, normalizeFacing, type Point } from "./movement";
import type { RollSource } from "./dice";
import { resolvePdsDie } from "./combat";
import {
    fighterCanIntercept,
    isFighterExhausted,
    nextEnduranceAfterCombat,
} from "./fighterEndurance";
import { isDeployedFighter } from "./fighterMove";
import type { ValidationIssue } from "./commandValidation";

type FighterObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "fighters" }
>;

type OrdnanceObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "ordnance" }
>;

import {
    applySalvoMissileKills,
    DEFAULT_SALVO_MISSILE_COUNT,
    isSalvoOrdnanceType,
    salvoMissileCount,
} from "./salvoOrdnance";

const INTERCEPT_TYPES = new Set([
    "salvo",
    "salvoER",
    "salvoMS",
    "missile",
    "rocket",
    "amt",
    "plasmaBolt",
]);

export function isInterceptableOrdnanceType(type: string | undefined): boolean {
    return !!type && INTERCEPT_TYPES.has(type);
}

function mapPosition(obj: { position?: unknown }): Point | undefined {
    const pos = obj.position;
    if (!pos || typeof pos !== "object" || !("x" in pos)) return undefined;
    return pos as Point;
}

export function validateInterceptOrdnance(
    position: FullThrustGamePosition,
    fighterId: string,
    ordnanceId: string,
    phase: number
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (phase !== 8) {
        issues.push({
            message: "Ordnance interception is typically in phase 8.",
            severity: "warning",
        });
    }
    const fighter = position.objects?.find((o) => o.id === fighterId) as FighterObj | undefined;
    if (!fighter || !isDeployedFighter(fighter)) {
        issues.push({ message: "Select a deployed fighter group.", severity: "error" });
        return issues;
    }
    if (!fighterCanIntercept(fighter)) {
        if (isFighterExhausted(fighter)) {
            issues.push({
                message: "No endurance remaining to intercept ordnance.",
                severity: "warning",
            });
        } else {
            issues.push({
                message: "Attack and torpedo fighters cannot intercept missiles.",
                severity: "warning",
            });
        }
    }
    const ord = position.objects?.find((o) => o.id === ordnanceId) as OrdnanceObj | undefined;
    if (!ord || ord.objType !== "ordnance") {
        issues.push({ message: `Ordnance not found: ${ordnanceId}`, severity: "error" });
        return issues;
    }
    if (!isInterceptableOrdnanceType(ord.type)) {
        issues.push({
            message: `Ordnance type ${ord.type} is not interceptable by fighters.`,
            severity: "warning",
        });
    }
    const fpos = mapPosition(fighter);
    const opos = mapPosition(ord);
    if (fpos && opos) {
        const dist = distance(fpos, opos);
        if (dist > FIGHTER_ATTACK_RANGE_MU) {
            issues.push({
                message: `Ordnance is ${dist.toFixed(1)} MU away (max ${FIGHTER_ATTACK_RANGE_MU} MU).`,
                severity: "warning",
            });
        }
        const facing = normalizeFacing(fighter.facing ?? 12);
        if (!bearingInFrontArc(fpos, facing, opos)) {
            issues.push({
                message: "Ordnance is outside the fighter group's front 180° arc.",
                severity: "warning",
            });
        }
    }
    return issues;
}

export interface InterceptDieResult {
    ordnanceKills: number;
    interceptorLosses: number;
    amtHits: number;
    pblHits: number;
    ordnanceDestroyed: boolean;
    amtStrengthLoss: number;
    notes: string[];
}

function isSalvoFamily(type: string): boolean {
    return isSalvoOrdnanceType(type);
}

function salvoCountBefore(ordnanceType: string, ordnance: { salvoCount?: number }): number {
    if (!isSalvoOrdnanceType(ordnanceType)) return 0;
    if (typeof ordnance.salvoCount === "number") return Math.max(0, ordnance.salvoCount);
    return DEFAULT_SALVO_MISSILE_COUNT;
}

/** Salvo: 5–6 kills one; 6 rerolls for additional kills. */
function resolveSalvoInterceptKills(source: RollSource): number {
    let kills = 0;
    let r = source.next();
    while (r >= 5) {
        kills += 1;
        if (r !== 6) break;
        r = source.next();
    }
    return kills;
}

function resolveHeavyInterceptKills(source: RollSource): number {
    let kills = 0;
    for (let i = 0; i < 1; i++) {
        if (source.next() === 6) kills += 1;
    }
    return kills;
}

export function resolveFighterIntercept(
    fighterCount: number,
    ordnanceType: string,
    ordnance: {
        interceptHits?: number;
        salvoCount?: number;
        beamClass?: number;
        amtWarheadStrength?: number;
        amtBlastRadius?: number;
    },
    source: RollSource
): InterceptDieResult & { rolls: number[] } {
    const mark = source.mark();
    const notes: string[] = [];
    let ordnanceKills = 0;
    let interceptorLosses = 0;
    let amtHits = 0;
    let pblHits = 0;
    let amtStrengthLoss = 0;

    if (ordnanceType === "amt" || ordnanceType === "plasmaBolt") {
        for (let i = 0; i < fighterCount; i++) {
            const { kills } = resolvePdsDie(source);
            if (kills > 0) {
                if (ordnanceType === "amt") amtHits += 1;
                else pblHits += kills;
            }
        }
        if (ordnanceType === "amt") {
            notes.push(`${amtHits} AMT hit(s)`);
        } else {
            notes.push(`${pblHits} PBL hit(s)`);
        }
    } else if (isSalvoFamily(ordnanceType)) {
        for (let i = 0; i < fighterCount; i++) {
            const kills = resolveSalvoInterceptKills(source);
            ordnanceKills += kills;
            for (let k = 0; k < kills; k++) {
                if (source.next() === 6) interceptorLosses += 1;
            }
        }
        notes.push(`${ordnanceKills} salvo missile(s) destroyed`);
        const remaining = Math.max(0, salvoCountBefore(ordnanceType, ordnance) - ordnanceKills);
        notes.push(`${remaining} missile(s) remain in salvo`);
    } else {
        for (let i = 0; i < fighterCount; i++) {
            if (source.next() === 6) {
                ordnanceKills += 1;
                if (source.next() === 6) interceptorLosses += 1;
            }
        }
        notes.push(`${ordnanceKills} heavy/rocket kill(s)`);
    }

    const priorHits = ordnance.interceptHits ?? 0;
    let ordnanceDestroyed = false;

    if (ordnanceType === "amt") {
        const totalHits = priorHits + amtHits;
        if (amtHits > 0) {
            amtStrengthLoss = source.next();
            notes.push(`AMT warhead −${amtStrengthLoss} strength, blast −1 MU`);
        }
        if (totalHits >= 3) {
            ordnanceDestroyed = true;
            notes.push("AMT warhead disrupted (3 hits)");
        }
    } else if (ordnanceType === "plasmaBolt") {
        const classLevel = ordnance.beamClass ?? 1;
        const totalHits = priorHits + pblHits;
        if (totalHits >= classLevel) {
            ordnanceDestroyed = true;
            notes.push(`PBL destroyed (${totalHits}/${classLevel} hits)`);
        }
    } else if (isSalvoFamily(ordnanceType)) {
        if (salvoCountBefore(ordnanceType, ordnance) - ordnanceKills <= 0) {
            ordnanceDestroyed = true;
        }
    } else if (ordnanceKills > 0) {
        ordnanceDestroyed = true;
    }

    if (interceptorLosses > 0) {
        notes.push(`${interceptorLosses} interceptor(s) lost on danger rolls`);
    }

    return {
        rolls: source.consumedSince(mark),
        ordnanceKills,
        interceptorLosses,
        amtHits,
        pblHits,
        ordnanceDestroyed,
        amtStrengthLoss,
        notes,
    };
}

export function applyInterceptToOrdnance(
    ord: OrdnanceObj,
    ordnanceType: string,
    result: InterceptDieResult
): void {
    if (ordnanceType === "amt") {
        const hits = (ord.interceptHits ?? 0) + result.amtHits;
        (ord as { interceptHits?: number }).interceptHits = hits;
        if (result.amtHits > 0) {
            const str = (ord as { amtWarheadStrength?: number }).amtWarheadStrength ?? 6;
            const blast = (ord as { amtBlastRadius?: number }).amtBlastRadius ?? 6;
            (ord as { amtWarheadStrength?: number }).amtWarheadStrength = Math.max(
                0,
                str - result.amtStrengthLoss
            );
            (ord as { amtBlastRadius?: number }).amtBlastRadius = Math.max(0, blast - 1);
        }
    } else if (ordnanceType === "plasmaBolt") {
        (ord as { interceptHits?: number }).interceptHits =
            (ord.interceptHits ?? 0) + result.pblHits;
    } else if (isSalvoFamily(ordnanceType)) {
        applySalvoMissileKills(ord, result.ordnanceKills);
    }
}

export function interceptableOrdnanceForFighter(
    position: FullThrustGamePosition,
    fighter: FighterObj
): OrdnanceObj[] {
    return enemyInterceptableOrdnance(position, fighter).filter((ord) => {
        const fpos = mapPosition(fighter);
        const opos = mapPosition(ord);
        if (!fpos || !opos) return false;
        const facing = normalizeFacing(fighter.facing ?? 12);
        if (distance(fpos, opos) > FIGHTER_ATTACK_RANGE_MU) return false;
        return bearingInFrontArc(fpos, facing, opos);
    });
}

/** All enemy ordnance of interceptable types (range/arc not required for selection). */
export function enemyInterceptableOrdnance(
    position: FullThrustGamePosition,
    fighter: FighterObj
): OrdnanceObj[] {
    if (!isDeployedFighter(fighter)) return [];
    const out: OrdnanceObj[] = [];
    for (const obj of position.objects ?? []) {
        if (obj.objType !== "ordnance") continue;
        const ord = obj as OrdnanceObj;
        if (!isInterceptableOrdnanceType(ord.type)) continue;
        if (ord.owner && fighter.owner && ord.owner === fighter.owner) continue;
        if (!mapPosition(ord)) continue;
        if (isSalvoOrdnanceType(ord.type) && (salvoMissileCount(ord) ?? 0) <= 0) continue;
        out.push(ord);
    }
    return out;
}

export function interceptModeratorHints(position: FullThrustGamePosition): string[] {
    const hints: string[] = [];
    for (const obj of position.objects ?? []) {
        if (obj.objType !== "fighters" || !isDeployedFighter(obj)) continue;
        const fighter = obj as FighterObj;
        if (!fighterCanIntercept(fighter)) continue;
        const targets = interceptableOrdnanceForFighter(position, fighter);
        if (targets.length > 0) {
            hints.push(
                `${fighter.id} may intercept: ${targets.map((t) => `${t.id} (${t.type})`).join(", ")}`
            );
        }
    }
    return hints;
}

export function applyInterceptToFighter(
    fighter: FighterObj,
    interceptorLosses: number
): { number: number; endurance: number; destroyed: boolean } {
    const before = fighter.number ?? 6;
    const after = Math.max(0, before - interceptorLosses);
    const endurance = nextEnduranceAfterCombat(fighter.endurance);
    return { number: after, endurance, destroyed: after === 0 };
}
