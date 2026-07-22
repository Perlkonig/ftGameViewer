/** Resolve deferred movement orders (phase 1 → phase 5) from deltas + current ship state. */

import type { FullThrustGameCommand } from "@/schemas/commands";
import type { FullThrustGamePosition } from "@/schemas/position";
import {
    applyCinematicMovement,
    cinematicOrdersFromAllocation,
    type CinematicAllocation,
    type ClockFacing,
    type Point,
} from "./movement";
import {
    applyVectorMovement,
    facingToCourse,
    isVectorShip,
    type VectorManeuver,
} from "./vectorMovement";
import { shipThrust, type ShipGameState } from "./shipSystems";

export const DEFAULT_CINEMATIC_ALLOCATION: CinematicAllocation = {
    speedChange: "hold",
    speedChangeThrust: 0,
    turns: 0,
};

export interface ResolvedMovePatch {
    position: Point;
    facing: ClockFacing;
    speed: number;
    course?: number;
    path: Point[];
    warnings: string[];
}

type ShipObj = FullThrustGamePosition["objects"][number] & {
    position?: Point | null;
    facing?: number;
    speed?: number;
    course?: number;
    vectors?: Point[][];
};

function shipPoint(ship: ShipGameState): Point {
    const p = ship.position;
    if (!p || typeof p !== "object" || !("x" in p)) return { x: 0, y: 0 };
    return { x: Number(p.x), y: Number(p.y) };
}

export function cinematicAllocationFromCommand(
    cmd: FullThrustGameCommand
): CinematicAllocation | undefined {
    const c = cmd as { cinematicAllocation?: CinematicAllocation };
    if (!c.cinematicAllocation) return undefined;
    const a = c.cinematicAllocation;
    return {
        speedChange: a.speedChange ?? "hold",
        speedChangeThrust: Math.max(0, Number(a.speedChangeThrust) || 0),
        turns: Number(a.turns) || 0,
    };
}

export function pendingMoveForShip(
    pending: FullThrustGameCommand[] | undefined,
    shipId: string
): FullThrustGameCommand | undefined {
    for (const cmd of pending ?? []) {
        if (cmd.name !== "moveShip") continue;
        if ((cmd as { id?: string }).id === shipId) return cmd;
    }
    return undefined;
}

/** Compute movement from a delta order, or default drift when cmd is omitted. */
export function resolveMoveFromOrder(
    ship: ShipGameState,
    cmd?: FullThrustGameCommand
): ResolvedMovePatch {
    const thrust = shipThrust(ship);
    const position = shipPoint(ship);
    const facing = (ship.facing ?? 12) as ClockFacing;
    const speed = Number(ship.speed ?? 0) || 0;

    if (cmd?.name === "moveShip") {
        const move = cmd as Extract<FullThrustGameCommand, { name: "moveShip" }> & {
            vectorManeuvers?: VectorManeuver[];
            advancedDrives?: boolean;
        };
        const vectorManeuvers = move.vectorManeuvers;

        if (isVectorShip(ship)) {
            const course =
                ship.course ??
                (move.course as number | undefined) ??
                facingToCourse(facing);
            if (vectorManeuvers && vectorManeuvers.length > 0) {
                const result = applyVectorMovement(
                    { position, facing, course, speed, thrust },
                    { maneuvers: vectorManeuvers }
                );
                return {
                    position: result.position,
                    facing: result.facing,
                    speed: result.speed,
                    course: result.course,
                    path: result.path,
                    warnings: result.warnings,
                };
            }
            if (move.position) {
                return legacyAbsolutePatch(ship, move, []);
            }
            const result = applyVectorMovement(
                { position, facing, course, speed, thrust },
                { maneuvers: [] }
            );
            return {
                position: result.position,
                facing: result.facing,
                speed: result.speed,
                course: result.course,
                path: result.path,
                warnings: result.warnings,
            };
        }

        const allocation = cinematicAllocationFromCommand(cmd);
        if (allocation) {
            const advancedDrives = !!move.advancedDrives;
            const orders = cinematicOrdersFromAllocation(speed, thrust, allocation);
            const result = applyCinematicMovement(
                { position, facing, speed, thrust, advancedDrives },
                orders
            );
            return {
                position: result.position,
                facing: result.facing,
                speed: result.speed,
                path: result.path,
                warnings: result.warnings,
            };
        }

        if (move.position || move.speed !== undefined || move.facing !== undefined) {
            return legacyAbsolutePatch(ship, move, []);
        }
    }

    if (isVectorShip(ship)) {
        const course = ship.course ?? facingToCourse(facing);
        const result = applyVectorMovement(
            { position, facing, course, speed, thrust },
            { maneuvers: [] }
        );
        return {
            position: result.position,
            facing: result.facing,
            speed: result.speed,
            course: result.course,
            path: result.path,
            warnings: result.warnings,
        };
    }

    const orders = cinematicOrdersFromAllocation(speed, thrust, DEFAULT_CINEMATIC_ALLOCATION);
    const result = applyCinematicMovement(
        { position, facing, speed, thrust },
        orders
    );
    return {
        position: result.position,
        facing: result.facing,
        speed: result.speed,
        path: result.path,
        warnings: result.warnings,
    };
}

