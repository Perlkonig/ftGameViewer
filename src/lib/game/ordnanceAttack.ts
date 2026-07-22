/** Phase 9 missile / fighter strike helpers. */

import { resolveBeamDieSplit, type ScreenLevel } from "./combat";
import type { RollSource } from "./dice";
import { arrayRollSource } from "./dice";

export interface SalvoStrikeResult {
    missilesOnTarget: number;
    survivors: number;
    damageDice: number[];
    totalSap: number;
}

/**
 * Salvo missiles: attacker d6 = missiles on target; subtract PD kills (phases 8–9);
 * each survivor 1d6 SAP. Board `salvoCount` tracks missiles remaining on the marker.
 */
export function resolveSalvoStrike(
    attackRoll: number,
    pdKills: number,
    sapRolls: number[]
): SalvoStrikeResult {
    const missilesOnTarget = Math.max(1, Math.min(6, Math.round(attackRoll)));
    const survivors = Math.max(0, missilesOnTarget - Math.max(0, pdKills));
    const damageDice = sapRolls.slice(0, survivors).map((r) => Math.max(1, Math.min(6, r)));
    while (damageDice.length < survivors) {
        throw new Error("Insufficient SAP dice for salvo survivors");
    }
    return {
        missilesOnTarget,
        survivors,
        damageDice,
        totalSap: damageDice.reduce((a, b) => a + b, 0),
    };
}

export interface HeavyMissileResult {
    damageDice: number[];
    totalSap: number;
}

/** Heavy missile: 3d6 SAP. */
export function resolveHeavyMissile(sapRolls: number[]): HeavyMissileResult {
    if (sapRolls.length < 3) throw new Error("Heavy missile needs 3d6");
    const damageDice = sapRolls.slice(0, 3).map((r) => Math.max(1, Math.min(6, r)));
    return {
        damageDice,
        totalSap: damageDice.reduce((a, b) => a + b, 0),
    };
}

export interface FighterStrikeResult {
    results: { roll: number; normalDamage: number; penetratingDamage: number }[];
    normalDamage: number;
    penetratingDamage: number;
    totalDamage: number;
}

/**
 * Fighter attack run ≈ Beam-1 per fighter (screens apply).
 * Consumes rolls including penetrating rerolls.
 */
export function resolveFighterStrike(
    fighterCount: number,
    screens: ScreenLevel,
    source: RollSource
): FighterStrikeResult {
    const results: FighterStrikeResult["results"] = [];
    let normalDamage = 0;
    let penetratingDamage = 0;
    for (let i = 0; i < Math.max(0, fighterCount); i++) {
        const { result } = resolveBeamDieSplit(source, screens);
        results.push({
            roll: result.roll,
            normalDamage: result.normalDamage,
            penetratingDamage: result.penetratingDamage,
        });
        normalDamage += result.normalDamage;
        penetratingDamage += result.penetratingDamage;
    }
    return {
        results,
        normalDamage,
        penetratingDamage,
        totalDamage: normalDamage + penetratingDamage,
    };
}

/** Resolve fighter strike from a pre-supplied roll array (tests / legacy). */
export function resolveFighterStrikeFromRolls(
    fighterCount: number,
    screens: ScreenLevel,
    rolls: number[]
): FighterStrikeResult {
    return resolveFighterStrike(fighterCount, screens, arrayRollSource(rolls));
}
