/** PDS / ADS gunboat squadrons in phase 9 point defense (area defense for nearby friendlies). */

import type { FullThrustGamePosition } from "@/schemas/position";
import type { PointDefenseDeclaration } from "./pointDefensePhase9";
import type { ShipSystemEntry } from "./shipSystems";
import { isDeployedGunboat } from "./gunboatMove";
import { distance } from "./movement";
import type { ValidationIssue } from "./commandValidation";

export const GUNBOAT_AREA_DEFENSE_RANGE_MU = 6;

type GunboatObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "gunboats" }
>;

export function gunboatBoatType(boat: { type?: string }): string {
    return (boat.type ?? "").toLowerCase();
}

export function isPointDefenseGunboatType(type: string): boolean {
    const t = type.toLowerCase();
    return t === "pointdefense" || t === "pds";
}

export function isAdsGunboatType(type: string): boolean {
    return type.toLowerCase() === "ads";
}

export function gunboatSquadronProvidesAreaDefense(gunboat: {
    type?: string;
    boats?: { type?: string }[];
}): boolean {
    const types = gunboat.boats?.length
        ? gunboat.boats.map((b) => gunboatBoatType(b))
        : [gunboatBoatType({ type: gunboat.type })];
    return types.some((t) => isPointDefenseGunboatType(t) || isAdsGunboatType(t));
}

export function findGunboatSquadron(
    position: FullThrustGamePosition,
    id: string
): GunboatObj | undefined {
    const obj = position.objects?.find((o) => o.id === id);
    if (!obj || obj.objType !== "gunboats") return undefined;
    return obj as GunboatObj;
}

export function isGunboatPointDefenseDefender(
    position: FullThrustGamePosition,
    defenderId: string
): boolean {
    const g = findGunboatSquadron(position, defenderId);
    return !!g && isDeployedGunboat(g) && gunboatSquadronProvidesAreaDefense(g);
}

export function deployedPdGunboatsForOwner(
    position: FullThrustGamePosition,
    owner: string
): GunboatObj[] {
    return (position.objects ?? []).filter(
        (o): o is GunboatObj =>
            o.objType === "gunboats" &&
            o.owner === owner &&
            isDeployedGunboat(o) &&
            gunboatSquadronProvidesAreaDefense(o)
    );
}

function liveBoats(gunboat: GunboatObj): { type: string; id?: string }[] {
    const n = gunboat.number ?? 6;
    const boats = gunboat.boats ?? [];
    if (boats.length > 0) return boats.slice(0, n);
    const squadType = gunboat.type ?? "beam";
    return Array.from({ length: n }, (_, i) => ({ type: squadType, id: `${gunboat.id}-b${i}` }));
}

/** Synthetic PD mounts for a gunboat squadron (2× PDS per point-defense boat, 1× ADS per ADS boat). */
export function operationalGunboatPdMounts(gunboat: GunboatObj): ShipSystemEntry[] {
    const mounts: ShipSystemEntry[] = [];
    for (const boat of liveBoats(gunboat)) {
        const t = gunboatBoatType(boat);
        const boatKey = boat.id ?? `${gunboat.id}-${mounts.length}`;
        if (isPointDefenseGunboatType(t)) {
            mounts.push(
                { id: `${gunboat.id}:pds:${boatKey}:0`, name: "pds" },
                { id: `${gunboat.id}:pds:${boatKey}:1`, name: "pds" }
            );
        } else if (isAdsGunboatType(t)) {
            mounts.push({ id: `${gunboat.id}:ads:${boatKey}`, name: "ads" });
        }
    }
    return mounts;
}

export function remainingGunboatPdMounts(
    gunboat: GunboatObj,
    existing: PointDefenseDeclaration[],
    defenderGunboatId: string
): ShipSystemEntry[] {
    const used = new Set(
        existing
            .filter((d) => d.defenderShip === defenderGunboatId)
            .map((d) => d.weapon)
    );
    return operationalGunboatPdMounts(gunboat).filter((m) => m.id && !used.has(m.id));
}

export function gunboatPointDefenseSupportIssues(
    position: FullThrustGamePosition,
    defenderGunboatId: string,
    supportedShipId: string,
    existing: PointDefenseDeclaration[] = []
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const gunboat = findGunboatSquadron(position, defenderGunboatId);
    if (!gunboat) {
        issues.push({
            message: `Defending gunboat squadron ${defenderGunboatId} not found.`,
            severity: "error",
        });
        return issues;
    }
    if (!isDeployedGunboat(gunboat)) {
        issues.push({
            message: `${defenderGunboatId} is not deployed on the map.`,
            severity: "error",
        });
        return issues;
    }
    if (!gunboatSquadronProvidesAreaDefense(gunboat)) {
        issues.push({
            message: `${defenderGunboatId} is not a PDS or ADS gunboat squadron — cannot provide area defense.`,
            severity: "warning",
        });
    }

    const supported = position.objects?.find(
        (o) => o.id === supportedShipId && o.objType === "ship"
    );
    if (!supported) {
        issues.push({
            message: `Supported ship ${supportedShipId} not found.`,
            severity: "error",
        });
        return issues;
    }

    if (gunboat.owner && supported.owner && gunboat.owner !== supported.owner) {
        issues.push({
            message: `${defenderGunboatId} may only defend allied ships (${supportedShipId} is ${supported.owner}).`,
            severity: "warning",
        });
    }

    if (gunboat.position && supported.position) {
        const sep = distance(gunboat.position, supported.position);
        if (sep > GUNBOAT_AREA_DEFENSE_RANGE_MU) {
            issues.push({
                message: `${supportedShipId} must be within ${GUNBOAT_AREA_DEFENSE_RANGE_MU} MU of ${defenderGunboatId} for gunboat area defense (currently ${Math.round(sep)} MU).`,
                severity: "warning",
            });
        }
    } else {
        issues.push({
            message: `Cannot verify range between ${defenderGunboatId} and ${supportedShipId} for gunboat area defense.`,
            severity: "warning",
        });
    }

    const allySupport = existing.filter(
        (d) =>
            d.defenderShip === defenderGunboatId &&
            d.supportedShip !== defenderGunboatId
    );
    const otherAlly = allySupport.find((d) => d.supportedShip !== supportedShipId);
    if (otherAlly) {
        issues.push({
            message: `Gunboat area defense on ${defenderGunboatId} may only cover one allied ship per turn (already supporting ${otherAlly.supportedShip}).`,
            severity: "warning",
        });
    }

    return issues;
}
