/** Combat endurance (CEF) helpers — rules 8.13. */

import type { RollSource } from "./dice";
import { resolveDogfightDie } from "./fighters";
import { fighterCanInterceptProfile } from "./fighterProfiles";
import { fighterEnduranceMax } from "./fighterWing";
import { fighterWingFromObj } from "./fighterTypeCommand";

export const DEFAULT_FIGHTER_CEF = 6;

export function fighterEndurance(fighter: { endurance?: number; enduranceMax?: number }): number {
    const max = fighter.enduranceMax ?? DEFAULT_FIGHTER_CEF;
    const n = fighter.endurance ?? max;
    return Math.max(0, Math.min(max, n));
}

export function isFighterExhausted(fighter: { endurance?: number; enduranceMax?: number }): boolean {
    return fighterEndurance(fighter) <= 0;
}

export function fighterCanInterceptType(type: string | undefined): boolean {
    return fighterCanInterceptProfile({ type });
}

export function fighterCanIntercept(fighter: {
    endurance?: number;
    type?: string;
    mods?: string[];
    weaponMode?: "beam" | "cannon";
}): boolean {
    return fighterEndurance(fighter) > 0 && fighterCanInterceptProfile(fighterWingFromObj(fighter));
}

/** Exhausted groups in dogfight: only natural 6 scores 1 kill. */
export function resolveDogfightDieExhausted(source: RollSource): { kills: number } {
    return { kills: source.next() === 6 ? 1 : 0 };
}

export function resolveDogfightSideRolls(
    fighterCount: number,
    exhausted: boolean,
    source: RollSource,
    drm = 0
): { killsDealt: number; diceUsed: number } {
    const mark = source.mark();
    let killsDealt = 0;
    for (let i = 0; i < Math.max(0, fighterCount); i++) {
        killsDealt += exhausted
            ? resolveDogfightDieExhausted(source).kills
            : resolveDogfightDie(source, drm).kills;
    }
    return { killsDealt, diceUsed: source.consumedSince(mark).length };
}

export function nextEnduranceAfterCombat(
    current: number | undefined,
    wing?: { enduranceMax?: number; type?: string; mods?: string[] }
): number {
    const max = wing ? fighterEnduranceMax(wing) : DEFAULT_FIGHTER_CEF;
    return Math.max(0, (current ?? max) - 1);
}
