import { describe, expect, it } from "vitest";
import {
    splitKillsEvenly,
    resolveFurballFromRolls,
    previewFurballUpdates,
} from "./fighterDogfight";
import { arrayRollSource } from "./dice";
import { resolveDogfightSideRolls } from "./fighterEndurance";

describe("fighterDogfight", () => {
    it("splits kills evenly across targets", () => {
        const m = splitKillsEvenly(5, ["A", "B", "C"]);
        expect(m.get("A")).toBe(2);
        expect(m.get("B")).toBe(2);
        expect(m.get("C")).toBe(1);
    });

    it("exhausted groups only kill on 6", () => {
        const source = arrayRollSource([6, 4, 5, 1]);
        const { killsDealt } = resolveDogfightSideRolls(4, true, source);
        expect(killsDealt).toBe(1);
    });

    it("decrements CEF for furball participants", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            players: [],
            objects: [
                {
                    objType: "fighters" as const,
                    id: "A",
                    owner: "P1",
                    type: "standard",
                    number: 2,
                    endurance: 3,
                    skill: "standard" as const,
                    position: { x: 0, y: 0 },
                },
                {
                    objType: "fighters" as const,
                    id: "B",
                    owner: "P2",
                    type: "standard",
                    number: 2,
                    endurance: 6,
                    skill: "standard" as const,
                    position: { x: 1, y: 0 },
                },
            ],
        };
        const engagement = {
            attackers: [{ id: "A", targetIds: ["B"] }],
            defenders: [{ id: "B", targetIds: ["A"] }],
        };
        const rolls = [4, 4, 3, 3];
        const resolution = resolveFurballFromRolls(position, engagement, rolls);
        const updates = previewFurballUpdates(position, engagement, resolution);
        const a = updates.find((u) => u.id === "A");
        const b = updates.find((u) => u.id === "B");
        expect(a?.endurance).toBe(2);
        expect(b?.endurance).toBe(5);
    });
});
