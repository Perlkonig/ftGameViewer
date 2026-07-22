/** Needle beam sensor gating (§5.13) and fragile sensor threshold checks. */

import type { FullThrustGameCommand } from "@/schemas/commands";
import {
    isSystemDestroyed,
    listShipSystems,
    type ShipGameState,
    type ShipSystemEntry,
} from "./shipSystems";
import { systemFailsThreshold } from "./thresholds";

function sensorEntries(ship: ShipGameState) {
    return listShipSystems(ship).filter((s) => s.name === "sensors");
}

export const FRAGILE_SENSOR_THRESHOLD_BONUS = 1;

/** Operational enhanced/superior sensor modules on the ship. */
export function fragileSensorEntries(ship: ShipGameState): ShipSystemEntry[] {
    return sensorEntries(ship).filter((s) => !isSystemDestroyed(ship, s.id));
}

export interface FragileSensorOutcome {
    sensorId: string;
    label: string;
    roll: number;
    effectiveRoll: number;
    failed: boolean;
    state?: "damaged" | "destroyed";
}

export function resolveFragileSensorThresholds(
    ship: ShipGameState,
    rolls: number[],
    failOn: number,
    hullRollBonus: number
): FragileSensorOutcome[] {
    const bonus = hullRollBonus + FRAGILE_SENSOR_THRESHOLD_BONUS;
    return fragileSensorEntries(ship).map((entry, i) => {
        const roll = rolls[i] ?? 1;
        const effectiveRoll = Math.min(6, roll + bonus);
        const failed = systemFailsThreshold(roll, failOn, bonus);
        const outcome: FragileSensorOutcome = {
            sensorId: entry.id,
            label: entry.name ?? entry.id,
            roll,
            effectiveRoll,
            failed,
        };
        if (failed) {
            outcome.state = roll === 6 ? "destroyed" : "damaged";
        }
        return outcome;
    });
}

export function buildFragileSensorThresholdCommands(
    shipId: string,
    outcomes: FragileSensorOutcome[]
): FullThrustGameCommand[] {
    const cmds: FullThrustGameCommand[] = [];
    for (const o of outcomes) {
        if (!o.failed || !o.state) continue;
        cmds.push({
            name: "sysDisable",
            ship: shipId,
            system: o.sensorId,
            state: o.state,
        } as FullThrustGameCommand);
    }
    return cmds;
}

export function hasEnhancedSensors(ship: ShipGameState): boolean {
    return sensorEntries(ship).length > 0;
}

export function hasSuperiorSensors(ship: ShipGameState): boolean {
    return sensorEntries(ship).some((s) => s.advanced === true);
}

export function enhancedSensorCount(ship: ShipGameState): number {
    return sensorEntries(ship).length;
}

/** Whether firer meets sensor tier for needle fire at range. */
export function needleSensorRequirementMet(ship: ShipGameState, rangeMu: number): boolean {
    if (rangeMu <= 12) return true;
    if (rangeMu <= 24) return hasEnhancedSensors(ship);
    return hasSuperiorSensors(ship) || enhancedSensorCount(ship) >= 2;
}

export function needleSensorRequirementMessage(rangeMu: number): string {
    if (rangeMu <= 12) return "";
    if (rangeMu <= 24) return "Needle fire beyond 12 MU requires Enhanced Sensors.";
    return "Needle fire beyond 24 MU requires Superior Sensors or two Enhanced sensor modules.";
}
