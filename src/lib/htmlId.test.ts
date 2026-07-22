import { describe, expect, it } from "vitest";
import {
    assertValidHtmlUid,
    gameUidCollision,
    isValidHtmlUid,
    screenHtmlUid,
} from "./htmlId";
import type { FullThrustGamePosition } from "@/schemas/position";

describe("htmlId", () => {
    it("screens invalid characters", () => {
        expect(screenHtmlUid("Player 1/Cruiser")).toBe("Player1Cruiser");
        expect(screenHtmlUid("alpha_beta-2")).toBe("alpha_beta-2");
    });

    it("validates uids", () => {
        expect(isValidHtmlUid("ship_01")).toBe(true);
        expect(isValidHtmlUid("bad id")).toBe(false);
        expect(isValidHtmlUid("")).toBe(false);
    });

    it("asserts with context", () => {
        expect(() => assertValidHtmlUid("ok", "placeShip")).not.toThrow();
        expect(() => assertValidHtmlUid("nope!", "launchFighters")).toThrow(/launchFighters/);
    });

    it("detects uid collisions in game state", () => {
        const state = {
            players: [{ id: "Alice", colour: "#ff0000", vp: 0 }],
            objects: [
                {
                    objType: "ship" as const,
                    id: "Cruiser_1",
                    object: { thrust: 4, systems: [{ id: "beam1", name: "beam" }] },
                    systems: [],
                    owner: "Alice",
                    position: { x: 0, y: 0 },
                    facing: 12,
                    speed: 0,
                    svg: "<symbol viewBox='0 0 1 1'></symbol>",
                },
            ],
        } as unknown as FullThrustGamePosition;
        expect(gameUidCollision(state, "Cruiser_1")).toMatch(/ship/);
        expect(gameUidCollision(state, "Alice")).toMatch(/player/);
        expect(gameUidCollision(state, "beam1")).toMatch(/SSD system/);
        expect(gameUidCollision(state, "New_Ship")).toBeNull();
    });
});
