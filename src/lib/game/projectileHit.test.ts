import { describe, expect, it } from "vitest";
import { projectileHitThreshold, resolveProjectileToHit } from "./projectileHit";
import { arrayRollSource } from "./dice";

describe("projectileHitThreshold", () => {
    it("standard at 14 MU is 4+", () => {
        expect(projectileHitThreshold(14, "standard", 0)).toBe(4);
    });

    it("beyond max range is auto miss", () => {
        expect(projectileHitThreshold(31, "standard", 0)).toBeNull();
    });

    it("stealth 2 at 10 MU standard is 4+", () => {
        expect(projectileHitThreshold(10, "standard", 2)).toBe(4);
    });
});

describe("resolveProjectileToHit", () => {
    it("hits when roll meets threshold", () => {
        const r = resolveProjectileToHit(14, "standard", 0, arrayRollSource([4]));
        expect(r.hit).toBe(true);
        expect(r.threshold).toBe(4);
    });
});
