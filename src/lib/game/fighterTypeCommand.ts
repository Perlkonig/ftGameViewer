/** Moderator setFighterType validation. */

import type { FighterWingLike } from "./fighterWing";

export const SET_FIGHTER_TYPES = new Set([
    "standard",
    "interceptor",
    "attack",
    "torpedo",
    "graser",
    "plasma",
    "MKP",
    "missile",
    "light",
    "lightInterceptor",
    "lightAttack",
    "assault",
]);

export function validateSetFighterType(type: string): string | undefined {
    if (type === "multiRole") return "Cannot set type to multiRole.";
    if (!SET_FIGHTER_TYPES.has(type)) return `Unknown fighter type: ${type}`;
    return undefined;
}

export function fighterWingFromObj(obj: FighterWingLike & { skill?: string }): FighterWingLike {
    return {
        type: obj.type,
        mods: (obj as { mods?: string[] }).mods,
        weaponMode: (obj as { weaponMode?: "beam" | "cannon" }).weaponMode,
        number: obj.number,
        endurance: obj.endurance,
        enduranceMax: (obj as { enduranceMax?: number }).enduranceMax,
    };
}
