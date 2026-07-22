import { describe, it, expect } from "vitest";
import {
    collectShipSystemIds,
    jsonForSsdTarget,
} from "./ssdExploreJson";
import type { FullThrustShip } from "ftlibship";

const shipDesign: FullThrustShip = {
    mass: 75,
    hull: { points: 12, rows: 3, stealth: "0", streamlining: "none" },
    armour: [[2, 0]],
    systems: [
        { id: "d1", name: "drive", thrust: 4 },
        { id: "fc1", name: "fireControl" },
    ],
    weapons: [{ id: "b1", name: "beamBattery", shots: 2 }],
};

const shipObj = {
    objType: "ship" as const,
    id: "Test",
    owner: "P1",
    object: shipDesign,
    svg: "<svg/>",
    position: { x: 0, y: 0 },
    facing: 0 as const,
    speed: 0,
    dmgHull: 2,
    coreState: { powerless: true },
};

describe("ssdExploreJson", () => {
    it("collects system ids from all lists", () => {
        const ids = collectShipSystemIds(shipDesign);
        expect(ids.has("d1")).toBe(true);
        expect(ids.has("fc1")).toBe(true);
        expect(ids.has("b1")).toBe(true);
    });

    it("returns hull json with runtime damage", () => {
        const json = jsonForSsdTarget(shipDesign, shipObj, "_hull") as {
            hull: unknown;
            dmgHull: number;
        };
        expect(json.hull).toEqual(shipDesign.hull);
        expect(json.dmgHull).toBe(2);
    });

    it("returns drive system by name for _drive clicks", () => {
        const json = jsonForSsdTarget(shipDesign, shipObj, "_drive") as { id: string; name: string };
        expect(json.id).toBe("d1");
        expect(json.name).toBe("drive");
    });

    it("returns core state for _core clicks", () => {
        const json = jsonForSsdTarget(shipDesign, shipObj, "_core") as {
            coreState: { powerless?: boolean };
        };
        expect(json.coreState?.powerless).toBe(true);
    });
});
