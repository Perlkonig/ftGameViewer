import { describe, it, expect } from "vitest";
import {
    actActionLabel,
    defaultActActionForPhase,
    phaseAdvancePrompt,
    sortedActActions,
} from "./phase";
import { DEFAULT_META } from "./types";

describe("phase act actions", () => {
    it("sorts actions by earliest phase", () => {
        const keys = sortedActActions().map((a) => a.key);
        expect(keys.indexOf("placeShip")).toBeLessThan(keys.indexOf("launchOrdnance"));
        expect(keys.indexOf("launchOrdnance")).toBeLessThan(keys.indexOf("launchFighters"));
        expect(keys.indexOf("dogfight")).toBeLessThan(keys.indexOf("fireWeapon"));
        expect(keys.indexOf("damageControl")).toBeGreaterThan(-1);
    });

    it("labels actions with phase markers", () => {
        expect(actActionLabel(sortedActActions().find((a) => a.key === "moveShip")!)).toBe(
            "Move ship (phases 1, 5)"
        );
        expect(actActionLabel(sortedActActions().find((a) => a.key === "dogfight")!)).toBe(
            "Declare furball (phase 8)"
        );
    });

    it("picks a sensible default per phase", () => {
        expect(defaultActActionForPhase(5)).toBe("layMine");
        expect(defaultActActionForPhase(9)).toBe("pointDefense");
        expect(defaultActActionForPhase(10)).toBe("");
        expect(defaultActActionForPhase(1, { hasShips: false })).toBe("placeShip");
        expect(defaultActActionForPhase(1, { hasShips: true })).toBe("moveShip");
        expect(defaultActActionForPhase(2)).toBe("");
        expect(defaultActActionForPhase(13)).toBe("empAllocation");
    });

    it("maps advance prompts by phase", () => {
        expect(phaseAdvancePrompt(2)).toBe("initiative");
        expect(phaseAdvancePrompt(5)).toBeNull();
        expect(phaseAdvancePrompt(8)).toBeNull();
        expect(phaseAdvancePrompt(9)).toBeNull();
        expect(phaseAdvancePrompt(10)).toBeNull();
        expect(phaseAdvancePrompt(12)).toBeNull();
        expect(phaseAdvancePrompt(13)).toBe("threshold");
        expect(
            phaseAdvancePrompt(13, {
                meta: DEFAULT_META(),
                position: { map: { mode: "fixed", width: 72, height: 48 } },
                bankedEmpHits: { T1: { totalHits: 1, contributors: [] } },
            })
        ).toBe("emp");
        expect(defaultActActionForPhase(12)).toBe("boardingAttacker");
        expect(defaultActActionForPhase(12, { boardingStep: "defender" })).toBe(
            "boardingDefender"
        );
    });

    it("opens reactor prompt only when unstable reactors exist", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            objects: [
                {
                    objType: "ship",
                    id: "S1",
                    coreState: { powerless: true },
                },
            ],
        };
        const meta = { includeCoreSystemsInThreshold: true } as import("./types").GameMeta;
        expect(phaseAdvancePrompt(15, { meta, position })).toBe("reactor");
        expect(
            phaseAdvancePrompt(15, {
                meta: { includeCoreSystemsInThreshold: false } as import("./types").GameMeta,
                position,
            })
        ).toBeNull();
        expect(
            phaseAdvancePrompt(15, {
                meta,
                position: {
                    map: { mode: "fixed", width: 72, height: 48 },
                    objects: [{ objType: "ship", id: "S1", coreState: { dumped: true, powerless: true } }],
                },
            })
        ).toBeNull();
    });
});
