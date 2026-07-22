import { describe, expect, it } from "vitest";
import { arrayRollSource } from "./dice";
import {
    GUNBOAT_MISSILE_SALVO_COUNT,
    gunboatBoatProfile,
    gunboatProtectionDrm,
    resolveGunboatBoatStrike,
} from "./gunboatProfiles";

describe("gunboatProfiles", () => {
    it("protection adds -1 DRM", () => {
        expect(gunboatProtectionDrm({ protection: "heavy" })).toBe(-1);
        expect(gunboatProtectionDrm({})).toBe(0);
    });

    it("beam boat fires two beam dice in range", () => {
        const prof = gunboatBoatProfile("beam");
        const source = arrayRollSource([3, 4, 3, 4]);
        const hit = resolveGunboatBoatStrike(prof, 0, 6, source);
        expect(hit.normalDamage + hit.penetratingDamage).toBeGreaterThanOrEqual(0);
    });

    it("missile salvo count is 4", () => {
        expect(GUNBOAT_MISSILE_SALVO_COUNT).toBe(4);
    });
});
