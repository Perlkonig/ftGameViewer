/** Per-ship crew deployment state for ftLibShip IDcpState / dcpAvailability. */

import type { FullThrustShip } from "ftlibship";
import { dcpAvailability, type IDcpAvailability, type IDcpState } from "ftlibship";
import { listShipSystems, type ShipGameState } from "./shipSystems";

export interface CrewDeployment {
    deployed?: string[];
    deployedBuiltinDcp?: number;
}

export type ShipWithCrewDeployment = ShipGameState & {
    dmgHull?: number;
    crewDeployment?: CrewDeployment;
};

const MARINE_NAME = /^marines?$/i;
const DCP_NAME = /^damagecontrol|damage.?control|dcp$/i;

function systemState(ship: ShipWithCrewDeployment, id: string): string | undefined {
    return ship.systems?.find((s) => s.id === id)?.state;
}

function isLost(ship: ShipWithCrewDeployment, id: string): boolean {
    const state = systemState(ship, id);
    return state === "damaged" || state === "destroyed";
}

function deployedSet(ship: ShipWithCrewDeployment): Set<string> {
    return new Set(ship.crewDeployment?.deployed ?? []);
}

function ensureDeployment(ship: ShipWithCrewDeployment): CrewDeployment {
    if (!ship.crewDeployment) ship.crewDeployment = {};
    if (!ship.crewDeployment.deployed) ship.crewDeployment.deployed = [];
    return ship.crewDeployment;
}

function shipDesign(ship: ShipWithCrewDeployment): FullThrustShip {
    return ship.object as FullThrustShip;
}

function isMarineSystem(entry: { name?: string; id: string }): boolean {
    return MARINE_NAME.test(entry.name ?? "");
}

function isDcpSystem(entry: { name?: string; id: string }): boolean {
    return DCP_NAME.test(entry.name ?? "") || (entry.name ?? "").toLowerCase() === "damagecontrol";
}

/** Map game ship state to ftLibShip IDcpState for rendering and availability. */
export function buildDcpState(ship: ShipWithCrewDeployment): IDcpState {
    const disabled: string[] = [];
    const destroyed: string[] = [];
    for (const s of ship.systems ?? []) {
        if (s.state === "damaged") disabled.push(s.id);
        else if (s.state === "destroyed") destroyed.push(s.id);
    }
    const dep = ship.crewDeployment;
    return {
        damage: Number(ship.dmgHull ?? 0) || undefined,
        disabled: disabled.length ? disabled : undefined,
        destroyed: destroyed.length ? destroyed : undefined,
        deployed: dep?.deployed?.length ? [...dep.deployed] : undefined,
        deployedBuiltinDcp: dep?.deployedBuiltinDcp,
    };
}

export function dcpAvailabilityForShip(ship: ShipWithCrewDeployment): IDcpAvailability {
    return dcpAvailability(shipDesign(ship), buildDcpState(ship));
}

export function availableMarineIds(ship: ShipWithCrewDeployment): string[] {
    const absent = deployedSet(ship);
    return listShipSystems(ship)
        .filter((s) => isMarineSystem(s) && !isLost(ship, s.id) && !absent.has(s.id))
        .map((s) => s.id)
        .sort();
}

export function availableHiredDcpIds(ship: ShipWithCrewDeployment): string[] {
    const absent = deployedSet(ship);
    return listShipSystems(ship)
        .filter((s) => isDcpSystem(s) && !isLost(ship, s.id) && !absent.has(s.id))
        .map((s) => s.id)
        .sort();
}

export function availableBuiltinDcp(ship: ShipWithCrewDeployment): number {
    return dcpAvailabilityForShip(ship).builtin;
}

export interface DeploymentAllocation {
    marineIds: string[];
    dcpIds: string[];
    builtinDcp: number;
}

export interface DeploymentRequest {
    marines?: number;
    hiredDcp?: number;
    builtinDcp?: number;
    marineIds?: string[];
    dcpIds?: string[];
}

