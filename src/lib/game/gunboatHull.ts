/** Apply hull losses to gunboat squadrons (sync number + boats[]). */

import type { RollSource } from "./dice";
import { liveGunboatBoats } from "./gunboatProfiles";

export function applyGunboatKills(
    gunboat: {
        id: string;
        number?: number;
        boats?: { type: string; id?: string }[];
        type?: string;
    },
    kills: number,
    source?: RollSource
): number {
    if (kills <= 0) return 0;
    const before = gunboat.number ?? liveGunboatBoats(gunboat).length;
    const boats = [...liveGunboatBoats(gunboat)];
    let remaining = kills;
    while (remaining > 0 && boats.length > 0) {
        const idx =
            source !== undefined
                ? (source.next() - 1) % boats.length
                : 0;
        const pick = Math.max(0, Math.min(boats.length - 1, idx));
        boats.splice(pick, 1);
        remaining--;
    }
    const after = Math.max(0, before - kills);
    gunboat.number = Math.min(after, boats.length);
    gunboat.boats = boats;
    return Math.min(kills, before);
}
