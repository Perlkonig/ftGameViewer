/** Gunboat ordnance interception (phase 8) — 12 MU, front arc. */

import type { FullThrustGamePosition } from "@/schemas/position";
import { GUNBOAT_ATTACK_RANGE_MU } from "./gunboatAttack";
import { bearingInFrontArc } from "./fighterAttack";
import { distance, normalizeFacing, type Point } from "./movement";
import type { ValidationIssue } from "./commandValidation";
import { isDeployedGunboat } from "./gunboatMove";
import {
    isInterceptableOrdnanceType,
    resolveFighterIntercept,
    applyInterceptToOrdnance,
    applyInterceptToFighter,
} from "./fighterIntercept";
import { isSalvoOrdnanceType, salvoMissileCount } from "./salvoOrdnance";
import { gunboatTypeLaunchesOrdnance } from "./gunboatWeapons";
import { nextEnduranceAfterCombat } from "./fighterEndurance";
import { clearGunboatAttachment } from "./gunboatAttachment";

type GunboatObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "gunboats" }
>;

function mapPosition(obj: { position?: unknown }): Point | undefined {
    const pos = obj.position;
    if (!pos || typeof pos !== "object" || !("x" in pos)) return undefined;
    return pos as Point;
}

export function gunboatCanIntercept(gunboat: {
    endurance?: number;
}): boolean {
    return (gunboat.endurance ?? 6) > 0;
}

export function validateGunboatInterceptOrdnance(
    position: FullThrustGamePosition,
    gunboatId: string,
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
    const gunboat = position.objects?.find(
        (o) => o.objType === "gunboats" && o.id === gunboatId
    ) as GunboatObj | undefined;
    if (!gunboat || !isDeployedGunboat(gunboat)) {
        issues.push({ message: "Select a deployed gunboat squadron.", severity: "error" });
        return issues;
    }
    if (!gunboatCanIntercept(gunboat)) {
        issues.push({
            message: "Squadron has no endurance or cannot intercept ordnance.",
            severity: "warning",
        });
    }
    const ord = position.objects?.find((o) => o.id === ordnanceId);
    if (!ord || ord.objType !== "ordnance") {
        issues.push({ message: `Ordnance not found: ${ordnanceId}`, severity: "error" });
        return issues;
    }
    if (!isInterceptableOrdnanceType((ord as { type?: string }).type)) {
        issues.push({
            message: `Ordnance type ${(ord as { type?: string }).type} is not interceptable.`,
            severity: "warning",
        });
    }
    const gpos = mapPosition(gunboat);
    const opos = mapPosition(ord);
    if (gpos && opos) {
        const dist = distance(gpos, opos);
        if (dist > GUNBOAT_ATTACK_RANGE_MU) {
            issues.push({
                message: `Ordnance is ${dist.toFixed(1)} MU away (max ${GUNBOAT_ATTACK_RANGE_MU} MU).`,
                severity: "warning",
            });
        }
        const facing = normalizeFacing(gunboat.facing ?? 12);
        if (!bearingInFrontArc(gpos, facing, opos)) {
            issues.push({
                message: "Ordnance is outside the squadron's front 180° arc.",
                severity: "warning",
            });
        }
    }
    return issues;
}

export function applyInterceptToGunboat(
    gunboat: GunboatObj,
    interceptorLosses: number
): { number: number; endurance: number; destroyed: boolean } {
    const before = gunboat.number ?? 6;
    const after = Math.max(0, before - interceptorLosses);
    gunboat.number = after;
    if (gunboat.boats && gunboat.boats.length > after) {
        gunboat.boats = gunboat.boats.slice(0, after);
    }
    const endurance = nextEnduranceAfterCombat(gunboat.endurance);
    gunboat.endurance = endurance;
    return { number: after, endurance, destroyed: after === 0 };
}

export {
    resolveFighterIntercept,
    applyInterceptToOrdnance,
    applyInterceptToFighter,
    isInterceptableOrdnanceType,
};

export function ordnanceInterceptableForGunboat(
    position: FullThrustGamePosition,
    gunboat: GunboatObj
): string[] {
    if (!isDeployedGunboat(gunboat) || !gunboatCanIntercept(gunboat)) return [];
    const gpos = mapPosition(gunboat);
    if (!gpos) return [];
    const facing = normalizeFacing(gunboat.facing ?? 12);
    const out: string[] = [];
    for (const obj of position.objects ?? []) {
        if (obj.objType !== "ordnance") continue;
        const ord = obj as { id: string; type?: string; owner?: string; salvoCount?: number };
        if (!isInterceptableOrdnanceType(ord.type)) continue;
        if (ord.owner && gunboat.owner && ord.owner === gunboat.owner) continue;
        const opos = mapPosition(obj);
        if (!opos) continue;
        if (isSalvoOrdnanceType(ord.type) && (salvoMissileCount(obj) ?? 0) <= 0) continue;
        if (distance(gpos, opos) > GUNBOAT_ATTACK_RANGE_MU) continue;
        if (!bearingInFrontArc(gpos, facing, opos)) continue;
        out.push(ord.id);
    }
    return out;
}
