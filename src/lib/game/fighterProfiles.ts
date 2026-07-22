/** Combat/move profiles per fighter type + mods — FighterTypes.txt. */

import type { ScreenLevel } from "./combat";
import type { RollSource } from "./dice";
import { resolveBeamDieSplit } from "./combat";
import {
    fighterEnduranceMax,
    fighterHasMod,
    isFighterMissionConfigured,
    isLightFighterType,
    type FighterWingLike,
    type FighterWeaponMode,
} from "./fighterWing";
import { FIGHTER_FAST_MOVE_MU, FIGHTER_MOVE_MU, FIGHTER_SECONDARY_MU } from "./fighters";

export type FighterTargetClass = "ship" | "fighters" | "ordnance";

export type FighterStrikeMode =
    | "beamBdStar"
    | "beamBd"
    | "graserSap"
    | "plasma"
    | "genericBeam";

export interface FighterCombatProfile {
    canIntercept: boolean;
    canInterceptOrdnance: boolean;
    movePrimaryMu: number;
    moveSecondaryMu: number;
    enduranceCostAttack: number;
    strikeMode: FighterStrikeMode;
    drmShip: number;
    drmFighters: number;
    drmOrdnance: number;
    pdTargetDrm: number;
    ordnanceLaunchType?: "missile" | "torpedo" | "mkp";
    missileLockRangeMu: number;
}

const INTERCEPT_BLOCKED = new Set(["attack", "torpedo"]);

function baseTypeProfile(type: string): Omit<
    FighterCombatProfile,
    "movePrimaryMu" | "pdTargetDrm"
> {
    switch (type) {
        case "interceptor":
        case "lightInterceptor":
            return {
                canIntercept: true,
                canInterceptOrdnance: true,
                moveSecondaryMu: FIGHTER_SECONDARY_MU,
                enduranceCostAttack: 1,
                strikeMode: "beamBdStar",
                drmShip: -2,
                drmFighters: 1,
                drmOrdnance: 1,
                missileLockRangeMu: 6,
            };
        case "attack":
        case "lightAttack":
            return {
                canIntercept: false,
                canInterceptOrdnance: false,
                moveSecondaryMu: FIGHTER_SECONDARY_MU,
                enduranceCostAttack: 1,
                strikeMode: "beamBdStar",
                drmShip: 1,
                drmFighters: -2,
                drmOrdnance: -2,
                missileLockRangeMu: 6,
            };
        case "torpedo":
            return {
                canIntercept: false,
                canInterceptOrdnance: false,
                moveSecondaryMu: FIGHTER_SECONDARY_MU,
                enduranceCostAttack: 1,
                strikeMode: "beamBdStar",
                drmShip: -2,
                drmFighters: -2,
                drmOrdnance: -2,
                ordnanceLaunchType: "torpedo",
                missileLockRangeMu: 6,
            };
        case "graser":
            return {
                canIntercept: true,
                canInterceptOrdnance: true,
                moveSecondaryMu: FIGHTER_SECONDARY_MU,
                enduranceCostAttack: 2,
                strikeMode: "graserSap",
                drmShip: 0,
                drmFighters: -2,
                drmOrdnance: -2,
                missileLockRangeMu: 6,
            };
        case "plasma":
            return {
                canIntercept: true,
                canInterceptOrdnance: true,
                moveSecondaryMu: FIGHTER_SECONDARY_MU,
                enduranceCostAttack: 2,
                strikeMode: "plasma",
                drmShip: 0,
                drmFighters: -2,
                drmOrdnance: -2,
                missileLockRangeMu: 6,
            };
        case "MKP":
            return {
                canIntercept: true,
                canInterceptOrdnance: true,
                moveSecondaryMu: FIGHTER_SECONDARY_MU,
                enduranceCostAttack: 1,
                strikeMode: "beamBdStar",
                drmShip: -2,
                drmFighters: -2,
                drmOrdnance: -2,
                ordnanceLaunchType: "mkp",
                missileLockRangeMu: 6,
            };
        case "missile":
            return {
                canIntercept: true,
                canInterceptOrdnance: true,
                moveSecondaryMu: FIGHTER_SECONDARY_MU,
                enduranceCostAttack: 1,
                strikeMode: "beamBdStar",
                drmShip: -2,
                drmFighters: -2,
                drmOrdnance: -2,
                ordnanceLaunchType: "missile",
                missileLockRangeMu: 12,
            };
        case "assault":
            return {
                canIntercept: true,
                canInterceptOrdnance: true,
                moveSecondaryMu: FIGHTER_SECONDARY_MU,
                enduranceCostAttack: 1,
                strikeMode: "beamBdStar",
                drmShip: -2,
                drmFighters: -2,
                drmOrdnance: -2,
                missileLockRangeMu: 6,
            };
        case "multiRole":
            return {
                canIntercept: false,
                canInterceptOrdnance: false,
                moveSecondaryMu: FIGHTER_SECONDARY_MU,
                enduranceCostAttack: 1,
                strikeMode: "genericBeam",
                drmShip: 0,
                drmFighters: 0,
                drmOrdnance: 0,
                missileLockRangeMu: 6,
            };
        case "light":
        case "standard":
        default:
            return {
                canIntercept: true,
                canInterceptOrdnance: true,
                moveSecondaryMu: FIGHTER_SECONDARY_MU,
                enduranceCostAttack: 1,
                strikeMode: "beamBdStar",
                drmShip: 0,
                drmFighters: 0,
                drmOrdnance: 0,
                missileLockRangeMu: 6,
            };
    }
}

