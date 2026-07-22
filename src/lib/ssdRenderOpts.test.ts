import { describe, it, expect } from "vitest";
import { buildShipRenderOpts } from "./ssdRenderOpts";

describe("buildShipRenderOpts", () => {
    it("marks knocked-out core systems disabled on the SSD", () => {
        const opts = buildShipRenderOpts({
            objType: "ship",
            id: "FrigateB2",
            object: { hull: { points: 5, rows: 4 }, systems: [], weapons: [] },
            coreState: {
                powerless: true,
                uncontrolled: 1,
                lifeless: 1,
            },
        } as never);

        expect(opts.disabled).toEqual(
            expect.arrayContaining(["_coreBridge", "_coreLife", "_corePower"])
        );
    });

    it("omits core ids when core systems are healthy", () => {
        const opts = buildShipRenderOpts({
            objType: "ship",
            id: "S1",
            object: { hull: { points: 12, rows: 3 }, systems: [], weapons: [] },
        } as never);

        expect(opts.disabled ?? []).not.toEqual(
            expect.arrayContaining(["_coreBridge", "_coreLife", "_corePower"])
        );
    });
});
