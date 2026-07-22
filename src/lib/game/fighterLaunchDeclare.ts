/** Phase 1 fighter launch declaration on moveShip orders. */

import type { FullThrustGameCommand } from "@/schemas/commands";
import type { FoldState } from "./applyCommand";
import type { CinematicAllocation } from "./movement";
import { isVectorShip, type VectorManeuver } from "./vectorMovement";
import { pendingMoveForShip } from "./movementResolve";
import type { ShipGameState } from "./shipSystems";
import type { ValidationIssue } from "./commandValidation";

export function moveShipDeclaresLaunchFighters(
    cmd: FullThrustGameCommand | undefined
): boolean {
    if (!cmd || cmd.name !== "moveShip") return false;
    return !!(cmd as { launchFighters?: boolean }).launchFighters;
}

/** True when the order spends thrust on speed change, turns, or vector maneuvers. */
export function moveShipUsesThrust(
    cmd: FullThrustGameCommand,
    ship: ShipGameState
): boolean {
    if (cmd.name !== "moveShip") return false;
    const c = cmd as {
        vectorManeuvers?: VectorManeuver[];
        cinematicAllocation?: CinematicAllocation;
        speed?: number;
        facing?: number;
        position?: unknown;
    };

    if (isVectorShip(ship)) {
        return (c.vectorManeuvers?.length ?? 0) > 0;
    }

    if (c.cinematicAllocation) {
        const a = c.cinematicAllocation;
        if (a.speedChange !== "hold" && (a.speedChangeThrust ?? 0) > 0) return true;
        if ((a.turns ?? 0) !== 0) return true;
        return false;
    }

    if (c.speed !== undefined || c.facing !== undefined || c.position) return true;
    return false;
}

export function declaredLaunchFightersForShip(
    pendingMoves: FullThrustGameCommand[] | undefined,
    shipId: string
): boolean {
    return moveShipDeclaresLaunchFighters(pendingMoveForShip(pendingMoves, shipId));
}

export function validateMoveShipLaunchFighters(
    ship: ShipGameState,
    cmd: FullThrustGameCommand
): ValidationIssue[] {
    if (cmd.name !== "moveShip") return [];
    if (!moveShipDeclaresLaunchFighters(cmd)) return [];
    if (!moveShipUsesThrust(cmd, ship)) return [];
    return [
        {
            message: `${ship.id} declared fighter launch — movement may not use thrust (hold speed and no turns).`,
            severity: "warning",
        },
    ];
}

export function validateLaunchFightersDeclaration(
    fold: FoldState,
    shipId: string
): ValidationIssue[] {
    if (declaredLaunchFightersForShip(fold.pendingMoves, shipId)) return [];
    return [
        {
            message: `Ship ${shipId} did not declare launching fighters in phase 1 write orders.`,
            severity: "warning",
        },
    ];
}

export function fighterLaunchModeratorHints(fold: FoldState): string[] {
    const hints: string[] = [];
    for (const cmd of fold.pendingMoves ?? []) {
        if (cmd.name !== "moveShip") continue;
        const shipId = (cmd as { id?: string }).id;
        if (!shipId) continue;
        const ship = fold.position.objects?.find(
            (o) => o.objType === "ship" && o.id === shipId
        ) as ShipGameState | undefined;
        if (!ship) continue;
        for (const issue of validateMoveShipLaunchFighters(ship, cmd)) {
            hints.push(`Warning: ${issue.message}`);
        }
    }
    return hints;
}
