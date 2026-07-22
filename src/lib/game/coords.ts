/** Map coordinate helpers: +x east, +y south (SVG y-down). Course 0° = starboard. */

import type { ClockFacing } from "./movement";

export function facingToCourse(facing: ClockFacing): number {
    return ((((15 - facing) % 12) + 12) % 12) * 30;
}

export function courseToRadians(course: number): number {
    return (course * Math.PI) / 180;
}

export function radiansToCourse(radians: number): number {
    let deg = (radians * 180) / Math.PI;
    while (deg < 0) deg += 360;
    while (deg >= 360) deg -= 360;
    return deg;
}

export function courseToDelta(course: number, distance: number): { x: number; y: number } {
    const r = courseToRadians(course);
    return {
        x: Math.cos(r) * distance,
        y: -Math.sin(r) * distance,
    };
}

export function pointToCourse(dx: number, dy: number): number {
    return radiansToCourse(Math.atan2(-dy, dx));
}

export function facingToRadians(facing: ClockFacing): number {
    return courseToRadians(facingToCourse(facing));
}
