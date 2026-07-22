import { describe, it, expect } from "vitest";
import {
    applyExclusiveFireControlTarget,
    enemyTargetsForFireControl,
} from "./segmentApply";

describe("fire control target exclusivity", () => {
    it("applyExclusiveFireControlTarget clears other FCs on same target", () => {
        const next = applyExclusiveFireControlTarget(
            { fc1: "EnemyA", fc2: "EnemyB" },
            "fc2",
            "EnemyA"
        );
        expect(next).toEqual({ fc1: "", fc2: "EnemyA" });
    });

    it("enemyTargetsForFireControl hides targets taken by other FCs", () => {
        const available = enemyTargetsForFireControl(
            "fc2",
            { fc1: "EnemyA", fc2: "" },
            ["EnemyA", "EnemyB", "EnemyC"]
        );
        expect(available).toEqual(["EnemyB", "EnemyC"]);
    });

    it("enemyTargetsForFireControl keeps own FC target in list", () => {
        const available = enemyTargetsForFireControl(
            "fc1",
            { fc1: "EnemyA", fc2: "EnemyB" },
            ["EnemyA", "EnemyB", "EnemyC"]
        );
        expect(available).toEqual(["EnemyA", "EnemyC"]);
    });
});
