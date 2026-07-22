import { describe, expect, it } from "vitest";
import type { FullThrustGameObjects } from "@/schemas/position";
import { isObjectInViewport, listExploreObjects, objectMass, shipCpv, shipNpv, shipDesignStats, shipsOnMap, isShipOnMap, formatObjectMotionLine } from "./exploreObjects";

const ship = (
    id: string,
    owner: string | undefined,
    mass: number,
    x: number,
    y: number
): FullThrustGameObjects =>
    ({
        objType: "ship",
        id,
        owner,
        object: { mass },
        svg: "<symbol viewBox='0 0 1 1'></symbol>",
        position: { x, y },
        facing: 12,
        speed: 0,
    }) as FullThrustGameObjects;

describe("exploreObjects", () => {
    it("sorts by player order then ship mass descending", () => {
        const objects = [
            ship("Heavy", "Player 2", 120, 5, 5),
            ship("LightP1", "Player 1", 16, 5, 5),
            ship("HeavyP1", "Player 1", 89, 5, 5),
            ship("Unowned", undefined, 40, 5, 5),
        ];
        const listed = listExploreObjects(objects, ["Player 1", "Player 2"]);
        expect(listed.map((e) => e.id)).toEqual([
            "HeavyP1",
            "LightP1",
            "Heavy",
            "Unowned",
        ]);
    });

    it("sorts ships before fighters before ordnance within a player", () => {
        const objects = [
            {
                objType: "ordnance",
                id: "m1",
                owner: "Player 1",
                type: "missile",
                position: { x: 1, y: 1 },
            },
            {
                objType: "fighters",
                id: "SqB",
                owner: "Player 1",
                callsign: "Bravo",
                type: "standard",
                position: { x: 2, y: 2 },
                number: 6,
                endurance: 6,
                skill: "standard",
            },
            ship("Cruiser", "Player 1", 60, 3, 3),
            {
                objType: "ordnance",
                id: "m2",
                owner: "Player 1",
                type: "missile",
                position: { x: 4, y: 4 },
            },
            {
                objType: "fighters",
                id: "SqA",
                owner: "Player 1",
                callsign: "Alpha",
                type: "standard",
                position: { x: 5, y: 5 },
                number: 6,
                endurance: 6,
                skill: "standard",
            },
            ship("Frigate", "Player 1", 30, 6, 6),
        ] as FullThrustGameObjects[];

        expect(listExploreObjects(objects, ["Player 1"]).map((e) => e.id)).toEqual([
            "Cruiser",
            "Frigate",
            "SqA",
            "SqB",
            "m1",
            "m2",
        ]);
    });

    it("filters to the current viewport", () => {
        const objects = [
            ship("Near", "Player 1", 20, 5, 5),
            ship("Far", "Player 1", 20, 50, 50),
        ];
        const viewport = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
        expect(
            listExploreObjects(objects, ["Player 1"], { scope: "visible", viewport }).map(
                (e) => e.id
            )
        ).toEqual(["Near"]);
        expect(listExploreObjects(objects, ["Player 1"]).map((e) => e.id)).toEqual([
            "Far",
            "Near",
        ]);
        expect(isObjectInViewport(objects[1], viewport)).toBe(false);
    });

    it("reads ship mass", () => {
        expect(objectMass(ship("A", "Player 1", 42, 0, 0))).toBe(42);
    });

    it("reads ship cpv and npv", () => {
        const s = {
            ...ship("B", "Player 1", 6, 0, 0),
            object: { mass: 6, points: 21, cpv: 16 },
        } as FullThrustGameObjects;
        expect(shipCpv(s)).toBe(16);
        expect(shipNpv(s)).toBe(21);
        expect(shipDesignStats(s)).toEqual({ mass: 6, cpv: 16, npv: 21 });
    });

    it("fleet summary only counts ships on the map using as-built design", () => {
        const hidden = {
            ...ship("Hidden", "Player 1", 100, 0, 0),
            object: { mass: 100, points: 200, cpv: 150 },
            position: null,
        } as FullThrustGameObjects;
        const onMap = {
            ...ship("Active", "Player 1", 40, 5, 5),
            object: { mass: 40, points: 80, cpv: 60 },
        } as FullThrustGameObjects;
        const fighter = {
            objType: "fighters",
            id: "Sq1",
            owner: "Player 1",
            type: "standard",
            position: { x: 4, y: 7 },
            number: 6,
            endurance: 6,
            skill: "standard",
        } as FullThrustGameObjects;
        const objects = [hidden, onMap, fighter];
        expect(isShipOnMap(hidden)).toBe(false);
        expect(isShipOnMap(onMap)).toBe(true);
        expect(isShipOnMap(fighter)).toBe(false);
        expect(shipsOnMap(objects).map((o) => o.id)).toEqual(["Active"]);
        const totals = shipsOnMap(objects)
            .filter((o) => o.owner === "Player 1")
            .map((o) => shipDesignStats(o)!)
            .reduce(
                (acc, d) => ({
                    ships: acc.ships + 1,
                    mass: acc.mass + (d.mass ?? 0),
                    cpv: acc.cpv + (d.cpv ?? 0),
                    npv: acc.npv + (d.npv ?? 0),
                }),
                { ships: 0, mass: 0, cpv: 0, npv: 0 }
            );
        expect(totals).toEqual({ ships: 1, mass: 40, cpv: 60, npv: 80 });
    });

    it("tolerates invalid playerIds input", () => {
        const objects = [ship("Near", "Player 1", 20, 5, 5)];
        const viewport = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
        expect(
            listExploreObjects(objects, { minX: 0 } as unknown as string[], { scope: "visible", viewport })
        ).toHaveLength(1);
    });

    it("includes motion line with coordinates and movement state", () => {
        const vectorShip = {
            ...ship("Vector", "Player 1", 30, 12.25, 8.5),
            facing: 3,
            course: 15,
            speed: 6,
        } as FullThrustGameObjects;
        const fighter = {
            objType: "fighters",
            id: "Sq1",
            owner: "Player 1",
            type: "standard",
            position: { x: 4, y: 7 },
            facing: 9,
            number: 4,
            endurance: 6,
            skill: "standard",
        } as FullThrustGameObjects;
        const mine = {
            objType: "ordnance",
            id: "mine_a",
            type: "mine",
            position: { x: 20, y: 11 },
        } as FullThrustGameObjects;

        expect(formatObjectMotionLine(vectorShip, { x: 12.25, y: 8.5 })).toBe(
            "12.3, 8.5 · facing 3 · course 15° · speed 6"
        );
        expect(formatObjectMotionLine(fighter, { x: 4, y: 7 })).toBe("4.0, 7.0 · facing 9");
        expect(formatObjectMotionLine(mine, { x: 20, y: 11 })).toBe("20.0, 11.0");

        const listed = listExploreObjects([vectorShip, fighter, mine], ["Player 1"]);
        expect(listed.find((e) => e.id === "Vector")?.motionLine).toContain("speed 6");
        expect(listed.find((e) => e.id === "Sq1")?.detail).toBe(
            "Fighters · standard ×4 · endurance 6"
        );
        expect(listed.find((e) => e.id === "Sq1")?.motionLine).toBe("4.0, 7.0 · facing 9");
        expect(listed.find((e) => e.id === "mine_a")?.motionLine).toBe("20.0, 11.0");
    });

    it("shows fighter callsign in explore list label", () => {
        const fighter = {
            objType: "fighters",
            id: "C1_h1",
            owner: "Player 1",
            callsign: "Red 1",
            type: "heavy",
            position: { x: 4, y: 7 },
            facing: 9,
            number: 6,
            endurance: 6,
            skill: "standard",
        } as FullThrustGameObjects;
        const listed = listExploreObjects([fighter], ["Player 1"]);
        expect(listed[0]?.label).toBe("Red 1");
        expect(listed[0]?.detail).toBe("Fighters · heavy ×6 · endurance 6 · C1_h1");
    });

    it("lists deployed gunboats on the map", () => {
        const gunboat = {
            objType: "gunboats",
            id: "GunShip_9WLZn",
            owner: "Player 1",
            squadronKey: "9WLZn",
            type: "beam",
            position: { x: 41, y: 30 },
            facing: 2,
            number: 6,
            endurance: 6,
            skill: "standard",
            callsign: "Gun Escort",
        } as FullThrustGameObjects;
        const listed = listExploreObjects([gunboat], ["Player 1"]);
        expect(listed).toHaveLength(1);
        expect(listed[0]?.label).toBe("Gun Escort");
        expect(listed[0]?.objType).toBe("gunboats");
    });

    it("gunboat detail includes composition abbrev", () => {
        const gunboat = {
            objType: "gunboats",
            id: "G1",
            owner: "Player 1",
            type: "mixed",
            position: { x: 1, y: 1 },
            facing: 12,
            number: 3,
            endurance: 5,
            skill: "standard",
            boats: [{ type: "beam" }, { type: "beam" }, { type: "plasma" }],
        } as FullThrustGameObjects;
        const listed = listExploreObjects([gunboat], ["Player 1"]);
        expect(listed[0]?.detail).toContain("×3");
        expect(listed[0]?.detail).toMatch(/beam|Bm|Pl/i);
    });
});
