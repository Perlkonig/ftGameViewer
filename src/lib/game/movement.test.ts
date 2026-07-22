import { describe, it, expect } from "vitest";
import {
    applyCinematicMovement,
    turnBudget,
    bearingArc,
    bearingWeaponArc,
    normalizeFacing,
    cinematicFinalSpeed,
    cinematicOrdersFromAllocation,
    launchClockFacing,
    movementClockFacing,
} from "./movement";

describe("movement", () => {
    it("turn budget is floor(thrust/2) by default", () => {
        expect(turnBudget(4)).toBe(2);
        expect(turnBudget(5)).toBe(2);
        expect(turnBudget(4, true)).toBe(4);
    });

    it("applies cinematic move with path", () => {
        const result = applyCinematicMovement(
            { position: { x: 0, y: 0 }, facing: 12, speed: 4, thrust: 4 },
            { newSpeed: 4, turns: 0 }
        );
        expect(result.speed).toBe(4);
        expect(result.facing).toBe(12);
        expect(result.path.length).toBe(3);
        expect(result.position.y).toBeCloseTo(-4, 5);
        expect(result.position.x).toBeCloseTo(0, 5);
    });

    it("clamps speed by thrust", () => {
        const result = applyCinematicMovement(
            { position: { x: 0, y: 0 }, facing: 12, speed: 2, thrust: 2 },
            { newSpeed: 10, turns: 0 }
        );
        expect(result.speed).toBe(4);
        expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("computes final speed from thrust allocation", () => {
        expect(
            cinematicFinalSpeed(4, 4, { speedChange: "accel", speedChangeThrust: 2 })
        ).toBe(6);
        expect(
            cinematicFinalSpeed(4, 4, { speedChange: "decel", speedChangeThrust: 3 })
        ).toBe(1);
        expect(
            cinematicFinalSpeed(4, 4, { speedChange: "hold", speedChangeThrust: 0 })
        ).toBe(4);
    });

    it("builds cinematic orders from allocation", () => {
        const orders = cinematicOrdersFromAllocation(2, 4, {
            speedChange: "accel",
            speedChangeThrust: 2,
            turns: 1,
        });
        expect(orders).toEqual({ newSpeed: 4, turns: 1 });
    });

    it("normalizes facing", () => {
        expect(normalizeFacing(13)).toBe(1);
        expect(normalizeFacing(0)).toBe(12);
    });

    it("computes fire arcs", () => {
        const from = { x: 0, y: 0 };
        expect(bearingArc(from, 12, { x: 0, y: -10 })).toBe("FWD");
        expect(bearingArc(from, 12, { x: 0, y: 10 })).toBe("AFT");
    });

    it("maps fire arcs to weapon arc letters", () => {
        const from = { x: 0, y: 0 };
        expect(bearingWeaponArc(from, 12, { x: 0, y: -10 })).toBe("F");
        expect(bearingWeaponArc(from, 12, { x: 0, y: 10 })).toBe("A");
        expect(bearingWeaponArc(from, 12, { x: 10, y: 0 })).toBe("AP");
    });

    it("launchClockFacing rounds relative bearing to nearest clock", () => {
        const ship = { x: 10, y: 10 };
        expect(launchClockFacing(ship, 12, { x: 10, y: 5 })).toBe(12);
        const deg25 = {
            x: 10 + 2 * Math.sin((25 * Math.PI) / 180),
            y: 10 - 2 * Math.cos((25 * Math.PI) / 180),
        };
        expect(launchClockFacing(ship, 12, deg25)).toBe(1);
        expect(launchClockFacing(ship, 12, { x: 15, y: 10 })).toBe(3);
    });

    it("movementClockFacing maps travel direction to clock facing", () => {
        expect(movementClockFacing({ x: 0, y: 0 }, { x: 0, y: -1 })).toBe(12);
        expect(movementClockFacing({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(3);
    });
});
