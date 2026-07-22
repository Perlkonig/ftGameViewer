import { describe, expect, it } from "vitest";
import {
    GUNBOAT_ATTACK_RANGE_MU,
    gunboatAttackRangeWarnings,
} from "./gunboatAttack";
import { GUNBOAT_MOVE_MU, GUNBOAT_SECONDARY_MU, validateMoveGunboatsSoft } from "./gunboatMove";
import { DEFAULT_META } from "./types";

describe("gunboatMove", () => {
    it("uses 18 MU primary and 9 MU secondary", () => {
        expect(GUNBOAT_MOVE_MU).toBe(18);
        expect(GUNBOAT_SECONDARY_MU).toBe(9);
        const issues = validateMoveGunboatsSoft(
            { x: 0, y: 0 },
            { x: 20, y: 0 },
            { phase: 4, endurance: 6 }
        );
        expect(issues.some((i) => i.message.includes("20.0"))).toBe(true);
    });
});

describe("gunboatAttack", () => {
    it("warns beyond 12 MU", () => {
        const position = {
            players: [{ id: "p1" }],
            objects: [
                {
                    objType: "gunboats",
                    id: "g1",
                    owner: "p1",
                    position: { x: 0, y: 0 },
                    number: 6,
                },
                {
                    objType: "ship",
                    id: "s2",
                    owner: "p2",
                    position: { x: 20, y: 0 },
                },
            ],
        };
        const issues = gunboatAttackRangeWarnings(position, "g1", "ship", "s2");
        expect(issues.some((i) => i.message.includes("12"))).toBe(true);
        expect(GUNBOAT_ATTACK_RANGE_MU).toBe(12);
    });
});
