/** Spinal mount beam geometry and specs (§5.23). */

import { facingToRadians, type Point } from "./coords";

export type SpinalSize = "short" | "medium" | "long";

export interface SpinalSpec {
    mass: number;
    rangeMu: number;
    beamWidthMu: number;
}

const SPECS: Record<SpinalSize, SpinalSpec> = {
    short: { mass: 8, rangeMu: 24, beamWidthMu: 1 },
    medium: { mass: 16, rangeMu: 36, beamWidthMu: 1.5 },
    long: { mass: 32, rangeMu: 48, beamWidthMu: 2 },
};

export function spinalSizeFromRange(range: unknown): SpinalSize {
    const r = String(range ?? "medium").toLowerCase();
    if (r === "short") return "short";
    if (r === "long") return "long";
    return "medium";
}

export function spinalSpec(size: SpinalSize): SpinalSpec {
    return SPECS[size];
}

export function spinalMassForWeapon(range: unknown): number {
    return spinalSpec(spinalSizeFromRange(range)).mass;
}

function normalize(v: Point): Point {
    const len = Math.hypot(v.x, v.y);
    if (len < 1e-9) return { x: 0, y: -1 };
    return { x: v.x / len, y: v.y / len };
}

/** Unit direction from firer facing (clock 12 = up, +y). */
export function facingDirection(facing: number): Point {
    const rad = facingToRadians(facing);
    return { x: Math.sin(rad), y: -Math.cos(rad) };
}

/** Bearing from origin to point in degrees [0,360). */
export function bearingDegrees(from: Point, to: Point): number {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    return ((deg % 360) + 360) % 360;
}

/** Smallest signed angle difference in degrees. */
export function angleDiffDeg(a: number, b: number): number {
    let d = ((b - a + 540) % 360) - 180;
    return d;
}

/** Forward 30° spinal arc check. */
export function inSpinalForwardArc(
    origin: Point,
    facing: number,
    target: Point,
    halfArcDeg = 15
): boolean {
    const fwd = facingDirection(facing);
    const fwdDeg = bearingDegrees(origin, { x: origin.x + fwd.x, y: origin.y + fwd.y });
    const toDeg = bearingDegrees(origin, target);
    return Math.abs(angleDiffDeg(fwdDeg, toDeg)) <= halfArcDeg;
}

/** Distance from point to infinite line through origin along dir. */
function distanceToLine(point: Point, origin: Point, dir: Point): number {
    const ox = point.x - origin.x;
    const oy = point.y - origin.y;
    const cross = Math.abs(ox * dir.y - oy * dir.x);
    return cross;
}

/** Projection of point onto ray; returns distance along ray from origin (negative = behind). */
function projectionAlongRay(point: Point, origin: Point, dir: Point): number {
    const ox = point.x - origin.x;
    const oy = point.y - origin.y;
    return ox * dir.x + oy * dir.y;
}

export function pointInSpinalBeam(
    origin: Point,
    facing: number,
    aimPoint: Point,
    point: Point,
    spec: SpinalSpec
): boolean {
    if (!inSpinalForwardArc(origin, facing, point)) return false;
    const dir = normalize({
        x: aimPoint.x - origin.x,
        y: aimPoint.y - origin.y,
    });
    const along = projectionAlongRay(point, origin, dir);
    if (along < 0 || along > spec.rangeMu) return false;
    const perp = distanceToLine(point, origin, dir);
    return perp <= spec.beamWidthMu / 2;
}

export function enumerateSpinalTargets<T extends { id: string; position: Point | null }>(
    origin: Point,
    facing: number,
    aimPoint: Point,
    spec: SpinalSpec,
    candidates: T[]
): T[] {
    return candidates.filter(
        (c) => c.position && pointInSpinalBeam(origin, facing, aimPoint, c.position, spec)
    );
}

/** PSP: 1d6 per 50 mass per hit. */
export function pspDamageDicePerHit(targetMass: number): number {
    return Math.max(1, Math.ceil(targetMass / 50));
}
