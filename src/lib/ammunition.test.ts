import { describe, expect, it } from "vitest";
import {
    ammunitionRemaining,
    ammunitionSourceForLauncher,
    buildAmmunitionRemaining,
    canConsumeAmmunition,
    consumeAmmunitionPatch,
    consumeLauncherAmmunitionPatch,
} from "./ammunition";
import type { ShipGameState } from "@/lib/game/shipSystems";

const minelayerShip = (ammo: string[] = []): ShipGameState => ({
    id: "s1",
    object: {
        systems: [{ id: "ml1", name: "mineLayer", capacity: 2 }],
    },
    systems: [],
    ammo,
});

describe("ammunition", () => {
    it("omits full magazines from buildAmmunitionRemaining", () => {
        expect(buildAmmunitionRemaining(minelayerShip())).toEqual({});
        expect(buildAmmunitionRemaining(minelayerShip(["ml1"]))).toEqual({ ml1: 1 });
    });

    it("matches resolveAmmunitionRemaining parity", () => {
        const ship = minelayerShip(["ml1", "ml1"]);
        expect(ammunitionRemaining(ship, "ml1")).toBe(0);
        expect(canConsumeAmmunition(ship, "ml1")).toBe(false);
    });

    it("consumeAmmunitionPatch appends system id", () => {
        expect(consumeAmmunitionPatch(minelayerShip(), "ml1")).toEqual(["ml1"]);
    });

    it("resolves magazine id for salvo launchers", () => {
        const ship: ShipGameState = {
            id: "s1",
            object: {
                systems: [{ id: "mag1", name: "magazine", capacity: 3 }],
                ordnance: [{ id: "sl1", name: "salvoLauncher", magazine: "mag1" }],
            },
            ammo: [],
        };
        expect(ammunitionSourceForLauncher(ship, "sl1")).toBe("mag1");
        expect(ammunitionSourceForLauncher(ship, "mag1")).toBe("mag1");
        expect(consumeLauncherAmmunitionPatch(ship, "sl1")).toEqual(["mag1"]);
        const after = { ...ship, ammo: consumeLauncherAmmunitionPatch(ship, "sl1") };
        expect(buildAmmunitionRemaining(after)).toEqual({ mag1: 2 });
    });
});
