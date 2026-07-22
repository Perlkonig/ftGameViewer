import { describe, expect, it } from "vitest";
import {
    formatAppliedDamage,
    formatNeedleResultNotes,
    formatPdsResultNotes,
    makeLogDice,
} from "./rollResults";

describe("makeLogDice", () => {
    it("includes result when provided", () => {
        const cmd = makeLogDice({
            purpose: "test",
            rolls: [4],
            result: "Hit: 1 damage (1 hull)",
        }) as { result?: string };
        expect(cmd.result).toBe("Hit: 1 damage (1 hull)");
    });
});

describe("formatPdsResultNotes", () => {
    it("reports miss with zero kills", () => {
        expect(formatPdsResultNotes(0)).toBe("Miss");
    });

    it("reports fighter kills", () => {
        expect(formatPdsResultNotes(2, "fighters", 6, 4)).toBe(
            "Hit: 2 kill(s) (6 → 4 fighters)"
        );
    });
});

describe("formatAppliedDamage", () => {
    it("notes ship destruction when requested", () => {
        expect(
            formatAppliedDamage(4, { hullDamage: 2, armourDamage: [1] }, { destroyed: true })
        ).toBe("Hit: 4 damage (1 armour, 2 hull); ship destroyed");
    });
});

describe("formatNeedleResultNotes", () => {
    it("reports hit on 6", () => {
        expect(formatNeedleResultNotes(6, "reactor")).toBe("Hit: destroyed reactor");
    });

    it("reports miss otherwise", () => {
        expect(formatNeedleResultNotes(3, "reactor")).toBe(
            "Miss (rolled 3; need 6 to destroy reactor)"
        );
    });
});
