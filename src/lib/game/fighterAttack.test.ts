import { describe, expect, it } from "vitest";
import {
    bearingInFrontArc,
    validateDeclareFighterAttack,
    FIGHTER_ATTACK_RANGE_MU,
} from "./fighterAttack";
import type { FoldState } from "./applyCommand";
import { DEFAULT_META } from "./types";

function fold(objects: NonNullable<import("@/schemas/position").FullThrustGamePosition["objects"]>): FoldState {
    return {
        meta: { ...DEFAULT_META(), phase: 7, segment: "resolve", turn: 1 },
        position: {
            map: { mode: "fixed", width: 72, height: 48 },
            players: [
                { id: "P1", colour: "#f00" },
                { id: "P2", colour: "#00f" },
            ],
            objects,
        },
    };
}

describe("fighterAttack", () => {
    it("bearingInFrontArc accepts targets within front 180°", () => {
        expect(bearingInFrontArc({ x: 0, y: 0 }, 12, { x: 0, y: -5 })).toBe(true);
        expect(bearingInFrontArc({ x: 0, y: 0 }, 12, { x: 0, y: 5 })).toBe(false);
    });

    it("warns when target out of range or arc", () => {
        const f = fold([
            {
                objType: "fighters",
                id: "FG1",
                owner: "P1",
                type: "standard",
                number: 6,
                endurance: 6,
                skill: "standard",
                position: { x: 0, y: 0 },
                facing: 12,
            },
            {
                objType: "ship",
                id: "S1",
                owner: "P2",
                position: { x: 20, y: 0 },
                facing: 12,
                speed: 0,
                object: {},
                svg: "",
            },
        ]);
        const issues = validateDeclareFighterAttack(f, {
            name: "declareFighterAttack",
            id: "FG1",
            targetType: "ship",
            targetId: "S1",
        });
        expect(issues.some((i) => i.message.includes(String(FIGHTER_ATTACK_RANGE_MU)))).toBe(true);
    });

    it("warns on duplicate allocation", () => {
        const f = fold([
            {
                objType: "fighters",
                id: "FG1",
                owner: "P1",
                type: "standard",
                number: 6,
                endurance: 6,
                skill: "standard",
                position: { x: 0, y: 0 },
                facing: 12,
                attackAllocation: { turn: 1, targetType: "ship", targetId: "S1" },
            },
            {
                objType: "ship",
                id: "S1",
                owner: "P2",
                position: { x: 3, y: 0 },
                facing: 12,
                speed: 0,
                object: {},
                svg: "",
            },
        ]);
        const issues = validateDeclareFighterAttack(f, {
            name: "declareFighterAttack",
            id: "FG1",
            targetType: "ship",
            targetId: "S1",
        });
        expect(issues.some((i) => i.message.includes("already has"))).toBe(true);
    });

    it("warns but allows ordnance attack out of range", () => {
        const f = fold([
            {
                objType: "fighters",
                id: "FG1",
                owner: "P1",
                type: "standard",
                number: 6,
                endurance: 6,
                skill: "standard",
                position: { x: 0, y: 0 },
                facing: 12,
            },
            {
                objType: "ordnance",
                id: "M1",
                owner: "P2",
                type: "salvo",
                position: { x: 20, y: 0 },
            },
        ]);
        const issues = validateDeclareFighterAttack(f, {
            name: "declareFighterAttack",
            id: "FG1",
            targetType: "ordnance",
            targetId: "M1",
        });
        expect(issues.some((i) => i.severity === "warning" && i.message.includes("MU"))).toBe(
            true
        );
        expect(issues.some((i) => i.severity === "error")).toBe(false);
    });
});
