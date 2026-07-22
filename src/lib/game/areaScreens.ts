/** Area screen bubble (+1 effective screen, 6 MU radius). */

import type { FullThrustGamePosition } from "@/schemas/position";
import type { ScreenLevel } from "./combat";
import { distance, type Point } from "./movement";
import {
    effectiveIntrinsicScreens,
    shipHasOperationalAreaScreen,
    type ShipGameState,
} from "./shipSystems";

export const AREA_SCREEN_RADIUS_MU = 6;

function mapPoint(obj: { position?: unknown }): Point | undefined {
    const pos = obj.position;
    if (!pos || typeof pos !== "object" || !("x" in pos)) return undefined;
    return pos as Point;
}

function areaScreenDonorShips(position: FullThrustGamePosition): ShipGameState[] {
    return (position.objects ?? [])
        .filter((o) => o.objType === "ship")
        .map((o) => o as ShipGameState)
        .filter((s) => shipHasOperationalAreaScreen(s))
        .sort((a, b) => a.id.localeCompare(b.id));
}

/** +1 when target is under an area bubble and fire is not from inside that bubble. */
export function areaScreenBonus(
    position: FullThrustGamePosition,
    target: ShipGameState,
    attackerPoint?: Point
): 0 | 1 {
    const targetPoint = mapPoint(target);
    if (!targetPoint) return 0;

    for (const donor of areaScreenDonorShips(position)) {
        const donorPoint = mapPoint(donor);
        if (!donorPoint) continue;
        if (distance(donorPoint, targetPoint) > AREA_SCREEN_RADIUS_MU + 1e-6) continue;
        if (
            attackerPoint &&
            distance(donorPoint, attackerPoint) <= AREA_SCREEN_RADIUS_MU + 1e-6
        ) {
            continue;
        }
        return 1;
    }
    return 0;
}

export function effectiveScreensForIncomingFire(
    position: FullThrustGamePosition | undefined,
    target: ShipGameState,
    attackerPoint?: Point
): ScreenLevel {
    const intrinsic = effectiveIntrinsicScreens(target);
    if (!position) return intrinsic as ScreenLevel;
    const bonus = areaScreenBonus(position, target, attackerPoint);
    return Math.min(3, intrinsic + bonus) as ScreenLevel;
}
