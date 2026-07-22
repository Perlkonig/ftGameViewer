/** Read ship SSD systems (ftLibShip) for capability checks. */

import { ammunitionRemaining } from "@/lib/ammunition";
import { dcpAvailabilityForShip, availableMarineIds } from "./crewDeployment";
import { canOperateAsShipFire } from "@/lib/game/shipFireProfiles";

export interface ShipSystemEntry {
    id: string;
    name?: string;
    type?: string;
    fighters?: number;
    shots?: number;
    ammo?: number;
    heavy?: boolean;
    highIntensity?: boolean;
    modifier?: string;
    range?: string;
    mode?: string;
    magazine?: string;
    [key: string]: unknown;
}

export interface ShipGameState {
    id: string;
    object: unknown;
    systems?: { id: string; state?: string }[];
    ammo?: string[];
    speed?: number;
    facing?: number;
    course?: number;
    movementMode?: "cinematic" | "vector";
    position?: { x: number; y: number } | null;
}

const HANGAR_NAMES = new Set(["hangar", "fighterbay", "fighterBay"]);
const MINELAYER_NAMES = new Set(["minelayer", "mineLayer"]);

export const ORDNANCE_LAUNCHER =
    /salvo|missile|amt|rocket|plasma|torpedo|pbl|twostage|ordnance/i;

export function listShipSystems(ship: ShipGameState): ShipSystemEntry[] {
    const obj = ship.object as {
        systems?: ShipSystemEntry[];
        ordnance?: ShipSystemEntry[];
        weapons?: ShipSystemEntry[];
    };
    return [
        ...(obj.systems ?? []),
        ...(obj.ordnance ?? []),
        ...(obj.weapons ?? []),
    ];
}

export function findShipSystem(ship: ShipGameState, systemId: string): ShipSystemEntry | undefined {
    return listShipSystems(ship).find((s) => s.id === systemId);
}

export function isSystemDestroyed(ship: ShipGameState, systemId: string): boolean {
    const entry = ship.systems?.find((s) => s.id === systemId);
    return entry?.state === "destroyed";
}

export function isSystemDamagedOrDestroyed(ship: ShipGameState, systemId: string): boolean {
    const entry = ship.systems?.find((s) => s.id === systemId);
    return entry?.state === "destroyed" || entry?.state === "damaged";
}

export function isSystemDamaged(ship: ShipGameState, systemId: string): boolean {
    const entry = ship.systems?.find((s) => s.id === systemId);
    return entry?.state === "damaged";
}

const MARINE_NAME = /^marines?$/i;
const DCP_NAME = /^damagecontrol|damage.?control|dcp$/i;

/** Single-use externally mounted ordnance racks (not magazine-fed launchers). */
export function isSingleUseOrdnanceRack(entry: ShipSystemEntry): boolean {
    const n = (entry.name ?? "").toLowerCase();
    if (n === "salvo" || n === "amt") return true;
    if (n === "missile" && !entry.magazine) return true;
    return false;
}

/** Systems that damage control cannot repair (marines, magazines, single-use racks, …). */
export function isNonRepairableSystem(entry: ShipSystemEntry): boolean {
    const n = (entry.name ?? "").toLowerCase();
    if (MARINE_NAME.test(n) || DCP_NAME.test(n)) return true;
    if (n === "magazine") return true;
    return isSingleUseOrdnanceRack(entry);
}

export function ammoUses(ship: ShipGameState, systemId: string): number {
    return (ship.ammo ?? []).filter((id) => id === systemId).length;
}

export function systemShotCapacity(sys: ShipSystemEntry): number | undefined {
    if (typeof sys.shots === "number") return sys.shots;
    if (typeof sys.ammo === "number") return sys.ammo;
    const name = (sys.name ?? "").toLowerCase();
    if (name === "rocketpod" || name === "grapeshot" || name === "scattergun") return 1;
    return undefined;
}

export function operationalHangars(ship: ShipGameState): ShipSystemEntry[] {
    return listShipSystems(ship).filter((s) => {
        const name = s.name ?? "";
        if (!HANGAR_NAMES.has(name) && !/hangar/i.test(name)) return false;
        return !isSystemDestroyed(ship, s.id);
    });
}

