/** Projectile weapon hit probability (Continuum chart). */

import type { RollSource } from "./dice";
import type { ShipSystemEntry } from "./shipSystems";

export type ProjectileRangeProfile = "standard" | "long" | "short";

const STANDARD: Record<0 | 1 | 2, number[]> = {
    0: [6, 12, 18, 24, 30],
    1: [5, 10, 15, 20, 25],
    2: [4, 8, 12, 16, 20],
};

const LONG: Record<0 | 1 | 2, number[]> = {
    0: [9, 18, 27, 36, 45],
    1: [7.5, 15, 22.5, 30, 37.5],
    2: [6, 12, 18, 24, 30],
};

const SHORT: Record<0 | 1 | 2, number[]> = {
    0: [4, 8, 12, 16, 20],
    1: [3.33, 6.66, 10, 13.33, 16.6],
    2: [2.66, 5.3, 8, 10.6, 13.3],
};

const TABLES: Record<ProjectileRangeProfile, Record<0 | 1 | 2, number[]>> = {
    standard: STANDARD,
    long: LONG,
    short: SHORT,
};

export function inferProjectileRangeProfile(weapon: ShipSystemEntry): ProjectileRangeProfile {
    const mod = String(weapon.modifier ?? "").toLowerCase();
    if (mod === "long") return "long";
    if (mod === "short") return "short";
    return "standard";
}

export function targetStealthLevel(stealth: unknown): 0 | 1 | 2 {
    const n = Number(stealth);
    if (n === 1) return 1;
    if (n >= 2) return 2;
    return 0;
}

/** Smallest hit threshold N (2–6) for range, or null if out of range. */
export function projectileHitThreshold(
    rangeMu: number,
    profile: ProjectileRangeProfile,
    stealth: 0 | 1 | 2
): number | null {
    const row = TABLES[profile][stealth];
    for (let i = 0; i < row.length; i++) {
        if (rangeMu <= row[i]) return i + 2;
    }
    return null;
}

export function resolveProjectileToHit(
    rangeMu: number,
    profile: ProjectileRangeProfile,
    stealth: 0 | 1 | 2,
    source: RollSource
): { hit: boolean; threshold: number | null; roll: number } {
    const threshold = projectileHitThreshold(rangeMu, profile, stealth);
    if (threshold === null) {
        return { hit: false, threshold: null, roll: 0 };
    }
    const roll = source.next();
    return { hit: roll >= threshold, threshold, roll };
}
