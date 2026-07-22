import { describe, expect, it } from "vitest";
import {
    previewDriftPathForShip,
    previewPathForShip,
    resolveMoveFromOrder,
    resolvePhase5MovementWithPending,
} from "./movementResolve";
import type { ShipGameState } from "./shipSystems";
import type { FullThrustGamePosition } from "@/schemas/position";

const cinematicShip = (overrides: Partial<ShipGameState> = {}): ShipGameState =>
    ({
        id: "S1",
        objType: "ship",
        position: { x: 10, y: 10 },
        facing: 12,
        speed: 3,
        object: { systems: [{ name: "drive", thrust: 6, id: "d1" }] },
        ...overrides,
    }) as ShipGameState;

describe("movementResolve", () => {
    it("defaults to drift at current speed when no order exists", () => {
        const ship = cinematicShip();
        const patch = resolveMoveFromOrder(ship);
        expect(patch.position).toEqual({ x: 10, y: 7 });
        expect(patch.speed).toBe(3);
    });

    it("applies cinematic allocation delta from current state", () => {
        const ship = cinematicShip();
        const patch = resolveMoveFromOrder(ship, {
            name: "moveShip",
            id: "S1",
            cinematicAllocation: {
                speedChange: "accel",
                speedChangeThrust: 2,
                turns: 1,
            },
        } as never);
        expect(patch.speed).toBe(5);
        expect(patch.path.length).toBeGreaterThanOrEqual(2);
    });

    it("previews paths for all ships including those without orders", () => {
        const ship = cinematicShip();
        const path = previewPathForShip(ship, []);
        expect(path[0]).toEqual({ x: 10, y: 10 });
        expect(path[path.length - 1].y).toBeLessThan(10);
    });

    it("previewDriftPathForShip ignores pending orders", () => {
        const ship = cinematicShip();
        const drift = previewDriftPathForShip(ship);
        const withOrder = previewPathForShip(ship, [
            {
                name: "moveShip",
                id: "S1",
                cinematicAllocation: {
                    speedChange: "accel",
                    speedChangeThrust: 6,
                    turns: 0,
                },
            } as never,
        ]);
        expect(drift[drift.length - 1]).toEqual({ x: 10, y: 7 });
        expect(withOrder[withOrder.length - 1].y).toBeLessThan(7);
    });

    it("resolves every ship on entering phase 5", () => {
        const position: FullThrustGamePosition = {
            map: { mode: "fixed", width: 72, height: 48 },
            objects: [
                cinematicShip({ id: "A", position: { x: 1, y: 1 }, speed: 2 }),
                cinematicShip({ id: "B", position: { x: 4, y: 4 }, speed: 0 }),
            ] as FullThrustGamePosition["objects"],
        };
        const { position: next } = resolvePhase5MovementWithPending(position, [
            {
                name: "moveShip",
                id: "A",
                cinematicAllocation: {
                    speedChange: "hold",
                    speedChangeThrust: 0,
                    turns: 0,
                },
            } as never,
        ]);
        const a = next.objects?.find((o) => o.id === "A");
        const b = next.objects?.find((o) => o.id === "B");
        expect(a?.position).toEqual({ x: 1, y: -1 });
        expect(b?.position).toEqual({ x: 4, y: 4 });
    });
});
