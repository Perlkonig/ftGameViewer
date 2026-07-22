import { describe, expect, it } from "vitest";
import type { FullThrustGamePosition } from "@/schemas/position";
import { arrayRollSource } from "./dice";
import {
    inferPblBeamClassFromLauncher,
    resolveAmtOpenSpaceBlast,
    resolvePblDetonationBlast,
} from "./ordnanceBlast";

describe("ordnanceBlast", () => {
    it("resolveAmtOpenSpaceBlast damages ships in radius", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            objects: [
                {
                    objType: "ordnance" as const,
                    id: "A1",
                    type: "amt",
                    position: { x: 0, y: 0 },
                    amtWarheadStrength: 2,
                    amtBlastRadius: 3,
                    detonateOpenSpace: true,
                },
                {
                    objType: "ship" as const,
                    id: "S1",
                    owner: "P2",
                    position: { x: 1, y: 0 },
                    object: { hull: { points: 12, rows: 3 } },
                },
            ],
        } as FullThrustGamePosition;
        const result = resolveAmtOpenSpaceBlast(position, "A1", arrayRollSource([4, 5]));
        expect(result.rolls).toHaveLength(2);
        expect(result.hits.some((h) => h.objectId === "S1")).toBe(true);
    });

    it("inferPblBeamClassFromLauncher reads weapon class", () => {
        const ship = {
            object: {
                weapons: [{ name: "pbl", id: "w1", class: 3 }],
            },
        };
        expect(inferPblBeamClassFromLauncher(ship as never, "w1")).toBe(3);
    });

    it("resolvePblDetonationBlast rolls per target", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            objects: [
                {
                    objType: "ordnance" as const,
                    id: "P1",
                    type: "plasmaBolt",
                    position: { x: 0, y: 0 },
                    range: 6,
                    beamClass: 1,
                },
                {
                    objType: "ship" as const,
                    id: "S1",
                    owner: "P2",
                    position: { x: 1, y: 0 },
                    object: { hull: { points: 12, rows: 3 } },
                },
            ],
        } as FullThrustGamePosition;
        const result = resolvePblDetonationBlast(position, "P1", arrayRollSource([4, 3]));
        expect(result.hits.length).toBeGreaterThan(0);
    });
});
