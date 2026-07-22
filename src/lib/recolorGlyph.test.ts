import { describe, expect, it } from "vitest";
import { ownerColour, recolorGlyphSvg } from "@/lib/recolorGlyph";

describe("recolorGlyphSvg", () => {
    it("replaces white fills and black strokes", () => {
        const svg =
            '<symbol><polygon fill="white" stroke="#000000"/><line stroke="black"/></symbol>';
        const out = recolorGlyphSvg(svg, "#ff0000", "#ffffff");
        expect(out).toContain('fill="#ff0000"');
        expect(out).toContain('stroke="#ffffff"');
        expect(out).not.toContain('fill="white"');
    });

    it("replaces ship counter fill colour", () => {
        const svg = '<path style="fill:#030303"/>';
        expect(recolorGlyphSvg(svg, "#00ff00", "#000")).toContain("fill:#00ff00");
    });
});

describe("ownerColour", () => {
    it("returns player colour by id", () => {
        expect(
            ownerColour(
                [
                    { id: "p1", colour: "#abc" },
                    { id: "p2", colour: "#def" },
                ],
                "p2"
            )
        ).toBe("#def");
    });
});
