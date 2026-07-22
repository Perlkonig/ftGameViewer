import { describe, expect, it } from "vitest";
import {
    screeningGroupsFor,
    screeningEngagementPlan,
    furballSkirmishes,
    validateEngagementSingleSkirmish,
    isSkirmishCovered,
    sortSkirmishCards,
    screeningBypassTargets,
    deriveStrikeThroughSkirmishes,
    allSkirmishCards,
    buildEngagementFromPairings,
    buildDogfightEngagement,
    skirmishCoverage,
    validateFurballAgainstScreening,
    engagementTouchesSituation,
} from "./fighterScreening";
import type { FighterAttackAlloc } from "./fighterEngagement";
import type { FurballEngagement } from "./fighterDogfight";
import type { FullThrustGamePosition } from "@/schemas/position";

const position = {
    map: { mode: "fixed" as const, width: 72, height: 48 },
    players: [],
    objects: [
        {
            objType: "fighters" as const,
            id: "SCR1",
            owner: "P1",
            type: "standard",
            number: 6,
            endurance: 6,
            skill: "standard" as const,
            position: { x: 0, y: 0 },
            fighterAttachment: {
                kind: "screen" as const,
                targetType: "ship" as const,
                targetId: "S1",
            },
        },
        {
            objType: "fighters" as const,
            id: "SCR2",
            owner: "P1",
            type: "standard",
            number: 6,
            endurance: 6,
            skill: "standard" as const,
            position: { x: 1, y: 0 },
            fighterAttachment: {
                kind: "screen" as const,
                targetType: "fighters" as const,
                targetId: "SCR1",
            },
        },
        {
            objType: "ship" as const,
            id: "S1",
            owner: "P1",
            position: { x: 0, y: 2 },
            facing: 12 as const,
            speed: 0,
            object: {},
            svg: "",
        },
    ],
};

describe("fighterScreening", () => {
    it("finds chained screeners for escorted ship", () => {
        const screeners = screeningGroupsFor(position, "ship", "S1");
        expect(screeners.map((s) => s.id).sort()).toEqual(["SCR1", "SCR2"]);
    });

    it("builds engagement plan when screeners and attackers exist", () => {
        const allocations: FighterAttackAlloc[] = [
            { groupId: "ATK1", targetType: "ship", targetId: "S1", turn: 1 },
        ];
        const plan = screeningEngagementPlan(position, allocations);
        expect(plan).toHaveLength(1);
        expect(plan[0].screeners.map((s) => s.id)).toContain("SCR1");
        expect(plan[0].attackers[0].groupId).toBe("ATK1");
    });
});

