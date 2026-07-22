import type { Point } from "./movement";
import { distance } from "./movement";
import type { RollSource } from "./dice";
import { arrayRollSource } from "./dice";

export const FIGHTER_MOVE_MU = 24;
export const FIGHTER_FAST_MOVE_MU = 36;
export const FIGHTER_SECONDARY_MU = 12;
export const MISSILE_LAUNCH_MU = 24;
export const MISSILE_LAUNCH_ER_MU = 36;
export const MISSILE_LOCK_MU = 6;

export function canFighterMove(
    from: Point,
    to: Point,
    allowanceMu = FIGHTER_MOVE_MU
): boolean {
    return distance(from, to) <= allowanceMu;
}

export function missileLockRange(modifiers = 0): number {
    return Math.max(0, MISSILE_LOCK_MU + modifiers);
}

export function isInMissileLock(
    missile: Point,
    target: Point,
    modifiers = 0
): boolean {
    return distance(missile, target) <= missileLockRange(modifiers);
}

/** Dogfight / PDS-style: 1–3 miss, 4–5 = 1 kill, 6 = 2 + reroll. */
function applyDogfightDrm(roll: number, drm: number): number {
    return Math.max(1, Math.min(6, roll + drm));
}

export function resolveDogfightDie(source: RollSource, drm = 0): { kills: number } {
    const first = applyDogfightDrm(source.next(), drm);
    if (first <= 3) return { kills: 0 };
    if (first <= 5) return { kills: 1 };
    let kills = 2;
    while (true) {
        const rr = applyDogfightDrm(source.next(), drm);
        if (rr <= 3) break;
        if (rr <= 5) {
            kills += 1;
            break;
        }
        kills += 2;
    }
    return { kills };
}

export interface DogfightSideResult {
    killsDealt: number;
    diceUsed: number;
}

/** One side rolls one die per fighter against the other group. */
export function resolveDogfightSide(
    fighterCount: number,
    source: RollSource
): { result: DogfightSideResult } {
    const mark = source.mark();
    let killsDealt = 0;
    for (let i = 0; i < Math.max(0, fighterCount); i++) {
        killsDealt += resolveDogfightDie(source).kills;
    }
    const diceUsed = source.consumedSince(mark).length;
    return { result: { killsDealt, diceUsed } };
}

/** Resolve dogfight side from a pre-supplied roll array (tests / legacy). */
export function resolveDogfightSideFromRolls(
    fighterCount: number,
    rolls: number[],
    startIndex = 0
): { result: DogfightSideResult; nextIndex: number } {
    const source = arrayRollSource(rolls.slice(startIndex));
    const { result } = resolveDogfightSide(fighterCount, source);
    return { result, nextIndex: startIndex + source.consumed().length };
}
