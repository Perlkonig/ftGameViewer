import { describe, expect, it } from "vitest";
import { validateScreenGunboats } from "./gunboatMove";
import {
    gunboatPointDefenseSupportIssues,
    operationalGunboatPdMounts,
} from "./gunboatPointDefense";
import type { FullThrustGamePosition } from "@/schemas/position";
import { DEFAULT_META } from "./types";
import type { FoldState } from "./applyCommand";

describe("gunboatPointDefense", () => {
    it("operationalGunboatPdMounts yields two PDS per point-defense boat", () => {
        const gunboat = {
            objType: "gunboats" as const,
            id: "GB1",
            owner: "P1",
            squadronKey: "r1",
            type: "pointDefense",
            number: 2,
            endurance: 6,
            skill: "standard" as const,
            position: { x: 0, y: 0 },
            boats: [
                { type: "pointDefense", id: "b0" },
                { type: "pointDefense", id: "b1" },
            ],
        };
        const mounts = operationalGunboatPdMounts(gunboat);
        expect(mounts).toHaveLength(4);
        expect(mounts.every((m) => m.name === "pds")).toBe(true);
    });
});

describe("gunboat screen/pursue blocked", () => {
    it("validateScreenGunboats returns error", () => {
        const fold = {
            meta: DEFAULT_META(),
            position: { map: { mode: "fixed" as const, width: 72, height: 48 }, objects: [] },
        } as FoldState;
        const issues = validateScreenGunboats(fold, { name: "screenGunboats", id: "G1" });
        expect(issues.some((i) => i.severity === "error")).toBe(true);
    });
});

describe("gunboatPointDefense support", () => {
    it("warns when supported ship out of range", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            objects: [
                {
                    objType: "gunboats" as const,
                    id: "GB1",
                    owner: "P1",
                    squadronKey: "r1",
                    type: "ads",
                    number: 1,
                    endurance: 6,
                    skill: "standard" as const,
                    position: { x: 0, y: 0 },
                    boats: [{ type: "ads", id: "b0" }],
                },
                {
                    objType: "ship" as const,
                    id: "A1",
                    owner: "P1",
                    position: { x: 20, y: 0 },
                    object: {},
                },
            ],
        } as FullThrustGamePosition;
        const issues = gunboatPointDefenseSupportIssues(position, "GB1", "A1");
        expect(issues.some((i) => i.message.includes("within 6 MU"))).toBe(true);
    });
});
