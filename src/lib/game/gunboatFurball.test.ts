import { describe, expect, it } from "vitest";
import { gunboatDogfightSkirmishes } from "./gunboatFurball";
import { applyFurballToPosition, resolveFurballFromRolls } from "./fighterDogfight";

describe("gunboatFurball", () => {
    it("creates dogfight skirmish from gunboat vs fighter allocation", () => {
        const position = {
            players: [{ id: "p1" }, { id: "p2" }],
            objects: [
                {
                    objType: "gunboats",
                    id: "gb1",
                    owner: "p1",
                    position: { x: 0, y: 0 },
                    number: 4,
                    endurance: 6,
                    type: "missile",
                },
                {
                    objType: "fighters",
                    id: "f1",
                    owner: "p2",
                    type: "standard",
                    position: { x: 2, y: 0 },
                    number: 6,
                    endurance: 6,
                },
            ],
        };
        const sk = gunboatDogfightSkirmishes(position, [
            {
                groupId: "gb1",
                targetType: "fighters",
                targetId: "f1",
                turn: 1,
            },
        ]);
        expect(sk).toHaveLength(1);
        expect(sk[0].kind).toBe("dogfight");
    });

    it("resolves furball with gunboat participants", () => {
        const position = {
            players: [{ id: "p1" }, { id: "p2" }],
            objects: [
                {
                    objType: "gunboats",
                    id: "gb1",
                    owner: "p1",
                    position: { x: 0, y: 0 },
                    number: 2,
                    endurance: 6,
                    boats: [{ type: "missile" }, { type: "missile" }],
                },
                {
                    objType: "gunboats",
                    id: "gb2",
                    owner: "p2",
                    position: { x: 1, y: 0 },
                    number: 2,
                    endurance: 6,
                    boats: [{ type: "rocket" }, { type: "rocket" }],
                },
            ],
        };
        const engagement = {
            attackers: [{ id: "gb1", targetIds: ["gb2"] }],
            defenders: [{ id: "gb2", targetIds: ["gb1"] }],
        };
        const rolls = [4, 4, 3, 3];
        const resolution = resolveFurballFromRolls(position, engagement, rolls);
        applyFurballToPosition(position, engagement, resolution);
        const gb1 = position.objects!.find((o) => o.id === "gb1") as { endurance?: number };
        expect(gb1.endurance).toBe(5);
    });
});
