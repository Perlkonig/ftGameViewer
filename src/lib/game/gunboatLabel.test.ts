import { describe, expect, it } from "vitest";
import {
    formatGunboatComposition,
    gunboatBoatTypeCounts,
} from "./gunboatLabel";

describe("gunboatLabel composition", () => {
    it("aggregates boats array", () => {
        const counts = gunboatBoatTypeCounts({
            number: 3,
            boats: [{ type: "beam" }, { type: "beam" }, { type: "plasma" }],
        });
        expect(counts.get("beam")).toBe(2);
        expect(counts.get("plasma")).toBe(1);
    });

    it("formats abbrev composition", () => {
        const s = formatGunboatComposition(
            {
                number: 2,
                boats: [{ type: "beam" }, { type: "plasma" }],
            },
            "abbrev"
        );
        expect(s).toContain("×1");
        expect(s).toContain(",");
    });
});
