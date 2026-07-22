/** Beam / PDS combat resolution helpers. */

import type { RollSource } from "./dice";
import { arrayRollSource } from "./dice";

/** On-SSD screen systems only (max 2). */
export type IntrinsicScreenLevel = 0 | 1 | 2;
/** Effective standard screens in combat (intrinsic + area bubble, max 3). */
export type ScreenLevel = 0 | 1 | 2 | 3;

export interface ScreenSystemFields {
    name?: string;
    type?: string;
    level?: number;
    area?: boolean;
}

export function isStandardScreenSystem(s: ScreenSystemFields): boolean {
    return (s.name ?? "").toLowerCase() === "screen";
}

export function isAreaScreenSystem(s: ScreenSystemFields): boolean {
    return isStandardScreenSystem(s) && s.area === true;
}

export interface BeamAttackInput {
    /** Beam class 1–5 (dice at closest band). */
    beamClass: number;
    rangeMu: number;
    screens: ScreenLevel;
    /** If true, penetrating damage ignores armour/screens (already applied via rerolls). */
}

export interface DieResult {
    roll: number;
    damage: number;
    penetrating: boolean;
    rerolls: number[];
}

export interface BeamResolution {
    dicePool: number;
    rangeBand: number;
    results: DieResult[];
    totalDamage: number;
    penetratingDamage: number;
    normalDamage: number;
}

/** Beam class N → max range N*12 MU; −1 die per band beyond first. */
export function beamRangeBand(rangeMu: number, beamClass: number, bandWidth = 12): number {
    if (rangeMu < 0) return 1;
    return Math.floor(rangeMu / bandWidth) + 1;
}

export function beamDicePool(beamClass: number, rangeMu: number, bandWidth = 12): number {
    const band = beamRangeBand(rangeMu, beamClass, bandWidth);
    return Math.max(0, beamClass - (band - 1));
}

/** Gravitic: damage per beam hit from target speed (MU/turn). */
export function graviticDamagePerHit(targetSpeed: number): number {
    if (targetSpeed < 6) return 0;
    if (targetSpeed < 12) return 1;
    if (targetSpeed < 18) return 2;
    if (targetSpeed < 24) return 3;
    return 4;
}

/** BD pool without penetrating rerolls (transporter). */
export function resolveBdPoolNoReroll(
    dice: number,
    screens: ScreenLevel,
    source: RollSource
): { hits: number; rolls: number[] } {
    const rolls: number[] = [];
    let hits = 0;
    for (let i = 0; i < Math.max(0, dice); i++) {
        const roll = source.next();
        rolls.push(roll);
        if (roll <= 3) continue;
        if (roll === 4 && screens >= 1) continue;
        if (roll === 5) hits += 1;
        else if (roll === 6) hits += screens >= 2 ? 1 : 2;
    }
    return { hits, rolls };
}

/** Fixed BD* dice at range (0 dice beyond max range). */
export function resolveFixedBdPool(
    dice: number,
    maxRangeMu: number,
    rangeMu: number,
    screens: ScreenLevel,
    source: RollSource
): BeamResolution {
    if (rangeMu > maxRangeMu || dice <= 0) {
        return {
            dicePool: 0,
            rangeBand: 0,
            results: [],
            totalDamage: 0,
            normalDamage: 0,
            penetratingDamage: 0,
        };
    }
    const mark = source.mark();
    const results: DieResult[] = [];
    let normalDamage = 0;
    let penetratingDamage = 0;
    for (let i = 0; i < dice; i++) {
        const { result } = resolveBeamDieSplit(source, screens);
        results.push(result);
        normalDamage += result.normalDamage;
        penetratingDamage += result.penetratingDamage;
    }
    return {
        dicePool: dice,
        rangeBand: 1,
        results,
        totalDamage: normalDamage + penetratingDamage,
        normalDamage,
        penetratingDamage,
    };
}

/** Plasma: 1d6-2-screens per hit die, 6 rerolls. */
export function resolvePlasmaDamagePerHit(
    screens: ScreenLevel,
    source: RollSource
): { damage: number; rolls: number[] } {
    const rolls: number[] = [];
    let total = 0;
    let roll = source.next();
    rolls.push(roll);
    while (true) {
        const dmg = Math.max(0, roll - 2 - screens);
        total += dmg;
        if (roll !== 6) break;
        if (screens >= 3) break;
        roll = source.next();
        rolls.push(roll);
    }
    return { damage: total, rolls };
}

/** SAP per hit: 1d3 (graser std / phaser) or 1d6 (heavy graser). */
export function resolveSapPerHit(source: RollSource, dieSize: 3 | 6 = 3): number {
    const roll = source.next();
    if (dieSize === 6) return roll;
    return Math.ceil(roll / 2);
}

/** K-gun: class AP damage, reroll ≤ class doubles. */
export function resolveKgunDamage(
    weaponClass: number,
    source: RollSource
): { damage: number; rolls: number[] } {
    const mark = source.mark();
    let damage = weaponClass;
    const reroll = source.next();
    if (reroll <= weaponClass) damage *= 2;
    return { damage, rolls: source.consumedSince(mark) };
}

