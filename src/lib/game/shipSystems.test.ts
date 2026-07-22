import { describe, expect, it } from "vitest";
import {
    shipThrust,
    operationalPdsEntries,
    operationalPointDefenseMounts,
    shipFireWeaponEntries,
    isSingleUseOrdnanceRack,
    isNonRepairableSystem,
    type ShipGameState,
} from "./shipSystems";

const ship = (object: unknown, systems?: ShipGameState["systems"]): ShipGameState => ({
    id: "TestShip",
    object,
    systems,
});

describe("shipThrust", () => {
    it("reads thrust from drive systems in ship JSON", () => {
        expect(
            shipThrust(
                ship({
                    systems: [{ name: "drive", thrust: 6, id: "d1" }],
                })
            )
        ).toBe(6);
    });

    it("supports legacy object.thrust", () => {
        expect(shipThrust(ship({ thrust: 8, systems: [] }))).toBe(8);
    });

    it("halves thrust for damaged drives", () => {
        expect(
            shipThrust(
                ship(
                    { systems: [{ name: "drive", thrust: 6, id: "d1" }] },
                    [{ id: "d1", state: "damaged" }]
                )
            )
        ).toBe(3);
    });

    it("ignores destroyed drives", () => {
        expect(
            shipThrust(
                ship(
                    { systems: [{ name: "drive", thrust: 6, id: "d1" }] },
                    [{ id: "d1", state: "destroyed" }]
                )
            )
        ).toBe(0);
    });

    it("defaults to 4 when no drive is defined", () => {
        expect(shipThrust(ship({ systems: [{ name: "beam", id: "b1" }] }))).toBe(4);
    });
});

describe("weapon entry helpers", () => {
    const armed: ShipGameState = {
        id: "Warship",
        object: {
            weapons: [
                { name: "pds", id: "p1" },
                { name: "adfc", id: "a1" },
                { name: "beam", id: "b1" },
                { name: "graser", id: "g1" },
            ],
        },
    };

    it("operationalPdsEntries lists pds and legacy adfc weapon", () => {
        const pds = operationalPdsEntries(armed);
        expect(pds.map((p) => p.id)).toEqual(["p1", "a1"]);
    });

    it("operationalPointDefenseMounts includes beam-1 and pds", () => {
        const mounts = operationalPointDefenseMounts({
            id: "W",
            object: {
                weapons: [
                    { name: "pds", id: "p1" },
                    { name: "beam", id: "b1", class: 1 },
                    { name: "beam", id: "b2", class: 2 },
                ],
            },
        });
        expect(mounts.map((m) => m.id)).toEqual(["p1", "b1"]);
    });

    it("shipFireWeaponEntries excludes PDS mounts", () => {
        const weapons = shipFireWeaponEntries(armed);
        expect(weapons.map((w) => w.id)).toEqual(["b1", "g1"]);
    });

    it("excludes destroyed PDS from operational lists", () => {
        const damaged: ShipGameState = {
            ...armed,
            systems: [{ id: "p1", state: "destroyed" }],
        };
        expect(operationalPdsEntries(damaged).map((p) => p.id)).toEqual(["a1"]);
        expect(shipFireWeaponEntries(damaged).map((w) => w.id)).toEqual(["b1", "g1"]);
    });
});

describe("repairability helpers", () => {
    it("identifies single-use ordnance racks", () => {
        expect(isSingleUseOrdnanceRack({ id: "s1", name: "salvo" })).toBe(true);
        expect(isSingleUseOrdnanceRack({ id: "a1", name: "amt" })).toBe(true);
        expect(isSingleUseOrdnanceRack({ id: "m1", name: "missile" })).toBe(true);
        expect(isSingleUseOrdnanceRack({ id: "ml1", name: "missile", magazine: "mag1" })).toBe(
            false
        );
        expect(isSingleUseOrdnanceRack({ id: "sl1", name: "salvoLauncher", magazine: "mag1" })).toBe(
            false
        );
    });

    it("marks magazines and racks as non-repairable", () => {
        expect(isNonRepairableSystem({ id: "mag1", name: "magazine" })).toBe(true);
        expect(isNonRepairableSystem({ id: "s1", name: "salvo" })).toBe(true);
        expect(isNonRepairableSystem({ id: "b1", name: "beam" })).toBe(false);
    });
});
