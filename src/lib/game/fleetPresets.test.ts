import { describe, expect, it } from "vitest";
import { fleetShipLabel, renameShipJson } from "./fleetPresets";

describe("fleetPresets", () => {
    it("formats ship labels", () => {
        expect(
            fleetShipLabel({
                name: "Harrison",
                class: "Scoutship",
                mass: 6,
            } as never)
        ).toBe("Harrison · Scoutship · mass 6");
    });

    it("renames ship JSON", () => {
        const json = JSON.stringify({ name: "Old", hull: { points: 2 } }, null, 2);
        const next = renameShipJson(json, "New Name");
        expect(JSON.parse(next).name).toBe("New Name");
    });
});
