import { describe, it, expect } from "vitest";
import {
    MOTION_TAG_RE,
    findMotionTagViolations,
    checkSvelteMarkup,
} from "../../bin/checkSvelteMarkup.mjs";

describe("checkSvelteMarkup", () => {
    it("MOTION_TAG_RE matches motion element tags only", () => {
        expect(MOTION_TAG_RE.test("<motion.div>")).toBe(true);
        expect(MOTION_TAG_RE.test("</motion.div>")).toBe(true);
        expect(MOTION_TAG_RE.test('<motion.span class="x">')).toBe(true);
        expect(MOTION_TAG_RE.test('<div class="x">')).toBe(false);
        expect(MOTION_TAG_RE.test('import { tweened } from "svelte/motion"')).toBe(false);
        expect(MOTION_TAG_RE.test("const motionLine = 1")).toBe(false);
    });

    it("findMotionTagViolations reports line numbers", () => {
        const sample = "<motion.div>bad</motion.div>\n</motion.span>\n";
        const hits = findMotionTagViolations(sample, "Sample.svelte");
        expect(hits).toHaveLength(2);
        expect(hits[0]).toMatchObject({ file: "Sample.svelte", line: 1 });
        expect(hits[1]).toMatchObject({ file: "Sample.svelte", line: 2 });
    });

    it("src tree has no motion.* tags", () => {
        expect(checkSvelteMarkup()).toEqual([]);
    });
});