/** Mark crew absent on source ship when boarding another ship. */
export function allocateDeployment(
    ship: ShipWithCrewDeployment,
    req: DeploymentRequest
): DeploymentAllocation {
    const dep = ensureDeployment(ship);
    const marineCount = Math.max(0, Math.floor(req.marines ?? 0));
    const dcpCount = Math.max(0, Math.floor(req.hiredDcp ?? 0));
    const builtinCount = Math.max(0, Math.floor(req.builtinDcp ?? 0));

    let marineIds = req.marineIds ? [...req.marineIds] : [];
    let dcpIds = req.dcpIds ? [...req.dcpIds] : [];

    if (marineIds.length === 0 && marineCount > 0) {
        marineIds = availableMarineIds(ship).slice(0, marineCount);
    }
    if (dcpIds.length === 0 && dcpCount > 0) {
        dcpIds = availableHiredDcpIds(ship).slice(0, dcpCount);
    }

    const deployed = new Set(dep.deployed);
    for (const id of marineIds) deployed.add(id);
    for (const id of dcpIds) deployed.add(id);
    dep.deployed = [...deployed];

    const maxBuiltin = availableBuiltinDcp(ship);
    const builtinAllocated = Math.min(builtinCount, maxBuiltin);
    dep.deployedBuiltinDcp = (dep.deployedBuiltinDcp ?? 0) + builtinAllocated;

    return { marineIds, dcpIds, builtinDcp: builtinAllocated };
}

/** Reverse deployment when crew returns (foundation: partial release). */
export function releaseDeployment(
    ship: ShipWithCrewDeployment,
    release: { marineIds?: string[]; dcpIds?: string[]; builtinDcp?: number }
): void {
    const dep = ship.crewDeployment;
    if (!dep) return;

    const remove = new Set([...(release.marineIds ?? []), ...(release.dcpIds ?? [])]);
    if (remove.size && dep.deployed) {
        dep.deployed = dep.deployed.filter((id) => !remove.has(id));
    }
    const builtinRelease = Math.max(0, Math.floor(release.builtinDcp ?? 0));
    if (builtinRelease > 0) {
        dep.deployedBuiltinDcp = Math.max(0, (dep.deployedBuiltinDcp ?? 0) - builtinRelease);
    }
    if (!dep.deployed?.length && !dep.deployedBuiltinDcp) {
        delete ship.crewDeployment;
    }
}

/** Boarder casualties: remove from deployed and mark systems destroyed. */
export function syncDeploymentCasualties(
    ship: ShipWithCrewDeployment,
    casualties: { marineIds?: string[]; dcpIds?: string[]; builtinDcp?: number }
): void {
    const marineIds = casualties.marineIds ?? [];
    const dcpIds = casualties.dcpIds ?? [];
    const builtin = Math.max(0, Math.floor(casualties.builtinDcp ?? 0));

    releaseDeployment(ship, { marineIds, dcpIds, builtinDcp: builtin });

    if (!ship.systems) ship.systems = [];
    for (const id of [...marineIds, ...dcpIds]) {
        const existing = ship.systems.find((s) => s.id === id);
        if (existing) existing.state = "destroyed";
        else ship.systems.push({ id, state: "destroyed" });
    }
}

/** Pick deployed system ids to treat as casualties (FIFO within deployed list). */
export function casualtyIdsFromDeployed(
    ship: ShipWithCrewDeployment,
    counts: { marines: number; hiredDcp: number; builtinDcp?: number }
): { marineIds: string[]; dcpIds: string[]; builtinDcp: number } {
    const marineIds: string[] = [];
    const dcpIds: string[] = [];
    const deployed = ship.crewDeployment?.deployed ?? [];
    for (const id of deployed) {
        const entry = listShipSystems(ship).find((s) => s.id === id);
        if (!entry) continue;
        if (isMarineSystem(entry) && marineIds.length < counts.marines) marineIds.push(id);
        else if (isDcpSystem(entry) && dcpIds.length < counts.hiredDcp) dcpIds.push(id);
    }
    const builtinDcp = Math.min(
        Math.max(0, counts.builtinDcp ?? 0),
        ship.crewDeployment?.deployedBuiltinDcp ?? 0
    );
    return { marineIds, dcpIds, builtinDcp };
}

