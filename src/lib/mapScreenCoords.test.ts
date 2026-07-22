import { describe, expect, it } from "vitest";
import {
    clampViewportOrigin,
    fitViewportToMap,
    mapAspectRatio,
    viewportPixelsForBounds,
    viewportPixelsForFocus,
} from "./mapScreenCoords";

const ppm = 100;

describe("mapAspectRatio", () => {
    it("returns 1 for invalid dimensions", () => {
        expect(mapAspectRatio(0, 48)).toBe(1);
        expect(mapAspectRatio(72, 0)).toBe(1);
    });
});

describe("viewportPixelsForFocus", () => {
    it("keeps the board aspect ratio for a 72×48 map", () => {
        const { viewW, viewH } = viewportPixelsForFocus(24, 0, 0, 7200, 4800, ppm);
        expect(viewW / viewH).toBeCloseTo(7200 / 4800, 5);
        expect(viewH).toBe(2400);
        expect(viewW).toBe(3600);
    });

    it("uses a square viewport on a square map", () => {
        const { viewW, viewH } = viewportPixelsForFocus(24, 0, 0, 4800, 4800, ppm);
        expect(viewW).toBe(2400);
        expect(viewH).toBe(2400);
    });

    it("sizes by the shorter axis on a tall map", () => {
        const { viewW, viewH } = viewportPixelsForFocus(24, 0, 0, 4800, 9600, ppm);
        expect(viewW).toBe(2400);
        expect(viewH).toBe(4800);
        expect(viewW / viewH).toBeCloseTo(0.5, 5);
    });
});

describe("fitViewportToMap", () => {
    it("preserves aspect when clamping a zoomed-out viewport", () => {
        const { viewW, viewH } = fitViewportToMap(7200, 4800, 8000, 6000);
        expect(viewW).toBe(7200);
        expect(viewH).toBe(4800);
        expect(viewW / viewH).toBeCloseTo(1.5, 5);
    });

    it("preserves aspect on a square map", () => {
        const { viewW, viewH } = fitViewportToMap(5000, 5000, 6000, 4500);
        expect(viewW).toBe(5000);
        expect(viewH).toBe(5000);
    });
});

describe("viewportPixelsForBounds", () => {
    it("covers bounds with map aspect on a square board", () => {
        const vp = viewportPixelsForBounds(1000, 1000, 2000, 2000, 200, 0, 0, 4800, 4800);
        expect(vp.viewW / vp.viewH).toBeCloseTo(1, 5);
        expect(vp.viewW).toBeGreaterThanOrEqual(1200);
        expect(vp.viewH).toBeGreaterThanOrEqual(1200);
    });
});

describe("clampViewportOrigin", () => {
    it("centers when the focus point has room on both sides", () => {
        expect(clampViewportOrigin(4270, 2400, 7200)).toBe(3070);
    });

    it("pins to the map edge when centering would show out-of-bounds area", () => {
        expect(clampViewportOrigin(500, 2400, 7200)).toBe(0);
        expect(clampViewportOrigin(7000, 2400, 7200)).toBe(4800);
    });

    it("respects a non-zero board minimum", () => {
        expect(clampViewportOrigin(500, 2400, 6200, 1000)).toBe(1000);
        expect(clampViewportOrigin(6000, 2400, 6200, 1000)).toBe(3800);
    });
});