/** MKP: 4-5 = 1 hit, 6 = 2 hits. */
export function resolveMkpHits(source: RollSource): { hits: number; rolls: number[] } {
    const mark = source.mark();
    const roll = source.next();
    let hits = 0;
    if (roll >= 4 && roll <= 5) hits = 1;
    else if (roll === 6) hits = 2;
    return { hits, rolls: source.consumedSince(mark) };
}
/**
 * Resolve a single attack die with on-demand rolls (including penetrating reroll chain).
 * Table: 1–3 miss; 4–5 = 1 dmg; 6 = 2 dmg + penetrating reroll.
 * Screen L1: ignore 4s. Screen L2+: 6s deal 1 instead of 2. L3: no penetrating reroll.
 */
export function resolveBeamDieSplit(
    source: RollSource,
    screens: ScreenLevel,
    opts: { allowPenetratingReroll?: boolean } = {}
): {
    result: DieResult & { normalDamage: number; penetratingDamage: number };
} {
    const allowReroll = opts.allowPenetratingReroll !== false && screens < 3;
    const roll = source.next();
    const rerolls: number[] = [];
    let normalDamage = 0;
    let penetratingDamage = 0;

    if (roll <= 3) {
        return {
            result: {
                roll,
                damage: 0,
                penetrating: false,
                rerolls,
                normalDamage: 0,
                penetratingDamage: 0,
            },
        };
    }
    if (roll === 4) {
        normalDamage = screens >= 1 ? 0 : 1;
        return {
            result: {
                roll,
                damage: normalDamage,
                penetrating: false,
                rerolls,
                normalDamage,
                penetratingDamage: 0,
            },
        };
    }
    if (roll === 5) {
        return {
            result: {
                roll,
                damage: 1,
                penetrating: false,
                rerolls,
                normalDamage: 1,
                penetratingDamage: 0,
            },
        };
    }
    // natural 6
    normalDamage = screens >= 2 ? 1 : 2;
    if (!allowReroll) {
        return {
            result: {
                roll,
                damage: normalDamage,
                penetrating: false,
                rerolls,
                normalDamage,
                penetratingDamage: 0,
            },
        };
    }
    while (true) {
        const rr = source.next();
        rerolls.push(rr);
        if (rr <= 3) break;
        if (rr === 4 || rr === 5) {
            penetratingDamage += 1;
            break;
        }
        penetratingDamage += 2;
    }
    return {
        result: {
            roll,
            damage: normalDamage + penetratingDamage,
            penetrating: penetratingDamage > 0,
            rerolls,
            normalDamage,
            penetratingDamage,
        },
    };
}

export function resolveBeamAttack(
    input: BeamAttackInput,
    source: RollSource
): BeamResolution {
    const rangeBand = beamRangeBand(input.rangeMu, input.beamClass);
    const dicePool = beamDicePool(input.beamClass, input.rangeMu);
    const results: DieResult[] = [];
    let normalDamage = 0;
    let penetratingDamage = 0;
    for (let i = 0; i < dicePool; i++) {
        const { result } = resolveBeamDieSplit(source, input.screens);
        results.push(result);
        normalDamage += result.normalDamage;
        penetratingDamage += result.penetratingDamage;
    }
    return {
        dicePool,
        rangeBand,
        results,
        totalDamage: normalDamage + penetratingDamage,
        normalDamage,
        penetratingDamage,
    };
}

/** Resolve beam attack from a pre-supplied roll array (tests / legacy). */
export function resolveBeamAttackFromRolls(
    input: BeamAttackInput,
    rolls: number[]
): BeamResolution {
    return resolveBeamAttack(input, arrayRollSource(rolls));
}

/** PDS: 4–5 = 1 kill, 6 = 2 kills + reroll. */
export function resolvePdsDie(source: RollSource): { kills: number; used: number[] } {
    const mark = source.mark();
    const first = source.next();
    if (first <= 3) {
        return { kills: 0, used: source.consumedSince(mark) };
    }
    if (first === 4 || first === 5) {
        return { kills: 1, used: source.consumedSince(mark) };
    }
    let kills = 2;
    while (true) {
        const rr = source.next();
        if (rr <= 3) break;
        if (rr === 4 || rr === 5) {
            kills += 1;
            break;
        }
        kills += 2;
    }
    return { kills, used: source.consumedSince(mark) };
}

/** Resolve `dice` PDS attack dice from a roll stream. */
export function resolvePdsPool(
    source: RollSource,
    dice: number
): { kills: number; used: number[] } {
    const mark = source.mark();
    let kills = 0;
    for (let i = 0; i < Math.max(0, dice); i++) {
        const r = resolvePdsDie(source);
        kills += r.kills;
    }
    return { kills, used: source.consumedSince(mark) };
}

/** Resolve PDS from a pre-supplied roll array (tests / legacy). */
export function resolvePdsPoolFromRolls(
    rolls: number[],
    dice: number
): { kills: number; used: number[] } {
    return resolvePdsPool(arrayRollSource(rolls), dice);
}

