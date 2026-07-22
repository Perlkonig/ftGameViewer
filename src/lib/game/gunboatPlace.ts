import type { FullThrustShip } from "ftlibship";
import { squadronKey as designSquadronKey } from "ftlibship";
import type { FullThrustGamePosition } from "@/schemas/position";
import { buildGunboatMapSymbol } from "@/lib/gunboatMarker";
import {
    boatsFromGunboatObj,
    mapTokenIdForSquadron,
    squadronDisplayType,
} from "@/lib/gunboatRacks";
import type { ResolvedBoat } from "ftlibship";
import { normalizeCallsign } from "./fighterLabel";

type GunboatObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "gunboats" }
>;

type DeployedSquadron = {
    objType: "fighters" | "gunboats";
    id: string;
    position: { x: number; y: number };
    endurance?: number;
    facing?: number;
    callsign?: string;
};

function squadronBoats(
    squadron: NonNullable<FullThrustShip["gunboatSquadrons"]>[number]
): ResolvedBoat[] {
    return squadron.boats.map((b) => ({
        type: b.type,
        ...(b.id !== undefined ? { id: b.id } : {}),
    }));
}

function squadronMeta(squadron: NonNullable<FullThrustShip["gunboatSquadrons"]>[number]) {
    const ftl = squadron.mods?.includes("ftl") ?? false;
    return {
        ftl,
        protection: squadron.protection,
        ecm: squadron.ecm ?? 0,
        endurance: squadron.endurance ?? 6,
    };
}

export function buildGunboatMapObject(
    shipId: string,
    owner: string,
    squadron: NonNullable<FullThrustShip["gunboatSquadrons"]>[number],
    opts: {
        position: GunboatObj["position"];
        facing?: number;
        endurance?: number;
        callsign?: string;
    }
): GunboatObj {
    const key = designSquadronKey(squadron) ?? squadron.id ?? "gb";
    const tokenId = mapTokenIdForSquadron(shipId, key);
    const boats = squadronBoats(squadron);
    const types = boats.map((b) => b.type);
    const sym = buildGunboatMapSymbol(tokenId, types);
    const meta = squadronMeta(squadron);
    const callsign = normalizeCallsign(opts.callsign);
    return {
        objType: "gunboats",
        id: tokenId,
        owner,
        squadronKey: key,
        type: squadronDisplayType(types),
        position: opts.position,
        facing: (opts.facing ?? 12) as GunboatObj["facing"],
        number: boats.length,
        endurance: opts.endurance ?? meta.endurance,
        skill: "standard",
        boats,
        protection: meta.protection,
        ecm: meta.ecm,
        ftl: meta.ftl,
        svg: sym.svg,
        ...(callsign ? { callsign } : {}),
    } as GunboatObj;
}

export function gunboatIsFtl(
    squadron: NonNullable<FullThrustShip["gunboatSquadrons"]>[number]
): boolean {
    return squadron.mods?.includes("ftl") ?? false;
}

export function placeGunboatSquadronsForShip(
    shipId: string,
    owner: string,
    ssd: FullThrustShip,
    shipFacing: number,
    deployedSquadrons: DeployedSquadron[] = []
): GunboatObj[] {
    const out: GunboatObj[] = [];
    for (const squadron of ssd.gunboatSquadrons ?? []) {
        const key = designSquadronKey(squadron) ?? squadron.id;
        if (!key) continue;
        const tokenId = mapTokenIdForSquadron(shipId, key);
        const ftl = gunboatIsFtl(squadron);
        const deployed = deployedSquadrons.find(
            (d) => d.objType === "gunboats" && d.id === tokenId
        );
        if (ftl || !squadron.rack) {
            if (!deployed) continue;
            out.push(
                buildGunboatMapObject(shipId, owner, squadron, {
                    position: deployed.position,
                    facing: deployed.facing ?? shipFacing,
                    endurance: deployed.endurance ?? 6,
                    callsign: deployed.callsign,
                })
            );
        } else {
            out.push(
                buildGunboatMapObject(shipId, owner, squadron, {
                    position: { ship: shipId, rack: squadron.rack },
                    facing: shipFacing,
                })
            );
        }
    }
    return out;
}

export function fighterIsFtl(
    wing: NonNullable<FullThrustShip["fighters"]>[number]
): boolean {
    return wing.mods?.includes("ftl") ?? false;
}

export { boatsFromGunboatObj };