export function operationalMinelayers(ship: ShipGameState): ShipSystemEntry[] {
    return listShipSystems(ship).filter((s) => {
        const name = s.name ?? "";
        const type = (s.type ?? "").toLowerCase();
        if (!MINELAYER_NAMES.has(name) && name !== "minelayer" && type !== "minelayer")
            return false;
        return !isSystemDestroyed(ship, s.id);
    });
}

export function operationalMineSweepers(ship: ShipGameState): ShipSystemEntry[] {
    return listShipSystems(ship).filter((s) => {
        if ((s.name ?? "") !== "mineSweeper") return false;
        return !isSystemDestroyed(ship, s.id);
    });
}

export function minelayerMagazineRemaining(
    ship: ShipGameState,
    systemId: string
): number {
    return ammunitionRemaining(ship, systemId);
}

export function hangarCapacity(ship: ShipGameState): number {
    const hangars = operationalHangars(ship);
    if (hangars.length === 0) return 0;
    return hangars.reduce((sum, h) => sum + (typeof h.fighters === "number" ? h.fighters : 6), 0);
}

export function isFireControlSystem(sys: ShipSystemEntry): boolean {
    return (sys.name ?? "") === "fireControl";
}

export function operationalFireControls(ship: ShipGameState): ShipSystemEntry[] {
    return listShipSystems(ship).filter(
        (s) => isFireControlSystem(s) && !isSystemDestroyed(ship, s.id)
    );
}

/** All fire-control modules on the SSD (including destroyed). */
export function installedFireControls(ship: ShipGameState): ShipSystemEntry[] {
    return listShipSystems(ship).filter((s) => isFireControlSystem(s));
}

/** Fire control that is not damaged or destroyed — required to assign targets. */
export function functionalFireControls(ship: ShipGameState): ShipSystemEntry[] {
    return installedFireControls(ship).filter(
        (s) => !isSystemDamagedOrDestroyed(ship, s.id)
    );
}

export function shipRequiresFireControl(ship: ShipGameState): boolean {
    return installedFireControls(ship).length > 0;
}

/** Weapon mounts from SSD weapons/ordnance lists (not fire control or other systems). */
export function weaponEntries(ship: ShipGameState): ShipSystemEntry[] {
    const obj = ship.object as { ordnance?: ShipSystemEntry[]; weapons?: ShipSystemEntry[] };
    return [...(obj.weapons ?? []), ...(obj.ordnance ?? [])].filter(
        (s) => !isSystemDestroyed(ship, s.id)
    );
}

export function isPdsWeapon(sys: ShipSystemEntry): boolean {
    const name = (sys.name ?? "").toLowerCase();
    return (
        name === "pds" ||
        name === "ads" ||
        name === "grapeshot" ||
        name === "scattergun" ||
        name === "gatling" ||
        name === "particle" ||
        name === "tpa" ||
        name === "pulser" ||
        name === "meson"
    );
}

export function isAreaDefenseFireControl(sys: ShipSystemEntry): boolean {
    const name = (sys.name ?? "").toLowerCase();
    return name === "adfc" || name === "aadfc";
}

export function scattergunHasBuiltInAdfc(sys: ShipSystemEntry): boolean {
    return (sys.name ?? "").toLowerCase() === "scattergun";
}

export function isBeam1Capable(sys: ShipSystemEntry): boolean {
    const name = (sys.name ?? "").toLowerCase();
    if (name !== "beam" && name !== "emp") return false;
    const cls = Number(sys.class);
    return Number.isFinite(cls) ? cls === 1 : false;
}

export function isK1Capable(sys: ShipSystemEntry): boolean {
    return (sys.name ?? "").toLowerCase() === "kgun" && Number(sys.class) === 1;
}

/** Mounts that may fire point defense (once per turn each). */
export function operationalPointDefenseMounts(ship: ShipGameState): ShipSystemEntry[] {
    return weaponEntries(ship).filter((s) => {
        const name = (sysName(s)).toLowerCase();
        if (isSystemDestroyed(ship, s.id)) return false;
        if (isPdsWeapon(s)) return true;
        if (isBeam1Capable(s)) return true;
        if (isK1Capable(s)) return true;
        if (name === "adfc") return true;
        return false;
    });
}

