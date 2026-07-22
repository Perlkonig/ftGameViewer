/** Fighter wing identity: capacity, endurance, mods — from SSD / map object. */

import type { FullThrustShip } from "ftlibship";

export const FIGHTER_MODS = ["heavy", "fast", "longRange", "ftl", "robot"] as const;
export type FighterMod = (typeof FIGHTER_MODS)[number];

export type FighterWeaponMode = "beam" | "cannon";

export interface FighterWingLike {
    type?: string;
    mods?: string[];
    weaponMode?: FighterWeaponMode;
    number?: number;
    endurance?: number;
    enduranceMax?: number;
}

const LIGHT_TYPES = new Set([
    "light",
    "lightInterceptor",
    "lightAttack",
]);

export function isLightFighterType(type: string | undefined): boolean {
    if (!type) return false;
    return LIGHT_TYPES.has(type) || type.startsWith("light");
}

export function fighterCapacity(wing: FighterWingLike): number {
    return isLightFighterType(wing.type) ? 8 : 6;
}

export function fighterEnduranceMax(wing: FighterWingLike): number {
    if (wing.enduranceMax !== undefined) return wing.enduranceMax;
    if (isLightFighterType(wing.type)) return 4;
    if (wing.mods?.includes("longRange")) return 9;
    return 6;
}

export function fighterHasMod(wing: FighterWingLike, mod: FighterMod): boolean {
    return wing.mods?.includes(mod) ?? false;
}

export function isFighterMissionConfigured(wing: FighterWingLike): boolean {
    return (wing.type ?? "standard") !== "multiRole";
}

export function clampFighterWingStats(wing: FighterWingLike): void {
    const cap = fighterCapacity(wing);
    const maxCef = fighterEnduranceMax(wing);
    if (wing.number !== undefined) {
        wing.number = Math.max(0, Math.min(cap, wing.number));
    }
    if (wing.endurance !== undefined) {
        wing.endurance = Math.max(0, Math.min(maxCef, wing.endurance));
    }
    wing.enduranceMax = maxCef;
}

export function normalizeFighterFromDesign(
    wing: NonNullable<FullThrustShip["fighters"]>[number]
): {
    type: string;
    mods: string[];
    weaponMode?: FighterWeaponMode;
    number: number;
    endurance: number;
    enduranceMax: number;
    skill: "standard" | "ace" | "turkey";
} {
    const type = wing.type ?? "standard";
    const mods = [...(wing.mods ?? [])];
    const out: FighterWingLike = { type, mods };
    const number = Math.min(fighterCapacity(out), wing.number ?? fighterCapacity(out));
    const enduranceMax = fighterEnduranceMax(out);
    const endurance = Math.min(enduranceMax, wing.endurance ?? enduranceMax);
    return {
        type,
        mods,
        number,
        endurance,
        enduranceMax,
        skill: (wing.skill as "standard" | "ace" | "turkey") ?? "standard",
    };
}

export function hangarIdFromFighterPosition(
    position: unknown
): { ship: string; hangar: string } | undefined {
    if (!position || typeof position !== "object") return undefined;
    if ("ship" in position && "hangar" in position) {
        const p = position as { ship: string; hangar: string };
        return { ship: p.ship, hangar: p.hangar };
    }
    return undefined;
}
