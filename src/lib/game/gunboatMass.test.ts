import { describe, expect, it } from "vitest";
import {
    gunboatSquadronMass,
    requiredBoatBayMass,
    squadronFitsBoatBay,
} from "./gunboatMass";

describe("gunboatMass", () => {
    it("computes mass for standard and FTL squadrons", () => {
        const boats = [{ type: "beam" as const }, { type: "beam" as const }];
        expect(gunboatSquadronMass(boats, false)).toBe(6);
        expect(requiredBoatBayMass(boats, false)).toBe(9);
        expect(gunboatSquadronMass(boats, true)).toBe(8);
    });

    it("checks boat bay fit", () => {
        const ship = {
            systems: [{ name: "bay", type: "boat", capacity: 1, id: "b1" }],
        };
        const boats = [{ type: "beam" as const }, { type: "beam" as const }];
        expect(squadronFitsBoatBay(ship as import("ftlibship").FullThrustShip, "b1", boats, false)).toBe(
            true
        );
    });
});