/**
 * Advanced screens vs missiles/torpedoes: −1/−2 damage per die (min 0).
 * Standard screens do not apply to these weapons.
 */
export function applyAdvancedScreenReduction(
    damagePerDie: number[],
    advancedScreenLevel: 0 | 1 | 2
): number[] {
    if (advancedScreenLevel <= 0) return [...damagePerDie];
    const reduce = advancedScreenLevel;
    return damagePerDie.map((d) => Math.max(0, d - reduce));
}

export type DamageType = "standard" | "AP" | "SAP";

export interface ArmourLayer {
    standard: number;
    regenerative?: number;
}

/** ftLibShip uses `[standard, regenerative]` tuples; game state may use objects. */
export function normalizeArmourLayer(row: unknown): ArmourLayer {
    if (Array.isArray(row)) {
        return {
            standard: typeof row[0] === "number" ? row[0] : 0,
            regenerative: typeof row[1] === "number" ? row[1] : 0,
        };
    }
    if (row && typeof row === "object") {
        const r = row as { standard?: number; regenerative?: number };
        return {
            standard: r.standard ?? 0,
            regenerative: r.regenerative ?? 0,
        };
    }
    return { standard: 0, regenerative: 0 };
}

export function normalizeArmourLayers(src: unknown): ArmourLayer[] {
    return Array.isArray(src) ? src.map(normalizeArmourLayer) : [];
}

/** Total armour boxes already lost per row (object or tuple dmgArmour rows). */
export function normalizeArmourDamageTaken(row: unknown): number {
    if (Array.isArray(row)) {
        return (typeof row[0] === "number" ? row[0] : 0) + (typeof row[1] === "number" ? row[1] : 0);
    }
    if (row && typeof row === "object") {
        const r = row as { standard?: number; regenerative?: number };
        return (r.standard ?? 0) + (r.regenerative ?? 0);
    }
    return 0;
}

export interface DamageApplication {
    hullDamage: number;
    armourDamage: number[]; // per layer, additive boxes lost
}

/**
 * Apply damage through armour then hull.
 * - standard: 1:1 through armour boxes then hull
 * - AP: 1 dmg per armour layer then rest to hull (simplified: burns one box per layer per point until layers gone — Continuum: AP ignores armour? Actually Continuum: AP = 1 dmg per armour layer then hull)
 * Continuum: Armor (permanent) → hull. AP: 1 dmg per armor layer then hull. SAP: half (round up) to armor, rest to hull.
 */
export function applyDamageToShip(
    armour: ArmourLayer[],
    armourAlreadyDamaged: number[],
    hullRemaining: number,
    damage: number,
    type: DamageType,
    penetrating = 0
): DamageApplication {
    // Penetrating goes straight to hull
    let hullDamage = penetrating;
    let remaining = damage;
    const armourDamage = armour.map(() => 0);

    if (type === "SAP") {
        const toArmour = Math.ceil(remaining / 2);
        const toHull = remaining - toArmour;
        let left = toArmour;
        for (let i = 0; i < armour.length && left > 0; i++) {
            const capacity =
                armour[i].standard +
                (armour[i].regenerative ?? 0) -
                (armourAlreadyDamaged[i] ?? 0) -
                armourDamage[i];
            const take = Math.min(capacity, left);
            armourDamage[i] += take;
            left -= take;
        }
        hullDamage += toHull + left;
        remaining = 0;
    } else if (type === "AP") {
        // One point of damage to each armour layer (if present), then rest to hull
        for (let i = 0; i < armour.length && remaining > 0; i++) {
            const capacity =
                armour[i].standard +
                (armour[i].regenerative ?? 0) -
                (armourAlreadyDamaged[i] ?? 0) -
                armourDamage[i];
            if (capacity > 0) {
                armourDamage[i] += 1;
                remaining -= 1;
            }
        }
        hullDamage += remaining;
        remaining = 0;
    } else {
        // standard: eat armour from outside? Continuum: innermost first in schema ("first element is innermost")
        for (let i = 0; i < armour.length && remaining > 0; i++) {
            const capacity =
                armour[i].standard +
                (armour[i].regenerative ?? 0) -
                (armourAlreadyDamaged[i] ?? 0) -
                armourDamage[i];
            const take = Math.min(capacity, remaining);
            armourDamage[i] += take;
            remaining -= take;
        }
        hullDamage += remaining;
    }

    // Cap hull to remaining
    hullDamage = Math.min(hullDamage, Math.max(0, hullRemaining));

    return { hullDamage, armourDamage };
}

/** Max intrinsic screen level from SSD systems (redundant backups do not stack). */
export function screenLevelFromSystems(systems: ScreenSystemFields[]): IntrinsicScreenLevel {
    let level: IntrinsicScreenLevel = 0;
    for (const s of systems) {
        if (!isStandardScreenSystem(s)) continue;
        const lv = Math.min(2, Math.max(1, s.level ?? 1));
        level = Math.max(level, lv) as IntrinsicScreenLevel;
    }
    return level;
}
