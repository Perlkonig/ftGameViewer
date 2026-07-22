/** Transporter beam delivery and commando raids (§5.9). */

import type { FullThrustGameCommand } from "@/schemas/commands";
import type { FullThrustGamePosition } from "@/schemas/position";
import type { RollSource } from "./dice";
import {
    allocateDeployment,
    applyBoarderDeploymentEffects,
    availableHiredDcpIds,
    availableMarineIds,
    dcpAvailabilityForShip,
    releaseDeployment,
    syncDeploymentCasualties,
    type ShipWithCrewDeployment,
} from "./crewDeployment";
import { addBoarderUnits, type ShipWithBoarders } from "./boardingState";
import { listShipSystems, type ShipGameState } from "./shipSystems";

export type TransporterDeliveryMode = "boarding" | "commando";

export interface TransporterDeliveryChoice {
    mode: TransporterDeliveryMode;
    payload: "marine" | "dcp";
    commandoSystemId?: string;
}

export interface TransporterFirerCapacity {
    marinesAvailable: number;
    dcpAvailable: number;
}

export function transporterFirerCapacity(firer: ShipWithCrewDeployment): TransporterFirerCapacity {
    return {
        marinesAvailable: availableMarineIds(firer).length,
        dcpAvailable: dcpAvailabilityForShip(firer).available,
    };
}

const COMMANDO_BLOCKED_NAMES =
    /^(stealth|biotech|suicide|antimatter|core|drive|ftl|life|reactor|bridge)/i;

export function isCommandoValidTarget(
    entry: { id: string; name?: string; type?: string },
    ship: ShipGameState
): boolean {
    const state = ship.systems?.find((s) => s.id === entry.id)?.state;
    if (state === "destroyed") return false;
    const n = (entry.name ?? "").toLowerCase();
    if (COMMANDO_BLOCKED_NAMES.test(n)) return false;
    if (n === "hull" || entry.type === "core") return false;
    return true;
}

export function commandoValidTargets(ship: ShipGameState): { id: string; label: string }[] {
    return listShipSystems(ship)
        .filter((e) => isCommandoValidTarget(e, ship))
        .map((e) => ({ id: e.id, label: e.name ?? e.id }));
}

/** Commando raid chart: 1=nothing; 2-3=killed; 4=retry 4+ or killed; 5=destroy+killed; 6=destroy+return */
export function resolveCommandoRaidRoll(
    roll: number,
    source: RollSource
): { systemDestroyed: boolean; marinesSurvive: boolean; rolls: number[] } {
    const rolls = [roll];
    if (roll === 1) return { systemDestroyed: false, marinesSurvive: true, rolls };
    if (roll <= 3) return { systemDestroyed: false, marinesSurvive: false, rolls };
    if (roll === 4) {
        const retry = source.next();
        rolls.push(retry);
        const survive = retry >= 4;
        return { systemDestroyed: false, marinesSurvive: survive, rolls };
    }
    if (roll === 5) return { systemDestroyed: true, marinesSurvive: false, rolls };
    return { systemDestroyed: true, marinesSurvive: true, rolls };
}

export interface TransporterDeliveryApplyResult {
    logCommands: FullThrustGameCommand[];
}

function findShipObj(position: FullThrustGamePosition, id: string) {
    return position.objects?.find((o) => o.id === id && o.objType === "ship");
}

/** Apply one transporter delivery slot (mutates position). */
export function applyTransporterDelivery(
    position: FullThrustGamePosition,
    firerShipId: string,
    targetShipId: string,
    attackerOwner: string,
    choice: TransporterDeliveryChoice,
    source: RollSource,
    turn?: number
): TransporterDeliveryApplyResult {
    const logCommands: FullThrustGameCommand[] = [];
    const firer = findShipObj(position, firerShipId) as ShipWithCrewDeployment | undefined;
    const target = findShipObj(position, targetShipId) as
        | (ShipWithBoarders & ShipWithCrewDeployment)
        | undefined;
    if (!firer || !target) return { logCommands };

    if (choice.mode === "boarding") {
        if (choice.payload === "marine") {
            const marineIds = availableMarineIds(firer).slice(0, 1);
            if (!marineIds.length) return { logCommands };
            addBoarderUnits(target, attackerOwner, [
                {
                    type: "marine",
                    fromShip: firerShipId,
                    boardedTurn: turn,
                    sourceMarineId: marineIds[0],
                },
            ]);
            applyBoarderDeploymentEffects(
                position,
                target,
                attackerOwner,
                { fromShip: firerShipId, deployMarineIds: marineIds },
                { marines: 1, dcp: 0 }
            );
        } else {
            const dcpIds = availableHiredDcpIds(firer).slice(0, 1);
            const builtin = dcpAvailabilityForShip(firer).available > dcpIds.length ? 1 : 0;
            if (!dcpIds.length && builtin <= 0) return { logCommands };
            addBoarderUnits(target, attackerOwner, [
                {
                    type: "dcp",
                    fromShip: firerShipId,
                    boardedTurn: turn,
                    sourceDcpId: dcpIds[0],
                    sourceBuiltinDcp: dcpIds.length ? undefined : true,
                },
            ]);
            applyBoarderDeploymentEffects(
                position,
                target,
                attackerOwner,
                {
                    fromShip: firerShipId,
                    deployDcpIds: dcpIds.length ? dcpIds : undefined,
                    deployBuiltinDcp: dcpIds.length ? undefined : 1,
                },
                { marines: 0, dcp: 1, builtinDcp: dcpIds.length ? 0 : 1 }
            );
        }
        return { logCommands };
    }

    if (!choice.commandoSystemId) return { logCommands };
    const marineIds = availableMarineIds(firer).slice(0, 1);
    if (!marineIds.length) return { logCommands };
    const marineId = marineIds[0];
    allocateDeployment(firer, { marines: 1, marineIds: [marineId] });

    const mark = source.mark();
    const roll = source.next();
    const result = resolveCommandoRaidRoll(roll, source);
    const rolls = source.consumedSince(mark);
    logCommands.push({
        name: "logDice",
        purpose: `commandoRaid: ${firerShipId} → ${targetShipId}`,
        rolls,
        source: "moderatorSequence",
        result: `Commando raid d6=${roll}`,
    } as FullThrustGameCommand);

    if (result.systemDestroyed) {
        const sys = target.systems?.find((s) => s.id === choice.commandoSystemId);
        if (sys) sys.state = "destroyed";
        else {
            logCommands.push({
                name: "sysDisable",
                ship: targetShipId,
                system: choice.commandoSystemId,
                state: "destroyed",
            } as FullThrustGameCommand);
        }
    }

    if (result.marinesSurvive) {
        releaseDeployment(firer, { marineIds: [marineId] });
    } else {
        syncDeploymentCasualties(firer, { marineIds: [marineId] });
    }

    return { logCommands };
}

/** @deprecated Use applyTransporterDelivery — kept for tests inspecting command shape. */
export function resolveTransporterDeliveryCommands(
    firerShipId: string,
    targetShipId: string,
    attackerOwner: string,
    choice: TransporterDeliveryChoice,
    source: RollSource
): FullThrustGameCommand[] {
    void firerShipId;
    void targetShipId;
    void attackerOwner;
    void choice;
    void source;
    return [];
}