export function fighterProfileFor(wing: FighterWingLike): FighterCombatProfile {
    const type = wing.type ?? "standard";
    const base = baseTypeProfile(type);
    const movePrimaryMu = fighterHasMod(wing, "fast")
        ? FIGHTER_FAST_MOVE_MU
        : FIGHTER_MOVE_MU;
    let pdTargetDrm = 0;
    if (fighterHasMod(wing, "heavy")) pdTargetDrm -= 1;
    if (isLightFighterType(type)) pdTargetDrm += 1;
    if (INTERCEPT_BLOCKED.has(type)) {
        base.canIntercept = false;
        base.canInterceptOrdnance = false;
    }
    return {
        ...base,
        movePrimaryMu,
        pdTargetDrm,
    };
}

export function fighterDrmForTarget(
    profile: FighterCombatProfile,
    target: FighterTargetClass
): number {
    switch (target) {
        case "ship":
            return profile.drmShip;
        case "fighters":
            return profile.drmFighters;
        case "ordnance":
            return profile.drmOrdnance;
    }
}

export function fighterMoveAllowanceFromProfile(
    wing: FighterWingLike,
    phase: number
): number {
    const p = fighterProfileFor(wing);
    return phase === 4 ? p.movePrimaryMu : p.moveSecondaryMu;
}

export function fighterCanInterceptProfile(wing: FighterWingLike): boolean {
    if (!isFighterMissionConfigured(wing)) return false;
    return fighterProfileFor(wing).canIntercept;
}

export function applyDrmToDogfightRoll(roll: number, drm: number): number {
    return Math.max(1, Math.min(6, roll + drm));
}

export function resolveFighterStrikeWithProfile(
    fighterCount: number,
    screens: ScreenLevel,
    profile: FighterCombatProfile,
    target: FighterTargetClass,
    weaponMode: FighterWeaponMode | undefined,
    source: RollSource
): {
    normalDamage: number;
    penetratingDamage: number;
    totalDamage: number;
} {
    let normalDamage = 0;
    let penetratingDamage = 0;
    const drm = fighterDrmForTarget(profile, target);
    const ignoreScreens = weaponMode === "cannon";
    const screenLevel: ScreenLevel = ignoreScreens ? 0 : screens;

    for (let i = 0; i < Math.max(0, fighterCount); i++) {
        if (profile.strikeMode === "graserSap") {
            const { result } = resolveBeamDieSplit(source, screenLevel);
            let sap = 0;
            if (result.penetratingDamage > 0 || result.normalDamage > 0) {
                const d3 = source.next();
                sap = Math.max(1, Math.min(3, d3));
            }
            penetratingDamage += sap;
        } else if (profile.strikeMode === "plasma") {
            const r = source.next();
            const adj = Math.max(1, Math.min(6, r + drm));
            if (adj >= 4) {
                let dmg = Math.max(0, adj - 2 - screens);
                penetratingDamage += dmg;
                while (r === 6) {
                    const rr = source.next();
                    if (rr === 6) penetratingDamage += Math.max(0, 6 - 2 - screens);
                    else if (rr >= 4) penetratingDamage += Math.max(0, rr - 2 - screens);
                    if (rr !== 6) break;
                }
            }
        } else {
            const { result } = resolveBeamDieSplit(source, screenLevel);
            void drm;
            normalDamage += result.normalDamage;
            penetratingDamage += result.penetratingDamage;
        }
    }
    return {
        normalDamage,
        penetratingDamage,
        totalDamage: normalDamage + penetratingDamage,
    };
}

export function nextEnduranceAfterFighterAttack(
    current: number | undefined,
    wing: FighterWingLike
): number {
    const cost = fighterProfileFor(wing).enduranceCostAttack;
    const max = fighterEnduranceMax(wing);
    return Math.max(0, Math.min(max, (current ?? max) - cost));
}
