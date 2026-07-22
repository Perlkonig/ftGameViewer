import { describe, expect, it } from "vitest";
import type { FullThrustGamePosition } from "@/schemas/position";
import { applyCommand } from "./applyCommand";
import { DEFAULT_META } from "./types";
import {
    fighterMoveAllowanceMu,
    fighterOrderModeratorHints,
    isDeployedFighter,
    validateFighterDuplicateOrder,
    validateMoveFightersSoft,
    hasMutualFighterScreen,
    screenableFriendlyFighterGroups,
    validateScreenFighters,
    validatePursueFighters,
    formatUndeclaredFightersByPlayer,
} from "./fighterMove";
import type { FullThrustGameCommand } from "@/schemas/commands";

const basePosition = (): FullThrustGamePosition => ({
    map: { mode: "fixed", width: 72, height: 48 },
    players: [
        { id: "P1", colour: "#f00", vp: 0 },
        { id: "P2", colour: "#00f", vp: 0 },
    ],
    objects: [
        {
            objType: "fighters",
            id: "F1",
            owner: "P1",
            type: "fast",
            position: { x: 1, y: 1 },
            facing: 12,
            number: 6,
            endurance: 6,
            skill: "standard",
        },
        {
            objType: "ship",
            id: "S2",
            owner: "P2",
            object: { systems: [] },
            svg: "<symbol></symbol>",
            position: { x: 20, y: 1 },
            facing: 12,
            speed: 0,
        },
    ] as FullThrustGamePosition["objects"],
});

