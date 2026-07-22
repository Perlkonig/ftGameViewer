import { describe, expect, it } from "vitest";
import {
    fighterGroupLabel,
    fighterGroupOptionLabel,
    normalizeCallsign,
    wingLaunchRowLabel,
} from "./fighterLabel";

describe("fighterLabel", () => {
    it("normalizeCallsign trims and caps length", () => {
        expect(normalizeCallsign("  Red 1  ")).toBe("Red 1");
        expect(normalizeCallsign("")).toBeUndefined();
        expect(normalizeCallsign("   ")).toBeUndefined();
        expect(normalizeCallsign("x".repeat(40))?.length).toBe(32);
    });

    it("fighterGroupLabel prefers callsign over id", () => {
        expect(fighterGroupLabel({ id: "C1_h1", callsign: "Red 1" })).toBe("Red 1");
        expect(fighterGroupLabel({ id: "C1_h1" })).toBe("C1_h1");
    });

    it("fighterGroupOptionLabel includes type and count", () => {
        expect(
            fighterGroupOptionLabel({
                objType: "fighters",
                id: "C1_h1",
                callsign: "CAP",
                type: "heavy",
                number: 6,
            } as never)
        ).toBe("CAP (heavy ×6)");
    });

    it("wingLaunchRowLabel shows callsign when set", () => {
        const w = {
            hangarId: "h1",
            type: "heavy",
            number: 6,
            skill: "standard",
        } as import("ftlibship").ResolvedHangarOccupancy;
        expect(wingLaunchRowLabel("h1", w)).toBe("h1: heavy ×6");
        expect(
            wingLaunchRowLabel("h1", w, {
                objType: "fighters",
                id: "C1_h1",
                callsign: "Red 1",
                type: "heavy",
                number: 6,
            } as never)
        ).toBe("Red 1 — heavy ×6");
    });
});
