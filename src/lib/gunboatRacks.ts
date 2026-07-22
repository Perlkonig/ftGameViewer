/** Bridge game ship gunboat rack / boat bay state to ftLibShip gunboat API. */

import type { FullThrustGamePosition } from "@/schemas/position";
import type { FullThrustShip } from "ftlibship";
import {
    clearBoatBay,
    deploySquadronFromRack,
    gunboatSquadronsOnRacks,
    gunboatsInBoatBays,
    recoverSquadronInBoatBay,
    recoverSquadronOnRack,
    resolveBoatBayOccupancy,
    resolveRackOccupancy,
    squadronKey,
    type BoatBayState,
    type GunboatRackState,
    type ResolvedBoat,
    type ResolvedBoatBayOccupancy,
    type ResolvedRackOccupancy,
} from "ftlibship";

export {
    clearBoatBay,
    deploySquadronFromRack,
    gunboatSquadronsOnRacks,
    gunboatsInBoatBays,
    recoverSquadronInBoatBay,
    recoverSquadronOnRack,
    resolveBoatBayOccupancy,
    resolveRackOccupancy,
    squadronKey,
    type BoatBayState,
    type GunboatRackState,
    type ResolvedBoat,
    type ResolvedBoatBayOccupancy,
    type ResolvedRackOccupancy,
};

type GunboatObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "gunboats" }
>;

type ShipObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "ship" }
> & { gunboatRacks?: GunboatRackState; boatBays?: BoatBayState };

export function shipGunboatRackState(ship: ShipObj): GunboatRackState {
    return ship.gunboatRacks ?? {};
}

export function shipBoatBayState(ship: ShipObj): BoatBayState {
    return ship.boatBays ?? {};
}

export function mapTokenIdForSquadron(shipId: string, key: string): string {
    return `${shipId}_${key}`;
}

export function dockedGunboatsOnShip(
    position: FullThrustGamePosition,
    shipId: string
): GunboatObj[] {
    return (position.objects ?? []).filter((o): o is GunboatObj => {
        if (o.objType !== "gunboats") return false;
        const pos = o.position;
        return (
            pos !== null &&
            typeof pos === "object" &&
            "ship" in pos &&
            pos.ship === shipId
        );
    });
}

export function launchableFromRack(
    ship: ShipObj,
    position: FullThrustGamePosition
): ResolvedRackOccupancy[] {
    const ssd = ship.object as FullThrustShip;
    const racks = shipGunboatRackState(ship);
    const docked = dockedGunboatsOnShip(position, ship.id);
    return gunboatSquadronsOnRacks(ssd, racks).filter((r) => {
        if (!r.occupied || r.deployed) return false;
        const tokenId = mapTokenIdForSquadron(ship.id, r.squadronKey ?? r.rackId);
        return docked.some((d) => {
            const pos = d.position;
            return (
                pos &&
                typeof pos === "object" &&
                "rack" in pos &&
                pos.rack === r.rackId
            );
        });
    });
}

export function launchableFromBay(ship: ShipObj): ResolvedBoatBayOccupancy[] {
    const ssd = ship.object as FullThrustShip;
    const bays = shipBoatBayState(ship);
    return gunboatsInBoatBays(ssd, bays).filter((b) => b.occupied);
}

export function initialGunboatRackStateFromDesign(_ssd: FullThrustShip): GunboatRackState {
    return {};
}

export function squadronDisplayType(boatTypes: string[]): string {
    if (boatTypes.length === 0) return "gunboat";
    const unique = [...new Set(boatTypes)];
    if (unique.length === 1) return unique[0]!;
    return "mixed";
}

export function boatsFromGunboatObj(obj: GunboatObj): ResolvedBoat[] {
    const boats = (obj as { boats?: ResolvedBoat[] }).boats;
    if (boats && boats.length > 0) return boats;
    const n = obj.number ?? 6;
    const t = obj.type ?? "beam";
    return Array.from({ length: n }, () => ({ type: t as ResolvedBoat["type"] }));
}