describe("fighterMove", () => {
    it("allowance is 36 for fast mod in phase 4", () => {
        expect(
            fighterMoveAllowanceMu("standard", 4, { type: "standard", mods: ["fast"] })
        ).toBe(36);
        expect(fighterMoveAllowanceMu("standard", 4)).toBe(24);
        expect(fighterMoveAllowanceMu("standard", 6)).toBe(12);
    });

    it("over-range move warns not errors", () => {
        const issues = validateMoveFightersSoft(
            { x: 0, y: 0 },
            { x: 30, y: 0 },
            { phase: 4, fighterType: "heavy" }
        );
        expect(issues.every((i) => i.severity === "warning")).toBe(true);
    });

    it("over-range move still applies", () => {
        let fold = {
            meta: { ...DEFAULT_META(), phase: 4 as const, turn: 1 },
            position: basePosition(),
        };
        fold = applyCommand(fold, {
            name: "moveFighters",
            id: "F1",
            position: { x: 30, y: 1 },
            distanceMu: 29,
            facing: 12,
        } as FullThrustGameCommand).state;
        const f = fold.position.objects!.find((o) => o.id === "F1")!;
        expect((f.position as { x: number }).x).toBe(30);
    });

    it("screen beyond 3 MU warns but applies", () => {
        const fold = {
            meta: { ...DEFAULT_META(), phase: 4 as const, turn: 1 },
            position: basePosition(),
        };
        const issues = validateScreenFighters(fold, {
            name: "screenFighters",
            id: "F1",
            ship: "S2",
        } as FullThrustGameCommand);
        expect(issues.some((i) => i.severity === "warning")).toBe(true);
        const next = applyCommand(fold, {
            name: "screenFighters",
            id: "F1",
            ship: "S2",
        } as FullThrustGameCommand).state;
        const f = next.position.objects!.find((o) => o.id === "F1")!;
        expect((f as { fighterAttachment?: { kind: string } }).fighterAttachment?.kind).toBe(
            "screen"
        );
        expect(f.endurance).toBe(6);
    });

    it("pursuit without lastAttack warns but applies", () => {
        const fold = {
            meta: { ...DEFAULT_META(), phase: 4 as const, turn: 2 },
            position: basePosition(),
        };
        const issues = validatePursueFighters(fold, {
            name: "pursueFighters",
            id: "F1",
            targetType: "ship",
            targetId: "S2",
        } as FullThrustGameCommand);
        expect(issues.some((i) => i.severity === "warning")).toBe(true);
    });

    it("isDeployedFighter excludes hangar position", () => {
        const docked = {
            objType: "fighters" as const,
            id: "F9",
            owner: "P1",
            type: "standard",
            position: { ship: "S1", hangar: "h1" },
            number: 6,
            endurance: 6,
            skill: "standard" as const,
        };
        expect(isDeployedFighter(docked)).toBe(false);
    });

    it("formatUndeclaredFightersByPlayer groups by owner", () => {
        const pos = basePosition();
        const text = formatUndeclaredFightersByPlayer(pos, new Set());
        expect(text).toContain("P1: F1");
    });

    it("validateFighterDuplicateOrder excludes the command under validation", () => {
        const move = {
            name: "moveFighters",
            id: "F1",
            position: { x: 2, y: 1 },
            distanceMu: 1,
        } as FullThrustGameCommand;
        const screen = {
            name: "screenFighters",
            id: "F1",
            ship: "S2",
        } as FullThrustGameCommand;
        expect(
            validateFighterDuplicateOrder([move], "F1", "moveFighters", move)
        ).toEqual([]);
        expect(
            validateFighterDuplicateOrder([move, screen], "F1", "screenFighters", screen)
        ).toEqual([
            expect.objectContaining({
                severity: "warning",
                message: expect.stringContaining("already has a fighter order"),
            }),
        ]);
    });

    it("fighterOrderModeratorHints does not warn for single orders in log", () => {
        const position = basePosition();
        position.objects!.push(
            {
                objType: "fighters",
                id: "F2",
                owner: "P1",
                type: "standard",
                position: { x: 3, y: 1 },
                facing: 12,
                number: 6,
                endurance: 6,
                skill: "standard",
            },
            {
                objType: "ship",
                id: "S1",
                owner: "P1",
                object: { systems: [] },
                svg: "<symbol></symbol>",
                position: { x: 5, y: 1 },
                facing: 12,
                speed: 0,
            }
        );
        const fold = {
            meta: { ...DEFAULT_META(), phase: 4 as const, turn: 1 },
            position,
        };
        const phaseCommands: FullThrustGameCommand[] = [
            {
                name: "moveFighters",
                id: "F1",
                position: { x: 2, y: 1 },
                distanceMu: 1,
                facing: 12,
            } as FullThrustGameCommand,
            {
                name: "screenFighters",
                id: "F2",
                ship: "S1",
            } as FullThrustGameCommand,
        ];
        const hints = fighterOrderModeratorHints(fold, phaseCommands);
        expect(
            hints.some((h) => h.includes("already has a fighter order"))
        ).toBe(false);
    });

    it("phase 6 screen decrements endurance", () => {
        const position = basePosition();
        position.objects!.push({
            objType: "ship",
            id: "S1",
            owner: "P1",
            object: { systems: [] },
            svg: "<symbol></symbol>",
            position: { x: 2, y: 1 },
            facing: 12,
            speed: 0,
        });
        let fold = {
            meta: { ...DEFAULT_META(), phase: 6 as const, turn: 1 },
            position,
        };
        fold = applyCommand(fold, {
            name: "screenFighters",
            id: "F1",
            ship: "S1",
        } as FullThrustGameCommand).state;
        const f = fold.position.objects!.find((o) => o.id === "F1")!;
        expect(f.endurance).toBe(5);
    });

    it("phase 6 pursue decrements endurance", () => {
        let fold = {
            meta: { ...DEFAULT_META(), phase: 6 as const, turn: 2 },
            position: basePosition(),
        };
        fold = applyCommand(fold, {
            name: "pursueFighters",
            id: "F1",
            targetType: "ship",
            targetId: "S2",
        } as FullThrustGameCommand).state;
        const f = fold.position.objects!.find((o) => o.id === "F1")!;
        expect(f.endurance).toBe(5);
    });

    it("screen and pursue are typical in phase 6", () => {
        const fold = {
            meta: { ...DEFAULT_META(), phase: 6 as const, turn: 1 },
            position: basePosition(),
        };
        const screenIssues = validateScreenFighters(fold, {
            name: "screenFighters",
            id: "F1",
            ship: "S2",
        } as FullThrustGameCommand);
        const pursueIssues = validatePursueFighters(fold, {
            name: "pursueFighters",
            id: "F1",
            targetType: "ship",
            targetId: "S2",
        } as FullThrustGameCommand);
        expect(
            screenIssues.some((i) => i.message.includes("screenFighters is not typical"))
        ).toBe(false);
        expect(
            pursueIssues.some((i) => i.message.includes("pursueFighters is not typical"))
        ).toBe(false);
    });

    it("phase 6 move decrements endurance", () => {
        let fold = {
            meta: { ...DEFAULT_META(), phase: 6 as const, turn: 1 },
            position: basePosition(),
        };
        fold = applyCommand(fold, {
            name: "moveFighters",
            id: "F1",
            position: { x: 2, y: 1 },
            distanceMu: 1,
            facing: 12,
        } as FullThrustGameCommand).state;
        const f = fold.position.objects!.find((o) => o.id === "F1")!;
        expect(f.endurance).toBe(5);
    });

    it("phase 4 move does not decrement endurance", () => {
        let fold = {
            meta: { ...DEFAULT_META(), phase: 4 as const, turn: 1 },
            position: basePosition(),
        };
        fold = applyCommand(fold, {
            name: "moveFighters",
            id: "F1",
            position: { x: 2, y: 1 },
            distanceMu: 1,
            facing: 6,
        } as FullThrustGameCommand).state;
        const f = fold.position.objects!.find((o) => o.id === "F1")!;
        expect(f.endurance).toBe(6);
        expect(f.facing).toBe(6);
    });

    it("can screen a friendly fighter group within range", () => {
        const position = basePosition();
        position.objects!.push({
            objType: "fighters",
            id: "F2",
            owner: "P1",
            type: "standard",
            position: { x: 2, y: 1 },
            facing: 12,
            number: 6,
            endurance: 6,
            skill: "standard",
        });
        const fold = {
            meta: { ...DEFAULT_META(), phase: 4 as const, turn: 1 },
            position,
        };
        const next = applyCommand(fold, {
            name: "screenFighters",
            id: "F1",
            targetType: "fighters",
            targetId: "F2",
        } as FullThrustGameCommand).state;
        const f1 = next.position.objects!.find((o) => o.id === "F1")!;
        expect(
            (f1 as { fighterAttachment?: { targetType: string; targetId: string } })
                .fighterAttachment
        ).toEqual(
            expect.objectContaining({ targetType: "fighters", targetId: "F2" })
        );
    });

    it("rejects mutual fighter screening", () => {
        const position = basePosition();
        const f2 = {
            objType: "fighters" as const,
            id: "F2",
            owner: "P1",
            type: "standard",
            position: { x: 2, y: 1 },
            facing: 12,
            number: 6,
            endurance: 6,
            skill: "standard" as const,
            fighterAttachment: {
                kind: "screen" as const,
                targetType: "fighters" as const,
                targetId: "F1",
                offset: { dx: 1, dy: 0 },
            },
        };
        position.objects!.push(f2);
        const fold = {
            meta: { ...DEFAULT_META(), phase: 4 as const, turn: 1 },
            position,
        };
        const issues = validateScreenFighters(fold, {
            name: "screenFighters",
            id: "F1",
            targetType: "fighters",
            targetId: "F2",
        } as FullThrustGameCommand);
        expect(issues.some((i) => i.message.includes("cannot screen each other"))).toBe(true);
        expect(hasMutualFighterScreen(position, "F1", "F2")).toBe(true);
    });

    it("screenableFriendlyFighterGroups omits self and groups screening the screener", () => {
        const position = basePosition();
        const f1 = position.objects!.find((o) => o.id === "F1")!;
        position.objects!.push(
            {
                objType: "fighters",
                id: "F2",
                owner: "P1",
                type: "standard",
                position: { x: 2, y: 1 },
                facing: 12,
                number: 6,
                endurance: 6,
                skill: "standard",
            },
            {
                objType: "fighters",
                id: "F3",
                owner: "P1",
                type: "standard",
                position: { x: 1.5, y: 1 },
                facing: 12,
                number: 6,
                endurance: 6,
                skill: "standard",
                fighterAttachment: {
                    kind: "screen",
                    targetType: "fighters",
                    targetId: "F1",
                    offset: { dx: 0.5, dy: 0 },
                },
            },
            {
                objType: "fighters",
                id: "F4",
                owner: "P1",
                type: "standard",
                position: { x: 10, y: 1 },
                facing: 12,
                number: 6,
                endurance: 6,
                skill: "standard",
            }
        );
        const eligible = screenableFriendlyFighterGroups(position, f1 as never, "P1").map(
            (f) => f.id
        );
        expect(eligible).toEqual(["F2"]);
    });
});
