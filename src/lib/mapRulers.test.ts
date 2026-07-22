import { describe, expect, it } from "vitest";
import {
    generateRulerTicks,
    rulerSubdivisions,
    rulerTickLength,
} from "./mapRulers";

const ppm = 100;

describe("rulerSubdivisions", () => {
    it("shows whole MUs when zoomed out", () => {
        expect(rulerSubdivisions(3600, ppm)).toBe(1);
    });

    it("adds half and quarter ticks when zoomed in", () => {
        expect(rulerSubdivisions(1200, ppm)).toBe(2);
        expect(rulerSubdivisions(400, ppm)).toBe(4);
    });
});

describe("generateRulerTicks", () => {
    it("places major ticks on whole MU boundaries in map pixels", () => {
        const ticks = generateRulerTicks(4200, 800, ppm);
        const majors = ticks.filter((t) => t.level === "major");
        expect(majors.map((t) => t.coordPx)).toEqual([
            4200, 4300, 4400, 4500, 4600, 4700, 4800, 4900, 5000,
        ]);
    });

    it("tracks a shifted viewport when panned", () => {
        const ticks = generateRulerTicks(1000, 2400, ppm);
        expect(ticks.some((t) => t.coordPx === 1000 && t.level === "major")).toBe(true);
        expect(ticks.some((t) => t.coordPx === 3400 && t.level === "major")).toBe(true);
    });
});

describe("rulerTickLength", () => {
    it("uses full ruler height for major ticks", () => {
        expect(rulerTickLength("major", 100)).toBe(100);
        expect(rulerTickLength("half", 100)).toBe(50);
    });
});
