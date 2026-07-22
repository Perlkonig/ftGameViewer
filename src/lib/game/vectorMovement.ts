/** Vector movement helpers (Full Thrust Continuum optional rules). */

import type { ClockFacing, Point } from "./movement";
import {
    courseToDelta,
    pointToCourse,
} from "./coords";
import { normalizeFacing, translate } from "./movement";

export type MovementMode = "cinematic" | "vector";

export type PushDirection = "port" | "starboard" | "reverse";

export type VectorManeuver =
    | { type: "rotate"; turns: number }
    | { type: "push"; direction: PushDirection; distance: number }
    | { type: "mainDrive"; thrust: number };

export interface VectorShipState {
    position: Point;
    facing: ClockFacing;
    /** Degrees: 0 = starboard (+x), increases counter-clockwise. */
    course: number;
    speed: number;
    thrust: number;
}

export interface VectorOrders {
    maneuvers: VectorManeuver[];
}

export interface VectorResult {
    position: Point;
    facing: ClockFacing;
    course: number;
    speed: number;
    path: Point[];
    warnings: string[];
}

export { facingToCourse } from "./coords";

export function maneuverPoints(thrust: number): number {
    return Math.max(0, Math.floor(thrust / 2));
}

export function isVectorShip(ship: {
    movementMode?: MovementMode;
    course?: number;
}): boolean {
    if (ship.movementMode === "vector") return true;
    if (ship.movementMode === "cinematic") return false;
    return ship.course !== undefined;
}

export function driftAlongCourse(from: Point, speed: number, course: number): Point {
    if (speed <= 0) return { ...from };
    const d = courseToDelta(course, speed);
    return { x: from.x + d.x, y: from.y + d.y };
}

function pushFacing(facing: ClockFacing, direction: PushDirection): ClockFacing {
    if (direction === "port") return normalizeFacing(facing - 3);
    if (direction === "starboard") return normalizeFacing(facing + 3);
    return normalizeFacing(facing + 6);
}

export function validateVectorOrders(
    ship: VectorShipState,
    orders: VectorOrders
): string[] {
    const warnings: string[] = [];
    const budget = maneuverPoints(ship.thrust);
    let rotateCount = 0;
    let pushCount = 0;
    let maneuverSpent = 0;

    for (const m of orders.maneuvers) {
        if (m.type === "rotate") {
            rotateCount++;
            if (rotateCount > 1) warnings.push("Only one rotation maneuver per turn.");
            maneuverSpent += 1;
            if (m.turns === 0) warnings.push("Rotation must change facing.");
        } else if (m.type === "push") {
            pushCount++;
            if (pushCount > 1) warnings.push("Only one thruster push per turn.");
            if (m.distance < 0) warnings.push("Push distance cannot be negative.");
            maneuverSpent += Math.round(m.distance);
        } else if (m.type === "mainDrive") {
            if (m.thrust < 0) warnings.push("Main drive thrust cannot be negative.");
            if (m.thrust > ship.thrust) {
                warnings.push(
                    `Main drive ${m.thrust} exceeds thrust rating ${ship.thrust}.`
                );
            }
        }
    }

    if (maneuverSpent > budget) {
        warnings.push(
            `Maneuver points ${maneuverSpent} exceed budget ${budget}.`
        );
    }
    return warnings;
}

/**
 * Vector movement procedure:
 * 1. Drift along course by speed
 * 2. Execute maneuvers in order
 * 3. New speed = displacement from start; new course = line direction
 */
export function applyVectorMovement(
    ship: VectorShipState,
    orders: VectorOrders
): VectorResult {
    const warnings = validateVectorOrders(ship, orders);
    const start = { ...ship.position };
    const path: Point[] = [start];

    let pos = driftAlongCourse(start, ship.speed, ship.course);
    if (ship.speed > 0) path.push(pos);

    let facing = ship.facing;
    const budget = maneuverPoints(ship.thrust);
    let maneuverSpent = 0;

    for (const m of orders.maneuvers) {
        if (m.type === "rotate") {
            maneuverSpent += 1;
            facing = normalizeFacing(facing + Math.round(m.turns));
        } else if (m.type === "push") {
            const dist = Math.max(0, m.distance);
            maneuverSpent += Math.round(dist);
            const pushFace = pushFacing(facing, m.direction);
            pos = translate(pos, pushFace, dist);
            path.push(pos);
        } else if (m.type === "mainDrive") {
            const thrust = Math.min(Math.max(0, m.thrust), ship.thrust);
            if (thrust !== m.thrust) {
                warnings.push(`Main drive adjusted to ${thrust} by thrust rating.`);
            }
            pos = translate(pos, facing, thrust);
            path.push(pos);
        }
    }

    if (maneuverSpent > budget) {
        warnings.push(`Maneuver spending clamped; budget was ${budget}.`);
    }

    const dx = pos.x - start.x;
    const dy = pos.y - start.y;
    const newSpeed = Math.sqrt(dx * dx + dy * dy);
    const newCourse =
        newSpeed < 1e-9 ? ship.course : pointToCourse(dx, dy);

    if (path[path.length - 1].x !== pos.x || path[path.length - 1].y !== pos.y) {
        path.push(pos);
    }

    return {
        position: pos,
        facing,
        course: newCourse,
        speed: Math.round(newSpeed),
        path,
        warnings,
    };
}
