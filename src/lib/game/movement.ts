/** Cinematic movement helpers (Full Thrust Continuum). */

import {
    courseToDelta,
    facingToCourse,
    facingToRadians,
    pointToCourse,
} from "./coords";

export { facingToCourse } from "./coords";

export type ClockFacing = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

export interface Point {
    x: number;
    y: number;
}

export interface CinematicShipState {
    position: Point;
    facing: ClockFacing;
    speed: number;
    thrust: number;
    advancedDrives?: boolean;
}

export interface CinematicOrders {
    /** Desired speed after acceleration/deceleration. */
    newSpeed: number;
    /** Net clock-face turns (positive = starboard / clockwise in FT map coords if 12=up). */
    turns: number;
}

export type CinematicSpeedChange = "hold" | "accel" | "decel";

/** Player-facing thrust split for cinematic movement entry. */
export interface CinematicAllocation {
    speedChange: CinematicSpeedChange;
    /** Thrust points spent on acceleration or deceleration (0 when holding). */
    speedChangeThrust: number;
    turns: number;
}

export function cinematicFinalSpeed(
    currentSpeed: number,
    thrust: number,
    allocation: Pick<CinematicAllocation, "speedChange" | "speedChangeThrust">
): number {
    const spent = Math.max(
        0,
        Math.min(Math.floor(Number(allocation.speedChangeThrust) || 0), thrust)
    );
    if (allocation.speedChange === "accel") {
        return currentSpeed + spent;
    }
    if (allocation.speedChange === "decel") {
        return Math.max(0, currentSpeed - spent);
    }
    return currentSpeed;
}

export function cinematicOrdersFromAllocation(
    speed: number,
    thrust: number,
    allocation: CinematicAllocation
): CinematicOrders {
    return {
        newSpeed: cinematicFinalSpeed(speed, thrust, allocation),
        turns: allocation.turns,
    };
}

export interface CinematicResult {
    position: Point;
    facing: ClockFacing;
    speed: number;
    /** Polyline of movement for map vectors (start → mid → end, etc.). */
    path: Point[];
    warnings: string[];
}

export function normalizeFacing(facing: number): ClockFacing {
    let f = ((Math.round(facing) - 1) % 12 + 12) % 12 + 1;
    return f as ClockFacing;
}

/** Map absolute course (0° = starboard) to FT clock facing (12 = north). */
export function courseToClockFacing(course: number): ClockFacing {
    const c = ((course % 360) + 360) % 360;
    const steps = Math.round(c / 30) % 12;
    const facing = (15 - steps) % 12;
    return (facing === 0 ? 12 : facing) as ClockFacing;
}

/** Clock facing of movement from one map point to another. */
export function movementClockFacing(from: Point, to: Point): ClockFacing {
    return courseToClockFacing(pointToCourse(to.x - from.x, to.y - from.y));
}

/** Clock facing of launch relative to the launching ship's bow. */
export function launchClockFacing(
    shipPos: Point,
    shipFacing: ClockFacing,
    launchPos: Point
): ClockFacing {
    const dx = launchPos.x - shipPos.x;
    const dy = launchPos.y - shipPos.y;
    const face = facingToRadians(shipFacing);
    let rel = face - Math.atan2(-dy, dx);
    while (rel <= -Math.PI) rel += 2 * Math.PI;
    while (rel > Math.PI) rel -= 2 * Math.PI;
    const offsetSteps = Math.round((rel * 180) / Math.PI / 30);
    return normalizeFacing(shipFacing + offsetSteps);
}

export function turnBudget(thrust: number, advancedDrives = false): number {
    if (advancedDrives) return Math.max(0, Math.floor(thrust));
    return Math.max(0, Math.floor(thrust / 2));
}

