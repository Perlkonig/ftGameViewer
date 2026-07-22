import { describe, it, expect } from "vitest";
import {
    applyVectorMovement,
    facingToCourse,
    maneuverPoints,
    driftAlongCourse,
} from "./vectorMovement";

describe("vectorMovement", () => {
    it("converts facing to course", () => {
        expect(facingToCourse(3)).toBe(0);
        expect(facingToCourse(12)).toBe(90);
    });

    it("maneuver points are floor(thrust/2)", () => {
        expect(maneuverPoints(5)).toBe(2);
        expect(maneuverPoints(4)).toBe(2);
    });

    it("drifts along course", () => {
        const end = driftAlongCourse({ x: 0, y: 0 }, 4, 90);
        expect(end.x).toBeCloseTo(0, 5);
        expect(end.y).toBeCloseTo(-4, 5);
    });

    it("applies drift then main drive", () => {
        const result = applyVectorMovement(
            {
                position: { x: 0, y: 0 },
                facing: 12,
                course: 90,
                speed: 2,
                thrust: 4,
            },
            { maneuvers: [{ type: "mainDrive", thrust: 3 }] }
        );
        // drift -2y, then main drive +3 along facing 12 (-y) => y=-5
        expect(result.position.y).toBeCloseTo(-5, 5);
        expect(result.speed).toBeCloseTo(5, 5);
    });

    it("rejects excess maneuver spending in warnings", () => {
        const result = applyVectorMovement(
            {
                position: { x: 0, y: 0 },
                facing: 12,
                course: 0,
                speed: 0,
                thrust: 2,
            },
            {
                maneuvers: [
                    { type: "rotate", turns: 1 },
                    { type: "push", direction: "port", distance: 3 },
                ],
            }
        );
        expect(result.warnings.some((w) => w.includes("Maneuver points"))).toBe(true);
    });
});