function legacyAbsolutePatch(
    ship: ShipGameState,
    move: Extract<FullThrustGameCommand, { name: "moveShip" }>,
    warnings: string[]
): ResolvedMovePatch {
    const position = move.position ?? shipPoint(ship);
    const facing = (move.facing ?? ship.facing ?? 12) as ClockFacing;
    const speed = move.speed !== undefined ? Number(move.speed) : Number(ship.speed ?? 0) || 0;
    const path =
        move.vectors && move.vectors.length >= 2
            ? (move.vectors as Point[])
            : [shipPoint(ship), position];
    return {
        position,
        facing,
        speed,
        course: move.course as number | undefined,
        path,
        warnings,
    };
}

export function applyResolvedMovePatch(ship: ShipObj, patch: ResolvedMovePatch): void {
    ship.position = patch.position;
    ship.facing = patch.facing;
    ship.speed = patch.speed;
    if (patch.course !== undefined) ship.course = patch.course;
    if (patch.path.length >= 2) {
        if (!ship.vectors) ship.vectors = [];
        ship.vectors.unshift(
            patch.path as [
                { x: number; y: number },
                { x: number; y: number },
                ...{ x: number; y: number }[],
            ]
        );
    }
}

export function resolvePhase5MovementWithPending(
    position: FullThrustGamePosition,
    pendingMoves: FullThrustGameCommand[] | undefined
): { position: FullThrustGamePosition; warnings: string[] } {
    const next = structuredClone(position) as FullThrustGamePosition;
    const warnings: string[] = [];
    const pendingById = new Map<string, FullThrustGameCommand>();
    for (const cmd of pendingMoves ?? []) {
        if (cmd.name !== "moveShip") continue;
        const id = (cmd as { id?: string }).id;
        if (id) pendingById.set(id, cmd);
    }

    for (const obj of next.objects ?? []) {
        if (obj.objType !== "ship" || !obj.position) continue;
        const ship = obj as ShipGameState;
        const patch = resolveMoveFromOrder(ship, pendingById.get(ship.id));
        warnings.push(...patch.warnings);
        applyResolvedMovePatch(obj as ShipObj, patch);
    }

    return { position: next, warnings };
}

export function previewPathForShip(
    ship: ShipGameState,
    pending: FullThrustGameCommand[] | undefined
): Point[] {
    const cmd = pendingMoveForShip(pending, ship.id);
    return resolveMoveFromOrder(ship, cmd).path;
}

/** Next position from current speed and facing only (no pending orders). */
export function previewDriftPathForShip(ship: ShipGameState): Point[] {
    return resolveMoveFromOrder(ship).path;
}