export interface BoarderCommandDeploy {
    fromShip?: string;
    marines?: number;
    dcp?: number;
    deployMarineIds?: string[];
    deployDcpIds?: string[];
    deployBuiltinDcp?: number;
    removedUnits?: import("./boardingState").BoarderUnit[];
}

/** Apply crew deployment side effects after boarder state changes on defender. */
export function applyBoarderDeploymentEffects(
    position: { objects?: { id: string; objType: string }[] },
    defender: ShipWithCrewDeployment & { boarders?: import("./boardingState").ShipBoarders },
    owner: string,
    deploy: BoarderCommandDeploy,
    deltas: { marines: number; dcp: number; builtinDcp?: number }
): void {
    const units = defender.boarders?.units?.filter((u) => u.owner === owner) ?? [];
    const fromShipId = deploy.fromShip ?? units[0]?.fromShip;
    if (!fromShipId) return;

    const source = position.objects?.find((o) => o.id === fromShipId && o.objType === "ship") as
        | ShipWithCrewDeployment
        | undefined;
    if (!source) return;

    const marineDelta = deltas.marines;
    const dcpDelta = deltas.dcp;
    const builtinDelta = deltas.builtinDcp ?? 0;

    if (marineDelta > 0 || dcpDelta > 0 || builtinDelta > 0) {
        allocateDeployment(source, {
            marines: marineDelta > 0 ? marineDelta : undefined,
            hiredDcp: dcpDelta > 0 ? dcpDelta : undefined,
            builtinDcp: builtinDelta > 0 ? builtinDelta : undefined,
            marineIds: deploy.deployMarineIds,
            dcpIds: deploy.deployDcpIds,
        });
    }

    if (deploy.removedUnits?.length) {
        const marineIds = deploy.removedUnits
            .filter((u) => u.type === "marine" && u.sourceMarineId)
            .map((u) => u.sourceMarineId!);
        const dcpIds = deploy.removedUnits
            .filter((u) => u.type === "dcp" && u.sourceDcpId)
            .map((u) => u.sourceDcpId!);
        const builtinDcp = deploy.removedUnits.filter(
            (u) => u.type === "dcp" && u.sourceBuiltinDcp
        ).length;
        if (marineIds.length || dcpIds.length || builtinDcp) {
            syncDeploymentCasualties(source, { marineIds, dcpIds, builtinDcp });
        } else if (marineDelta < 0 || dcpDelta < 0 || builtinDelta < 0) {
            const ids = casualtyIdsFromDeployed(source, {
                marines: Math.max(0, -marineDelta),
                hiredDcp: Math.max(0, -dcpDelta),
                builtinDcp: builtinDelta < 0 ? -builtinDelta : 0,
            });
            syncDeploymentCasualties(source, ids);
        }
    } else if (marineDelta < 0 || dcpDelta < 0 || builtinDelta < 0) {
        const ids = casualtyIdsFromDeployed(source, {
            marines: Math.max(0, -marineDelta),
            hiredDcp: Math.max(0, -dcpDelta),
            builtinDcp: builtinDelta < 0 ? -builtinDelta : 0,
        });
        syncDeploymentCasualties(source, ids);
    }
}

export function undeploySystem(ship: ShipWithCrewDeployment, systemId: string): void {
    const dep = ship.crewDeployment;
    if (!dep?.deployed?.length) return;
    dep.deployed = dep.deployed.filter((id) => id !== systemId);
    if (!dep.deployed.length && !dep.deployedBuiltinDcp) {
        delete ship.crewDeployment;
    }
}
