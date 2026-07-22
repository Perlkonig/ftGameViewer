import { describe, expect, it } from "vitest";
import { counterLabel } from "./counterLabel";

describe("counterLabel", () => {
    it("zero-pads base and variant", () => {
        expect(counterLabel(1, 1)).toBe("001-01");
        expect(counterLabel(83, 10)).toBe("083-10");
        expect(counterLabel(134, 12)).toBe("134-12");
    });
});