function sysName(s: ShipSystemEntry): string {
    return s.name ?? "";
}

export function operationalAreaDefenseFireControl(ship: ShipGameState): ShipSystemEntry[] {
    return listShipSystems(ship).filter(
        (s) => isAreaDefenseFireControl(s) && !isSystemDestroyed(ship, s.id)
    );
}

export function shipHasAadfc(ship: ShipGameState): boolean {
    return operationalAreaDefenseFireControl(ship).some(
        (s) => (s.name ?? "").toLowerCase() === "aadfc"
    );
}

export function adfcSupportSlotCount(ship: ShipGameState): number {
    if (shipHasAadfc(ship)) return Number.POSITIVE_INFINITY;
    return operationalAreaDefenseFireControl(ship).filter(
        (s) => (s.name ?? "").toLowerCase() === "adfc"
    ).length + weaponEntries(ship).filter((s) => scattergunHasBuiltInAdfc(s)).length;
}

export function operationalPdsEntries(ship: ShipGameState): ShipSystemEntry[] {
    return weaponEntries(ship).filter((s) => isPdsWeapon(s) || (s.name ?? "") === "adfc");
}

/** Non-PDS weapons for phase 11 ship fire (beam, plasma, SAP, AP, needle, …). */
export function shipFireWeaponEntries(ship: ShipGameState): ShipSystemEntry[] {
    return weaponEntries(ship).filter(
        (s) =>
            canOperateAsShipFire(s) &&
            !isAreaDefenseFireControl(s) &&
            (s.name ?? "") !== "adfc"
    );
}

export function findWeaponEntry(
    ship: ShipGameState,
    systemId: string
): ShipSystemEntry | undefined {
    return weaponEntries(ship).find((s) => s.id === systemId);
}

export function shipHasOperationalWeapons(ship: ShipGameState): boolean {
    return weaponEntries(ship).length > 0;
}

export function ordnanceSystemIds(ship: ShipGameState): string[] {
    const obj = ship.object as { ordnance?: ShipSystemEntry[]; weapons?: ShipSystemEntry[] };
    return [...(obj.ordnance ?? []), ...(obj.weapons ?? [])].map((s) => s.id);
}

const ORDNANCE_TYPE_HINTS: Record<string, RegExp> = {
    missile: /missile|twostage/i,
    salvo: /salvo/i,
    salvoER: /missile|twostage/i,
    salvoMS: /salvo|twostage/i,
    amt: /amt/i,
    plasmaBolt: /plasma|pbl/i,
    mine: /minelayer|mine/i,
    rocket: /rocket/i,
};

export function ordnanceTypeMatchesSystem(
    ordnanceType: string,
    sys: ShipSystemEntry
): boolean {
    const hint = ORDNANCE_TYPE_HINTS[ordnanceType];
    if (!hint) return true;
    const label = `${sys.name ?? ""} ${sys.type ?? ""} ${sys.id}`;
    return hint.test(label);
}

export function shipThrust(ship: ShipGameState): number {
    const obj = ship.object as { thrust?: number };
    if (typeof obj.thrust === "number" && obj.thrust > 0) {
        return obj.thrust;
    }

    let total = 0;
    let driveCount = 0;
    for (const sys of listShipSystems(ship)) {
        const name = (sys.name ?? "").toLowerCase();
        if (name !== "drive") continue;
        driveCount += 1;
        if (isSystemDestroyed(ship, sys.id)) continue;

        const base = Number(sys.thrust);
        if (!Number.isFinite(base) || base <= 0) continue;

        const state = ship.systems?.find((s) => s.id === sys.id)?.state;
        total += state === "damaged" ? Math.floor(base / 2) : base;
    }

    if (driveCount > 0) return total;
    return 4;
}

/** Defender crew available for boarding combat (phase 12). */
export function shipBoardingCrewCapacity(ship: ShipGameState): {
    marines: number;
    dcpPool: number;
} {
    const avail = dcpAvailabilityForShip(ship);
    return {
        marines: availableMarineIds(ship).length,
        dcpPool: avail.available,
    };
}