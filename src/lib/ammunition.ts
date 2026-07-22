/** Bridge game ship.ammo[] to ftLibShip RenderOpts.ammunition. */

import { resolveAmmunitionRemaining, type AmmunitionRemaining } from "ftlibship";
import { ammoUses, findShipSystem, listShipSystems, type ShipGameState } from "@/lib/game/shipSystems";

const MINELAYER_NAMES = new Set(["minelayer", "mineLayer"]);
const MAGAZINE_NAMES = new Set(["magazine", "boardingTorpedoMagazine"]);

export function isAmmunitionSystem(sys: { name?: string; type?: string }): boolean {
    const name = sys.name ?? "";
    const type = sys.type ?? "";
    if (MINELAYER_NAMES.has(name) || type === "mineLayer") return true;
    if (MAGAZINE_NAMES.has(name) || type === "magazine") return true;
    if (name === "boardingTorpedoMagazine") return true;
    return false;
}

export function ammunitionSystems(ship: ShipGameState) {
    return listShipSystems(ship).filter(isAmmunitionSystem);
}

export function systemDesignCapacity(
    ship: ShipGameState,
    systemId: string
): number | undefined {
    const sys = findShipSystem(ship, systemId);
    if (!sys) return undefined;
    if (typeof sys.capacity === "number" && sys.capacity > 0) return sys.capacity;
    if (typeof sys.shots === "number" && sys.shots > 0) return sys.shots;
    if (typeof sys.ammo === "number" && sys.ammo > 0) return sys.ammo;
    if (isAmmunitionSystem(sys)) return 2;
    return undefined;
}

export function buildAmmunitionRemaining(ship: ShipGameState): AmmunitionRemaining {
    const out: AmmunitionRemaining = {};
    for (const sys of ammunitionSystems(ship)) {
        const capacity = systemDesignCapacity(ship, sys.id);
        if (capacity === undefined) continue;
        const used = ammoUses(ship, sys.id);
        const remaining = Math.max(0, capacity - used);
        if (remaining < capacity) {
            out[sys.id] = remaining;
        }
    }
    return out;
}

export function ammunitionRemaining(ship: ShipGameState, systemId: string): number {
    const capacity = systemDesignCapacity(ship, systemId);
    if (capacity === undefined) return 0;
    return resolveAmmunitionRemaining(
        capacity,
        systemId,
        buildAmmunitionRemaining(ship)
    );
}

export function canConsumeAmmunition(ship: ShipGameState, systemId: string): boolean {
    return ammunitionRemaining(ship, systemId) > 0;
}

/** Magazine id for salvo launchers; otherwise the launcher/minelayer id itself. */
export function ammunitionSourceForLauncher(
    ship: ShipGameState,
    launcherSystemId: string
): string {
    const launcher = findShipSystem(ship, launcherSystemId);
    if (!launcher) return launcherSystemId;
    const magazineId = (launcher as { magazine?: string }).magazine;
    if (magazineId && findShipSystem(ship, magazineId)) return magazineId;
    return launcherSystemId;
}

export function consumeAmmunitionPatch(
    ship: ShipGameState,
    systemId: string
): string[] {
    return [...(ship.ammo ?? []), systemId];
}

export function consumeLauncherAmmunitionPatch(
    ship: ShipGameState,
    launcherSystemId: string
): string[] {
    return consumeAmmunitionPatch(
        ship,
        ammunitionSourceForLauncher(ship, launcherSystemId)
    );
}
