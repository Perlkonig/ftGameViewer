/** Bridge game ship hangar state to ftLibShip hangar API. */

import type { FullThrustGamePosition } from "@/schemas/position";
import type { FullThrustShip } from "ftlibship";
import {
    deployFighterFromHangar,
    dockFighterInHangar,
    fighterSquadrons,
    resolveHangarOccupancy,
    type FighterSkill,
    type HangarState,
    type ResolvedHangarOccupancy,
} from "ftlibship";
import type { ShipGameState } from "@/lib/game/shipSystems";

export {
    deployFighterFromHangar,
    dockFighterInHangar,
    fighterSquadrons,
    resolveHangarOccupancy,
    type HangarState,
    type ResolvedHangarOccupancy,
    type FighterSkill,
};

type FighterObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "fighters" }
>;

type ShipObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "ship" }
> & { hangars?: HangarState };

export function shipHangarState(ship: ShipObj): HangarState {
    return (ship as { hangars?: HangarState }).hangars ?? {};
}

export function dockedWingsOnShip(
    position: FullThrustGamePosition,
    shipId: string
): FighterObj[] {
    return (position.objects ?? []).filter((o): o is FighterObj => {
        if (o.objType !== "fighters") return false;
        const pos = o.position;
        return (
            pos !== null &&
            typeof pos === "object" &&
            "ship" in pos &&
            pos.ship === shipId
        );
    });
}

export function launchableWings(
    ship: ShipGameState,
    position: FullThrustGamePosition
): ResolvedHangarOccupancy[] {
    const docked = dockedWingsOnShip(position, ship.id);
    const ssd = ship.object as FullThrustShip;
    const hangars = shipHangarState(ship as ShipObj);
    const squadrons = fighterSquadrons(ssd, hangars);
    return squadrons.filter((s) => {
        if (!s.occupied || s.deployed) return false;
        return docked.some((d) => {
            const pos = d.position;
            return (
                pos &&
                typeof pos === "object" &&
                "hangar" in pos &&
                pos.hangar === s.hangarId
            );
        });
    });
}

export function defaultWingEndurance(_type?: string): number {
    return 6;
}

export function wingIdForHangar(shipId: string, hangarId: string): string {
    return `${shipId}_${hangarId}`;
}

export function initialHangarStateFromDesign(ssd: FullThrustShip): HangarState {
    const hangars: HangarState = {};
    for (const squad of ssd.fighters ?? []) {
        if (!squad.hangar) continue;
        hangars[squad.hangar] = {
            type: squad.type ?? "standard",
            ...(squad.number !== undefined ? { number: squad.number } : {}),
            ...(squad.skill ? { skill: squad.skill as FighterSkill } : {}),
        };
    }
    return hangars;
}
