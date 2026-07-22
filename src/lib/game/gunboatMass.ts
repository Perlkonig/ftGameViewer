/** Boat bay capacity checks for gunboat squadrons (1.5× surviving mass). */

import type { FullThrustShip } from "ftlibship";
import type { ResolvedBoat } from "ftlibship";

const MASS_PER_BOAT = 3;
const MASS_PER_FTL_BOAT = 4;

export function gunboatSquadronMass(
    boats: ResolvedBoat[],
    ftl: boolean
): number {
    const per = ftl ? MASS_PER_FTL_BOAT : MASS_PER_BOAT;
    return boats.length * per;
}

export function requiredBoatBayMass(boats: ResolvedBoat[], ftl: boolean): number {
    return gunboatSquadronMass(boats, ftl) * 1.5;
}

export function boatBayCapacityMu(ship: FullThrustShip, bayId: string): number | undefined {
    const bay = ship.systems?.find(
        (s) => s.name === "bay" && (s as { id?: string }).id === bayId
    ) as { capacity?: number; ratio?: number; type?: string } | undefined;
    if (!bay || (bay.type !== "boat" && bay.type !== "tender")) return undefined;
    const cap = bay.capacity ?? 0;
    const ratio = bay.ratio ?? 24;
    return cap * ratio;
}

export function squadronFitsBoatBay(
    ship: FullThrustShip,
    bayId: string,
    boats: ResolvedBoat[],
    ftl: boolean
): boolean {
    const capacity = boatBayCapacityMu(ship, bayId);
    if (capacity === undefined) return false;
    return requiredBoatBayMass(boats, ftl) <= capacity;
}
