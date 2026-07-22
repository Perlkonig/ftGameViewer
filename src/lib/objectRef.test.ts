import { describe, it, expect } from "vitest";
import { parseObjectRef, objectRefKey, resolveObjectRef } from "./objectRef";

describe("parseObjectRef", () => {
    it("parses prefixed ids with underscores in the object id", () => {
        expect(parseObjectRef("ship_Player1_Cruiser")).toEqual({
            objType: "ship",
            objId: "Player1_Cruiser",
        });
        expect(parseObjectRef("fighters_wing_alpha")).toEqual({
            objType: "fighters",
            objId: "wing_alpha",
        });
    });

    it("round-trips through objectRefKey", () => {
        const ref = { objType: "ship" as const, objId: "A_B_C" };
        expect(parseObjectRef(objectRefKey(ref))).toEqual(ref);
    });

    it("resolves bare ids from the object list", () => {
        const objects = [
            { objType: "ship" as const, id: "Player1_Cruiser" },
            { objType: "fighters" as const, id: "wing_1" },
        ] as import("@/schemas/position").FullThrustGameObjects[];
        expect(resolveObjectRef("Player1_Cruiser", objects)).toEqual({
            objType: "ship",
            objId: "Player1_Cruiser",
        });
        expect(resolveObjectRef("ship_Player1_Cruiser", objects)).toEqual({
            objType: "ship",
            objId: "Player1_Cruiser",
        });
    });
});
