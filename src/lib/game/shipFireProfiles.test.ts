import { describe, expect, it } from "vitest";
import {
    inferShipFireProfile,
    shipFireProfile,
    allShipFireProfileKeys,
    canOperateAsShipFire,
    canOperateAsPointDefense,
} from "./shipFireProfiles";
import type { ShipSystemEntry } from "./shipSystems";

describe("inferShipFireProfile", () => {
    it("maps beam weapons", () => {
        expect(inferShipFireProfile({ id: "b", name: "beam", class: 2 })).toBe("beam");
    });

    it("maps heavy graser", () => {
        expect(inferShipFireProfile({ id: "g", name: "graser", heavy: true })).toBe(
            "graserHeavy"
        );
    });

    it("maps pulser by range", () => {
        expect(inferShipFireProfile({ id: "p", name: "pulser", range: "long" })).toBe(
            "pulserLong"
        );
    });

    it("maps fusion by mode", () => {
        expect(inferShipFireProfile({ id: "f", name: "fusion", mode: "torpedo" })).toBe(
            "fusionTorpedo"
        );
    });

    it("maps boarding torpedo launcher", () => {
        expect(inferShipFireProfile({ id: "bt", name: "boardingTorpedoLauncher" })).toBe(
            "boardingTorpedo"
        );
    });
});

describe("dual-use mounts", () => {
    const gatling: ShipSystemEntry = { id: "g", name: "gatling" };

    it("gatling can PD and ship fire", () => {
        expect(canOperateAsPointDefense(gatling)).toBe(true);
        expect(canOperateAsShipFire(gatling)).toBe(true);
    });
});

describe("registry coverage", () => {
    it("has profiles for all keys", () => {
        for (const key of allShipFireProfileKeys()) {
            expect(shipFireProfile(key).key).toBe(key);
        }
    });
});
