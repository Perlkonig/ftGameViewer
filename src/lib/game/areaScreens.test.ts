import { describe, it, expect } from "vitest";
import { arrayRollSource } from "./dice";
import {
    resolveBeamDieSplit,
    screenLevelFromSystems,
    type ScreenLevel,
} from "./combat";
import { effectiveIntrinsicScreens } from "./shipSystems";
import {
    areaScreenBonus,
    effectiveScreensForIncomingFire,
    AREA_SCREEN_RADIUS_MU,
} from "./areaScreens";
import type { FullThrustGamePosition } from "@/schemas/position";

describe("screenLevelFromSystems", () => {
    it("returns 0 with no screen systems", () => {
        expect(screenLevelFromSystems([{ name: "drive" }])).toBe(0);
    });

    it("defaults missing level to 1", () => {
        expect(screenLevelFromSystems([{ name: "screen" }, { name: "screen" }])).toBe(1);
    });

    it("uses max level across redundant screens capped at 2", () => {
        expect(
            screenLevelFromSystems([
                { name: "screen", level: 1 },
                { name: "screen", level: 2 },
            ])
        ).toBe(2);
    });

    it("ignores area flag for intrinsic level", () => {
        expect(screenLevelFromSystems([{ name: "screen", area: true }])).toBe(1);
    });

    it("does not match substring screen names", () => {
        expect(screenLevelFromSystems([{ name: "holofields" }])).toBe(0);
    });
});

describe("effectiveIntrinsicScreens", () => {
    it("ignores destroyed screen systems", () => {
        const ship = {
            id: "S1",
            object: { systems: [{ name: "screen", id: "sc1", level: 2 }] },
            systems: [{ id: "sc1", state: "destroyed" }],
        };
        expect(effectiveIntrinsicScreens(ship)).toBe(0);
    });
});

describe("areaScreenBonus", () => {
    const donor = {
        id: "D1",
        objType: "ship" as const,
        position: { x: 0, y: 0 },
        object: { systems: [{ name: "screen", area: true, id: "a1" }] },
        systems: [],
    };
    const frigate = {
        id: "F1",
        objType: "ship" as const,
        position: { x: 4, y: 0 },
        object: { systems: [{ name: "screen", id: "s1" }] },
        systems: [],
    };

    const position = {
        map: { mode: "fixed" as const, width: 72, height: 48 },
        objects: [donor, frigate],
    } satisfies FullThrustGamePosition;

    it("grants +1 to ship within bubble", () => {
        expect(areaScreenBonus(position, frigate)).toBe(1);
        expect(
            effectiveScreensForIncomingFire(position, frigate, { x: 20, y: 0 })
        ).toBe(2);
    });

    it("denies bonus when attacker is inside donor bubble", () => {
        expect(areaScreenBonus(position, frigate, { x: 2, y: 0 })).toBe(0);
        expect(
            effectiveScreensForIncomingFire(position, frigate, { x: 2, y: 0 })
        ).toBe(1);
    });

    it("caps effective screens at 3", () => {
        const heavy = {
            ...frigate,
            id: "H1",
            object: { systems: [{ name: "screen", level: 2, id: "s2" }] },
        };
        const pos = { ...position, objects: [donor, heavy] };
        expect(
            effectiveScreensForIncomingFire(pos, heavy, { x: 20, y: 0 })
        ).toBe(3);
    });

    it("does not stack multiple donors", () => {
        const donor2 = {
            ...donor,
            id: "D2",
            position: { x: 8, y: 0 },
        };
        const pos = { ...position, objects: [donor, donor2, frigate] };
        expect(areaScreenBonus(pos, frigate)).toBe(1);
    });

    it("requires target within radius", () => {
        const far = {
            ...frigate,
            position: { x: AREA_SCREEN_RADIUS_MU + 1, y: 0 },
        };
        const pos = { ...position, objects: [donor, far] };
        expect(areaScreenBonus(pos, far)).toBe(0);
    });
});

describe("resolveBeamDieSplit at screen 3", () => {
    it("suppresses penetrating reroll on natural 6", () => {
        const source = arrayRollSource([6, 5]);
        const { result } = resolveBeamDieSplit(source, 3 as ScreenLevel);
        expect(result.normalDamage).toBe(1);
        expect(result.penetratingDamage).toBe(0);
        expect(result.rerolls).toEqual([]);
    });

    it("still allows penetrating reroll at screen 2", () => {
        const source = arrayRollSource([6, 5]);
        const { result } = resolveBeamDieSplit(source, 2);
        expect(result.penetratingDamage).toBe(1);
    });
});