describe("furballSkirmishes", () => {
    const dogfightPosition = {
        map: { mode: "fixed" as const, width: 72, height: 48 },
        players: [],
        objects: [
            {
                objType: "fighters" as const,
                id: "A1",
                owner: "P1",
                type: "standard",
                number: 6,
                endurance: 6,
                skill: "standard" as const,
                position: { x: 0, y: 0 },
            },
            {
                objType: "fighters" as const,
                id: "B1",
                owner: "P2",
                type: "standard",
                number: 6,
                endurance: 6,
                skill: "standard" as const,
                position: { x: 50, y: 50 },
            },
            {
                objType: "fighters" as const,
                id: "A2",
                owner: "P1",
                type: "standard",
                number: 6,
                endurance: 6,
                skill: "standard" as const,
                position: { x: 1, y: 0 },
            },
            {
                objType: "fighters" as const,
                id: "B2",
                owner: "P2",
                type: "standard",
                number: 6,
                endurance: 6,
                skill: "standard" as const,
                position: { x: 51, y: 50 },
            },
        ],
    };

    it("produces separate dogfight skirmishes with distinct hints", () => {
        const allocations: FighterAttackAlloc[] = [
            { groupId: "A1", targetType: "fighters", targetId: "B1", turn: 1 },
            { groupId: "A2", targetType: "fighters", targetId: "B2", turn: 1 },
        ];
        const skirmishes = furballSkirmishes(dogfightPosition, allocations);
        expect(skirmishes).toHaveLength(2);
        expect(skirmishes.map((s) => s.id).sort()).toEqual([
            "dogfight:A1:B1",
            "dogfight:A2:B2",
        ]);
        expect(skirmishes[0].hint).toContain("declared attack on");
        expect(skirmishes[1].hint).not.toBe(skirmishes[0].hint);
    });

    it("includes screening attackers and screeners in one skirmish", () => {
        const allocations: FighterAttackAlloc[] = [
            { groupId: "ATK1", targetType: "ship", targetId: "S1", turn: 1 },
        ];
        const skirmishes = furballSkirmishes(position, allocations);
        expect(skirmishes).toHaveLength(1);
        expect(skirmishes[0].id).toBe("screen:ship:S1");
        expect(skirmishes[0].attackerIds).toEqual(["ATK1"]);
        expect(skirmishes[0].defenderIds.sort()).toEqual(["SCR1", "SCR2"]);
        expect(skirmishes[0].hint).toContain("Screeners protecting");
    });

    it("rejects engagements that mix groups from different skirmishes", () => {
        const allocations: FighterAttackAlloc[] = [
            { groupId: "A1", targetType: "fighters", targetId: "B1", turn: 1 },
            { groupId: "A2", targetType: "fighters", targetId: "B2", turn: 1 },
        ];
        const skirmishes = furballSkirmishes(dogfightPosition, allocations);
        const mixed: FurballEngagement = {
            attackers: [{ id: "A1", targetIds: ["B1"] }],
            defenders: [{ id: "B2", targetIds: ["A2"] }],
        };
        const issues = validateEngagementSingleSkirmish(mixed, skirmishes);
        expect(issues.some((i) => i.severity === "error")).toBe(true);
    });

    it("marks skirmish covered when all groups are declared", () => {
        const allocations: FighterAttackAlloc[] = [
            { groupId: "A1", targetType: "fighters", targetId: "B1", turn: 1 },
        ];
        const skirmishes = furballSkirmishes(dogfightPosition, allocations);
        const decl: FurballEngagement = {
            attackers: [{ id: "A1", targetIds: ["B1"] }],
            defenders: [{ id: "B1", targetIds: ["A1"] }],
        };
        expect(isSkirmishCovered(skirmishes[0], [decl])).toBe(true);
    });

    it("sortSkirmishCards orders uncovered before declared", () => {
        const allocations: FighterAttackAlloc[] = [
            { groupId: "A1", targetType: "fighters", targetId: "B1", turn: 1 },
            { groupId: "A2", targetType: "fighters", targetId: "B2", turn: 1 },
        ];
        const skirmishes = furballSkirmishes(dogfightPosition, allocations);
        const decl: FurballEngagement = {
            attackers: [{ id: "A1", targetIds: ["B1"] }],
            defenders: [{ id: "B1", targetIds: ["A1"] }],
        };
        const sorted = sortSkirmishCards(skirmishes, [decl]);
        expect(sorted[0].id).toBe("dogfight:A2:B2");
        expect(sorted[1].id).toBe("dogfight:A1:B1");
    });
});

