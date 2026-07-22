/** Ordnance-capable gunboat types (phase 3). */

import type { GunboatType } from "ftlibship";

export const ORDNANCE_LAUNCH_GUNBOAT_TYPES = new Set<GunboatType>([
    "missile",
    "rocket",
    "plasmaBomber",
]);

export function gunboatTypeLaunchesOrdnance(type: string): boolean {
    return ORDNANCE_LAUNCH_GUNBOAT_TYPES.has(type as GunboatType);
}

export function isGunboatOrdnancePhase3Type(type: string): boolean {
    return gunboatTypeLaunchesOrdnance(type);
}
