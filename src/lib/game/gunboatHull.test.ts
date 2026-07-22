import { describe, expect, it } from "vitest";
import { arrayRollSource } from "./dice";
import { applyGunboatKills } from "./gunboatHull";

describe("applyGunboatKills", () => {
    it("syncs number and boats", () => {
        const squad = {
            id: "g1",
            number: 3,
            boats: [{ type: "beam" }, { type: "plasma" }, { type: "beam" }],
        };
        applyGunboatKills(squad, 1, arrayRollSource([2]));
        expect(squad.number).toBe(2);
        expect(squad.boats?.length).toBe(2);
    });
});