describe("screening bypass and pairing", () => {
    const chainedPosition = {
        map: { mode: "fixed" as const, width: 72, height: 48 },
        players: [],
        objects: [
            {
                objType: "fighters" as const,
                id: "A",
                owner: "P1",
                type: "standard",
                number: 6,
                endurance: 6,
                skill: "standard" as const,
                position: { x: 0, y: 0 },
                fighterAttachment: {
                    kind: "screen" as const,
                    targetType: "fighters" as const,
                    targetId: "B",
                },
            },
            {
                objType: "fighters" as const,
                id: "B",
                owner: "P1",
                type: "standard",
                number: 6,
                endurance: 6,
                skill: "standard" as const,
                position: { x: 1, y: 0 },
                fighterAttachment: {
                    kind: "screen" as const,
                    targetType: "ship" as const,
                    targetId: "C",
                },
            },
            {
                objType: "ship" as const,
                id: "C",
                owner: "P1",
                position: { x: 0, y: 2 },
                facing: 12 as const,
                speed: 0,
                object: {},
                svg: "",
            },
        ],
    } as FullThrustGamePosition;

    const fourAtkAlloc: FighterAttackAlloc[] = [
        { groupId: "ATK1", targetType: "ship", targetId: "C", turn: 1 },
        { groupId: "ATK2", targetType: "ship", targetId: "C", turn: 1 },
        { groupId: "ATK3", targetType: "ship", targetId: "C", turn: 1 },
        { groupId: "ATK4", targetType: "ship", targetId: "C", turn: 1 },
    ];

    it("lists bypass targets along escort chain innermost first", () => {
        const targets = screeningBypassTargets(chainedPosition, {
            targetType: "ship",
            targetId: "C",
        });
        expect(targets.map((t) => `${t.targetType}:${t.targetId}`)).toEqual([
            "ship:C",
            "fighters:B",
        ]);
    });

    it("derives fighter bypass dogfight skirmish from assignments", () => {
        const primary = furballSkirmishes(chainedPosition, fourAtkAlloc);
        const derived = deriveStrikeThroughSkirmishes(chainedPosition, primary, {
            "screen:ship:C": { B: ["ATK4"] },
        });
        expect(derived).toHaveLength(1);
        expect(derived[0].id).toBe("derived:screen:ship:C:fighters:B");
        expect(derived[0].attackerIds).toEqual(["ATK4"]);
        expect(derived[0].defenderIds).toEqual(["B"]);
    });

    it("buildEngagementFromPairings merges multi-defender pairings and ship bypass", () => {
        const eng = buildEngagementFromPairings(
            [
                { attackerId: "ATK1", defenderIds: ["SCR1", "SCR2"] },
                { attackerId: "ATK2", defenderIds: ["SCR3"] },
            ],
            ["ATK3"],
            { targetType: "ship", targetId: "S1" }
        );
        expect(eng.attackers.find((a) => a.id === "ATK1")?.targetIds.sort()).toEqual([
            "SCR1",
            "SCR2",
        ]);
        expect(eng.defenders.find((d) => d.id === "SCR1")?.targetIds).toEqual(["ATK1"]);
        expect(eng.attackers.find((a) => a.id === "ATK3")?.targetIds).toEqual(["S1"]);
    });

    it("buildDogfightEngagement sets return fire", () => {
        const eng = buildDogfightEngagement([{ attackerId: "A1", defenderIds: ["B1"] }]);
        expect(eng.defenders[0].targetIds).toEqual(["A1"]);
    });

    it("covers screening with furball plus ship bypass", () => {
        const allocations: FighterAttackAlloc[] = [
            { groupId: "ATK1", targetType: "ship", targetId: "S1", turn: 1 },
            { groupId: "ATK2", targetType: "ship", targetId: "S1", turn: 1 },
            { groupId: "ATK3", targetType: "ship", targetId: "S1", turn: 1 },
        ];
        const pos = {
            ...position,
            objects: [
                ...(position.objects ?? []),
                {
                    objType: "fighters" as const,
                    id: "ATK1",
                    owner: "P2",
                    type: "standard",
                    number: 6,
                    endurance: 6,
                    skill: "standard" as const,
                    position: { x: 5, y: 5 },
                },
                {
                    objType: "fighters" as const,
                    id: "ATK2",
                    owner: "P2",
                    type: "standard",
                    number: 6,
                    endurance: 6,
                    skill: "standard" as const,
                    position: { x: 6, y: 5 },
                },
                {
                    objType: "fighters" as const,
                    id: "ATK3",
                    owner: "P2",
                    type: "standard",
                    number: 6,
                    endurance: 6,
                    skill: "standard" as const,
                    position: { x: 7, y: 5 },
                },
            ],
        } as FullThrustGamePosition;
        const skirmishes = furballSkirmishes(pos, allocations);
        const screen = skirmishes[0];
        const furball: FurballEngagement = {
            attackers: [
                { id: "ATK1", targetIds: ["SCR2"] },
                { id: "ATK2", targetIds: ["SCR1"] },
            ],
            defenders: [
                { id: "SCR1", targetIds: ["ATK2"] },
                { id: "SCR2", targetIds: ["ATK1"] },
            ],
        };
        const bypass: FurballEngagement = {
            attackers: [{ id: "ATK3", targetIds: ["S1"] }],
            defenders: [],
        };
        const ctx = { position: pos, allocations };
        expect(
            isSkirmishCovered(screen, [furball, bypass], { ...ctx, allSkirmishes: allSkirmishCards(pos, allocations, {}, [furball, bypass]) })
        ).toBe(true);
    });

    it("covers chained screening with furball, ship bypass, and derived dogfight", () => {
        const allocations = fourAtkAlloc;
        const pos = {
            ...chainedPosition,
            objects: [
                ...(chainedPosition.objects ?? []),
                ...["ATK1", "ATK2", "ATK3", "ATK4"].map((id) => ({
                    objType: "fighters" as const,
                    id,
                    owner: "P2",
                    type: "standard" as const,
                    number: 6,
                    endurance: 6,
                    skill: "standard" as const,
                    position: { x: 10, y: 10 },
                })),
            ],
        } as FullThrustGamePosition;
        const furball: FurballEngagement = {
            attackers: [
                { id: "ATK1", targetIds: ["A"] },
                { id: "ATK2", targetIds: ["B"] },
            ],
            defenders: [
                { id: "A", targetIds: ["ATK1"] },
                { id: "B", targetIds: ["ATK2"] },
            ],
        };
        const shipBypass: FurballEngagement = {
            attackers: [{ id: "ATK3", targetIds: ["C"] }],
            defenders: [],
        };
        const derived: FurballEngagement = {
            attackers: [{ id: "ATK4", targetIds: ["B"] }],
            defenders: [{ id: "B", targetIds: ["ATK4"] }],
        };
        const decls = [furball, shipBypass, derived];
        const all = allSkirmishCards(pos, allocations, {}, decls);
        const cov = skirmishCoverage(all, decls, { position: pos, allocations });
        expect(cov.get("screen:ship:C")).toBe(true);
        expect(cov.get("derived:screen:ship:C:fighters:B")).toBe(true);
    });

    it("validateFurballAgainstScreening only checks the skirmish being declared", () => {
        const pos = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            players: [],
            objects: [
                {
                    objType: "fighters" as const,
                    id: "SCR_A",
                    owner: "P1",
                    type: "standard",
                    number: 6,
                    endurance: 6,
                    skill: "standard",
                    position: { x: 0, y: 0 },
                    fighterAttachment: {
                        kind: "screen" as const,
                        targetType: "ship" as const,
                        targetId: "A1",
                    },
                },
                {
                    objType: "fighters" as const,
                    id: "SCR_B",
                    owner: "P1",
                    type: "standard",
                    number: 6,
                    endurance: 6,
                    skill: "standard",
                    position: { x: 1, y: 0 },
                    fighterAttachment: {
                        kind: "screen" as const,
                        targetType: "ship" as const,
                        targetId: "B1",
                    },
                },
                {
                    objType: "ship" as const,
                    id: "A1",
                    owner: "P1",
                    position: { x: 0, y: 2 },
                    facing: 12 as const,
                    speed: 0,
                    object: {},
                    svg: "",
                },
                {
                    objType: "ship" as const,
                    id: "B1",
                    owner: "P1",
                    position: { x: 2, y: 2 },
                    facing: 12 as const,
                    speed: 0,
                    object: {},
                    svg: "",
                },
            ],
        } as FullThrustGamePosition;
        const allocations: FighterAttackAlloc[] = [
            { groupId: "ATK_A1", targetType: "ship", targetId: "A1", turn: 1 },
            { groupId: "ATK_A2", targetType: "ship", targetId: "A1", turn: 1 },
            { groupId: "ATK_B1", targetType: "ship", targetId: "B1", turn: 1 },
        ];
        const plan = screeningEngagementPlan(pos, allocations);
        expect(plan).toHaveLength(2);

        const a1Eng: FurballEngagement = {
            attackers: [
                { id: "ATK_A1", targetIds: ["SCR_A"] },
                { id: "ATK_A2", targetIds: ["A1"] },
            ],
            defenders: [{ id: "SCR_A", targetIds: ["ATK_A1"] }],
        };
        const issues = validateFurballAgainstScreening(plan, a1Eng);
        expect(issues).toHaveLength(0);
        expect(engagementTouchesSituation(plan[1], a1Eng)).toBe(false);
    });
});
