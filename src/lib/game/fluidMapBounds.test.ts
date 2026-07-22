import { describe, expect, it } from "vitest";
import {
    collectObjectExtents,
    computeMapBounds,
    expandBounds,
    isFluidDynamic,
    startingMapBounds,
} from "./fluidMapBounds";
import type { FullThrustGamePosition } from "@/schemas/position";

const fluidMap = { mode: "fluid" as const, width: 72, height: 48, buffer: 12 };
const fixedMap = { mode: "fixed" as const, width: 48, height: 36 };

describe("isFluidDynamic", () => {
    it("is false during turn 1 phase 1", () => {
        expect(isFluidDynamic({ turn: 1, phase: 1 })).toBe(false);
    });

    it("is true from turn 1 phase 2 onward", () => {
        expect(isFluidDynamic({ turn: 1, phase: 2 })).toBe(true);
        expect(isFluidDynamic({ turn: 2, phase: 1 })).toBe(true);
    });
});

describe("collectObjectExtents", () => {
    it("returns undefined when no positioned objects", () => {
        expect(collectObjectExtents({ objects: [] })).toBeUndefined();
    });

    it("includes objects and map features", () => {
        const position: FullThrustGamePosition = {
            objects: [
                {
                    objType: "ship",
                    id: "a",
                    position: { x: 10, y: 20 },
                },
            ],
            mapFeatures: [
                {
                    id: "planet",
                    symbol: "<symbol/>",
                    x: 50,
                    y: 40,
                    width: 10,
                    height: 8,
                },
            ],
        };
        expect(collectObjectExtents(position)).toEqual({
            minX: 10,
            minY: 20,
            maxX: 55,
            maxY: 44,
        });
    });
});

describe("computeMapBounds", () => {
    it("uses starting dimensions during turn 1 phase 1", () => {
        const bounds = computeMapBounds(
            fluidMap,
            {
                objects: [{ objType: "ship", id: "s", position: { x: 5, y: 5 } }],
            },
            { turn: 1, phase: 1 },
            12
        );
        expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 72, maxY: 48 });
    });

    it("fits objects plus buffer after phase gate", () => {
        const bounds = computeMapBounds(
            fluidMap,
            {
                objects: [{ objType: "ship", id: "s", position: { x: 10, y: 20 } }],
            },
            { turn: 1, phase: 2 },
            12
        );
        expect(bounds).toEqual({ minX: -2, minY: 8, maxX: 22, maxY: 32 });
    });

    it("falls back to starting size when dynamic and empty", () => {
        const bounds = computeMapBounds(fluidMap, { objects: [] }, { turn: 1, phase: 2 }, 12);
        expect(bounds).toEqual({ minX: -12, minY: -12, maxX: 84, maxY: 60 });
    });

    it("uses fixed map dimensions for fixed mode", () => {
        const bounds = computeMapBounds(
            fixedMap,
            {
                objects: [{ objType: "ship", id: "s", position: { x: 100, y: 100 } }],
            },
            { turn: 2, phase: 5 },
            0
        );
        expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 48, maxY: 36 });
    });
});

describe("startingMapBounds", () => {
    it("returns configured fluid starting size", () => {
        expect(startingMapBounds({ mode: "fluid", width: 60, height: 40, buffer: 8 })).toEqual({
            minX: 0,
            minY: 0,
            maxX: 60,
            maxY: 40,
        });
    });
});

describe("expandBounds", () => {
    it("pads uniformly", () => {
        expect(expandBounds({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 5)).toEqual({
            minX: -5,
            minY: -5,
            maxX: 15,
            maxY: 15,
        });
    });
});
