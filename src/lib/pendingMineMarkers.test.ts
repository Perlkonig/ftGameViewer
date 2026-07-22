import { describe, expect, it } from "vitest";
import {
    buildPendingMineMarkers,
    listPendingLayMineExploreEntries,
} from "./pendingMineMarkers";
import type { FullThrustGamePosition } from "@/schemas/position";

const position = (): FullThrustGamePosition => ({
    map: { mode: "fixed", width: 72, height: 48 },
    objects: [
        {
            objType: "ship",
            id: "A",
            owner: "P1",
            object: {},
            svg: "<symbol></symbol>",
            position: { x: 0, y: 0 },
            facing: 12,
            speed: 0,
        },
    ],
} as FullThrustGamePosition);

describe("pendingMineMarkers", () => {
    it("builds markers from pending layMine commands", () => {
        const markers = buildPendingMineMarkers(
            [
                {
                    name: "layMine",
                    ship: "A",
                    systemId: "ml1",
                    position: { x: 3, y: 4 },
                },
            ],
            position()
        );
        expect(markers).toHaveLength(1);
        expect(markers[0].owner).toBe("P1");
        expect(markers[0].position).toEqual({ x: 3, y: 4 });
    });

    it("lists explore entries for pending mines", () => {
        const entries = listPendingLayMineExploreEntries(
            [
                {
                    name: "layMine",
                    ship: "A",
                    systemId: "ml1",
                    position: { x: 1, y: 2 },
                },
            ],
            position()
        );
        expect(entries[0].detail).toMatch(/Pending/);
        expect(entries[0].label).toBe("A mine");
    });
});
