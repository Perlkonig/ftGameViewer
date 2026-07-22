/** FTL gunboat / fighter map placement at placeShip (9 MU / 6 MU). */

import type { FullThrustShip } from "ftlibship";
import { squadronKey as designSquadronKey } from "ftlibship";
import { mapTokenIdForSquadron } from "@/lib/gunboatRacks";
import { wingIdForHangar } from "@/lib/hangars";
import { gunboatIsFtl, fighterIsFtl } from "./gunboatPlace";
import { distance } from "./movement";
import { SeededDice } from "./dice";
import { gunboatTypeLabel } from "./gunboatLabel";

export const FTL_GUNBOAT_PLACE_RADIUS_MU = 9;
export const FTL_FIGHTER_PLACE_RADIUS_MU = 6;

export type FtlDeployEntry = {
    objType: "fighters" | "gunboats";
    id: string;
    label: string;
    radiusMu: number;
    endurance?: number;
    /** FTL fighters (always in hangar/rack): optional immediate deploy. FTL gunboats without rack: required. */
    optional?: boolean;
};

export function ftlSquadronsNeedingDeployment(
    shipId: string,
    ssd: FullThrustShip
): FtlDeployEntry[] {
    const out: FtlDeployEntry[] = [];
    for (const squadron of ssd.gunboatSquadrons ?? []) {
        if (squadron.rack) continue;
        if (!gunboatIsFtl(squadron)) continue;
        const key = designSquadronKey(squadron) ?? squadron.id;
        if (!key) continue;
        const tokenId = mapTokenIdForSquadron(shipId, key);
        const types = squadron.boats?.map((b) => b.type) ?? [];
        const typeLabel =
            types.length === 1 ? gunboatTypeLabel(types[0]) : `mixed ×${types.length}`;
        out.push({
            objType: "gunboats",
            id: tokenId,
            label: `FTL gunboats (${typeLabel})`,
            radiusMu: FTL_GUNBOAT_PLACE_RADIUS_MU,
            endurance: squadron.endurance ?? 6,
            optional: false,
        });
    }
    (ssd.fighters ?? []).forEach((wing) => {
        if (!fighterIsFtl(wing)) return;
        if (!wing.hangar) return;
        const wingId = wingIdForHangar(shipId, wing.hangar);
        out.push({
            objType: "fighters",
            id: wingId,
            label: `FTL fighters (${wing.type ?? "standard"} ×${wing.number ?? 6}, ${wing.hangar}) — deploy now? (optional, 5 endurance)`,
            radiusMu: FTL_FIGHTER_PLACE_RADIUS_MU,
            endurance: 5,
            optional: true,
        });
    });
    return out;
}

/** Uniform random point in disk of radiusMu (reproducible). */
export function randomDeployedOffset(
    shipId: string,
    squadId: string,
    radiusMu: number
): { x: number; y: number } {
    const dice = new SeededDice(`${shipId}:${squadId}:ftlPlace`);
    const u = (dice.next() - 1) / 5;
    const v = (dice.next() - 1) / 5;
    const r = Math.sqrt(u) * radiusMu;
    const theta = v * 2 * Math.PI;
    return { x: r * Math.cos(theta), y: r * Math.sin(theta) };
}

export function worldPositionFromShip(
    shipPos: { x: number; y: number },
    offset: { x: number; y: number }
): { x: number; y: number } {
    return { x: shipPos.x + offset.x, y: shipPos.y + offset.y };
}

export function validateFtlDeployDistance(
    shipPos: { x: number; y: number },
    deployPos: { x: number; y: number },
    radiusMu: number
): string | undefined {
    const d = distance(shipPos, deployPos);
    if (d > radiusMu + 0.05) {
        return `Position is ${d.toFixed(1)} MU from ship (max ${radiusMu} MU).`;
    }
    return undefined;
}

export function autoDeployedSquadrons(
    shipId: string,
    shipPos: { x: number; y: number },
    entries: FtlDeployEntry[],
    shipFacing: number
): Array<{
    objType: "fighters" | "gunboats";
    id: string;
    position: { x: number; y: number };
    endurance?: number;
    facing?: number;
    callsign?: string;
}> {
    return entries.map((e) => {
        const off = randomDeployedOffset(shipId, e.id, e.radiusMu);
        const position = worldPositionFromShip(shipPos, off);
        return {
            objType: e.objType,
            id: e.id,
            position,
            endurance: e.endurance,
            facing: shipFacing,
        };
    });
}