export function validateCinematicOrders(
    ship: CinematicShipState,
    orders: CinematicOrders
): string[] {
    const warnings: string[] = [];
    const speedDelta = Math.abs(orders.newSpeed - ship.speed);
    if (orders.newSpeed < 0) {
        warnings.push("Speed cannot be negative; clamped to 0.");
    }
    if (speedDelta > ship.thrust) {
        warnings.push(
            `Speed change ${speedDelta} exceeds thrust ${ship.thrust}.`
        );
    }
    const maxTurns = turnBudget(ship.thrust, ship.advancedDrives);
    if (Math.abs(orders.turns) > maxTurns) {
        warnings.push(
            `Turns ${Math.abs(orders.turns)} exceed turn budget ${maxTurns}.`
        );
    }
    return warnings;
}

/**
 * Apply cinematic movement:
 * - set speed to newSpeed (clamped)
 * - half turns at start, half at midpoint (odd: floor then ceil)
 * - move full new velocity along facing after start turns
 */
export function applyCinematicMovement(
    ship: CinematicShipState,
    orders: CinematicOrders
): CinematicResult {
    const warnings = validateCinematicOrders(ship, orders);
    const speed = Math.max(0, Math.min(orders.newSpeed, ship.speed + ship.thrust));
    // Also allow deceleration within thrust
    const decelLimited = Math.max(ship.speed - ship.thrust, 0);
    const finalSpeed =
        orders.newSpeed > ship.speed
            ? Math.min(orders.newSpeed, ship.speed + ship.thrust)
            : Math.max(orders.newSpeed, decelLimited);

    const maxTurns = turnBudget(ship.thrust, ship.advancedDrives);
    const turns =
        Math.sign(orders.turns) *
        Math.min(Math.abs(orders.turns), maxTurns);

    const startTurns = turns >= 0 ? Math.floor(turns / 2) : Math.ceil(turns / 2);
    const midTurns = turns - startTurns;

    let facing = normalizeFacing(ship.facing + startTurns);
    const start = { ...ship.position };
    const path: Point[] = [start];

    // Move half distance, then remaining turns, then remaining distance
    const half = finalSpeed / 2;
    const mid = translate(start, facing, half);
    path.push(mid);

    facing = normalizeFacing(facing + midTurns);
    const end = translate(mid, facing, finalSpeed - half);
    path.push(end);

    if (finalSpeed !== orders.newSpeed) {
        warnings.push(`Speed adjusted to ${finalSpeed} by thrust limits.`);
    }

    return {
        position: end,
        facing,
        speed: finalSpeed,
        path,
        warnings,
    };
}

export function translate(from: Point, facing: ClockFacing, distance: number): Point {
    const d = courseToDelta(facingToCourse(facing), distance);
    return { x: from.x + d.x, y: from.y + d.y };
}

export function distance(a: Point, b: Point): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Which 60° fire arc contains the target relative to ship facing.
 * Arcs: FWD, FS, AS, AFT, AP, FP.
 */
export type FireArc = "FWD" | "FS" | "AS" | "AFT" | "AP" | "FP";

export function bearingArc(
    from: Point,
    facing: ClockFacing,
    to: Point
): FireArc {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    let abs = Math.atan2(-dy, dx);
    const face = facingToRadians(facing);
    // Relative bearing: 0 = dead ahead
    let rel = abs - face;
    while (rel <= -Math.PI) rel += 2 * Math.PI;
    while (rel > Math.PI) rel -= 2 * Math.PI;
    // Convert to degrees, ahead = 0, starboard positive
    const deg = (rel * 180) / Math.PI;
    if (deg > -30 && deg <= 30) return "FWD";
    if (deg > 30 && deg <= 90) return "FS";
    if (deg > 90 && deg <= 150) return "AS";
    if (deg > 150 || deg <= -150) return "AFT";
    if (deg > -150 && deg <= -90) return "AP";
    return "FP";
}

/** Map relative bearing to SSD weapon arc letters (F/A not FWD/AFT). */
export function bearingWeaponArc(
    from: Point,
    facing: ClockFacing,
    to: Point
): import("@/lib/genArcs").Arc {
    const arc = bearingArc(from, facing, to);
    if (arc === "FWD") return "F";
    if (arc === "AFT") return "A";
    return arc;
}
