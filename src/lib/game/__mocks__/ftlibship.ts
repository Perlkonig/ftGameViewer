/** Test stub for ftlibship so Vitest does not load import-assertion syntax. */
export type FullThrustShip = Record<string, unknown>;
export type RenderOpts = Record<string, unknown>;

export enum EvalErrorCode {
    NoMass = "NOMASS",
    BadMass = "BADMASS",
    LowHull = "LOWHULL",
    OverMarine = "OVERMARINE",
    OverDCP = "OVERDCP",
    OverCrew = "OVERCREW",
    OverSpinal = "OVERSPINAL",
    OverTurret = "OVERTURRET",
    OverMass = "OVERMASS",
    OverPBL = "OVERPBL",
    DblUID = "DblUID",
    FlawedUnderMass = "FlawedUnderMass",
    UnknownSystem = "UNKNOWNSYSTEM",
}

export enum ValErrorCode {
    BadJSON = "BADJSON",
    BadConstruction = "BADCONSTRUCTION",
    PointsMismatch = "POINTSMISMATCH",
}

export interface IValidation {
    valid: boolean;
    code?: ValErrorCode;
    ajvErrors?: { dataPath?: string; instancePath?: string; message?: string }[];
    evalErrors?: EvalErrorCode[];
}

export function validate(json: string): IValidation {
    try {
        JSON.parse(json);
    } catch {
        return { valid: false, code: ValErrorCode.BadJSON };
    }
    return { valid: true };
}

export function renderSvg(_ship: FullThrustShip, _opts?: RenderOpts): string {
    return "<svg></svg>";
}

export {
    crewFactor,
    dcpAvailability,
    hullDcpGrid,
    type IDcpAvailability,
    type IDcpState,
} from "../../../../node_modules/ftlibship/dist/lib/crew.js";

export {
    resolveHangarOccupancy,
    dockFighterInHangar,
    deployFighterFromHangar,
    fighterSquadrons,
    HangarDockError,
    type HangarState,
    type HangarOccupancy,
    type ResolvedHangarOccupancy,
    type FighterSkill,
    type FighterType,
} from "../../../../node_modules/ftlibship/dist/lib/fighters.js";

export {
    resolveRackOccupancy,
    deploySquadronFromRack,
    recoverSquadronOnRack,
    gunboatSquadronsOnRacks,
    resolveBoatBayOccupancy,
    recoverSquadronInBoatBay,
    clearBoatBay,
    gunboatsInBoatBays,
    findSquadronByKey,
    squadronKey,
    GunboatRackError,
    type GunboatRackState,
    type GunboatRackOccupancy,
    type BoatBayState,
    type BoatBayOccupancy,
    type ResolvedRackOccupancy,
    type ResolvedBoatBayOccupancy,
    type ResolvedBoat,
    type GunboatType,
} from "../../../../node_modules/ftlibship/dist/lib/gunboats.js";

export {
    gunboatTypePoints,
    squadronPoints,
    type2name as gunboatType2Name,
    type2abbrev as gunboatType2Abbrev,
    gunboatSquadronInsertSvg,
} from "../../../../node_modules/ftlibship/dist/lib/systems/gunboats.js";

export * as systems from "../../../../node_modules/ftlibship/dist/lib/systems/index.js";

export type AmmunitionRemaining = Partial<Record<string, number>>;

export function resolveAmmunitionRemaining(
    capacity: number,
    uid: string,
    ammunition?: AmmunitionRemaining
): number {
    const raw = ammunition?.[uid];
    if (raw === undefined) return capacity;
    return Math.max(0, Math.min(capacity, raw));
}
