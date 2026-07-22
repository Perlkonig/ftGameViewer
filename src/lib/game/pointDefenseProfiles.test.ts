import { describe, expect, it } from "vitest";
import type { FullThrustGamePosition } from "@/schemas/position";
import { arrayRollSource } from "./dice";
import {
    resolvePointDefenseProfile,
    resolveFighterPdSelfDestruct,
    threatKindForTarget,
    defaultPdsDiceForWeapon,
} from "./pointDefenseProfiles";
import { resolvePdsDie } from "./combat";

describe("pointDefenseProfiles", () => {
    it("pds kills on 4-5", () => {
        const r = resolvePointDefenseProfile("pds", "fighters", arrayRollSource([4]), 1);
        expect(r.kills).toBe(1);
    });

    it("beam1 vs heavy needs 6", () => {
        expect(
            resolvePointDefenseProfile("beam1", "heavy", arrayRollSource([5]), 1).kills
        ).toBe(0);
        expect(
            resolvePointDefenseProfile("beam1", "heavy", arrayRollSource([6]), 1).kills
        ).toBe(1);
    });

    it("grapeshot rolls 4 dice", () => {
        const r = resolvePointDefenseProfile(
            "grapeshot",
            "fighters",
            arrayRollSource([4, 3, 5, 2]),
            4
        );
        expect(r.kills).toBe(2);
        expect(r.rolls.length).toBeGreaterThanOrEqual(4);
    });

    it("k1 applies -1 DRM", () => {
        const r = resolvePointDefenseProfile("k1", "fighters", arrayRollSource([6]), 1);
        expect(r.kills).toBeGreaterThanOrEqual(1);
    });

    it("fighter self-destruct on 6", () => {
        const r = resolveFighterPdSelfDestruct(2, arrayRollSource([6, 3]));
        expect(r.losses).toBe(1);
    });

    it("threatKindForTarget distinguishes heavy", () => {
        expect(threatKindForTarget("ordnance", "missile")).toBe("heavy");
        expect(threatKindForTarget("ordnance", "salvo")).toBe("salvo");
    });

    it("pds die matches combat helper", () => {
        expect(resolvePdsDie(arrayRollSource([6, 4])).kills).toBe(3);
    });

    it("defaultPdsDiceForWeapon uses grapeshot pool size", () => {
        expect(defaultPdsDiceForWeapon({ name: "pds" })).toBe(1);
        expect(defaultPdsDiceForWeapon({ name: "grapeshot" })).toBe(4);
    });
});
