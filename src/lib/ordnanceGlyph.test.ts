import { describe, expect, it } from "vitest";
import { buildOrdnanceSymbol } from "./ordnanceGlyph";
import type { ShipGameState } from "@/lib/game/shipSystems";

describe("ordnanceGlyph", () => {
    it("rewrites symbol id to ordnance object id for map href", () => {
        const ship: ShipGameState = {
            id: "S1",
            object: {
                systems: [{ id: "mag1", name: "magazine", capacity: 3 }],
                ordnance: [
                    { id: "sl1", name: "salvoLauncher", leftArc: "FP", numArcs: 3, magazine: "mag1" },
                ],
            },
        };
        const spec = buildOrdnanceSymbol(ship, "sl1", "ord-1");
        expect(spec).toBeDefined();
        expect(spec!.svg).toContain('id="ord-1"');
        expect(spec!.svg).toContain('fill="white"');
        expect(spec!.svg).not.toMatch(/id="sml/);
    });

    it("uses magazine missile type for ER and multistage glyphs", () => {
        const erShip: ShipGameState = {
            id: "S1",
            object: {
                systems: [{ id: "mag1", name: "magazine", capacity: 3, modifier: "er" }],
                ordnance: [{ id: "sl1", name: "salvoLauncher", magazine: "mag1" }],
            },
        };
        expect(buildOrdnanceSymbol(erShip, "sl1", "ord-er")!.svg).toContain('fill="black"');

        const msShip: ShipGameState = {
            id: "S1",
            object: {
                systems: [{ id: "mag1", name: "magazine", capacity: 3, modifier: "twostage" }],
                ordnance: [{ id: "sl1", name: "salvoLauncher", magazine: "mag1" }],
            },
        };
        expect(buildOrdnanceSymbol(msShip, "sl1", "ord-ms")!.svg).toContain('viewBox="405 279 150 150"');
    });
});
