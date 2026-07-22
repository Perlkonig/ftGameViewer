import { describe, it, expect, vi } from "vitest";
import {
    validateLaunchFighters,
    validateLaunchOrdnance,
    validateLayMine,
    validateCinematicAllocation,
    validateVectorManeuverQueue,
    validateDeclareShipFire,
    validateDeclareShipFireBatch,
    validateDeclareShipFireCommand,
    validateFireControlAssignments,
    validateCommand,
    validatePlaceShip,
    validateDeclareTransporterDelivery,
    validateTransporterDeliveryBatch,
    fireOrderIneffectiveAtRangeIssue,
    fireDeclarationModeratorHints,
} from "./commandValidation";
import type { FoldState } from "./applyCommand";
import { applyCommand } from "./applyCommand";
import { filterNewFireDeclarations } from "./segmentApply";
import { DEFAULT_META } from "./types";
import type { ShipGameState } from "./shipSystems";
import * as shipValidation from "@/lib/shipValidation";

const carrier = (extra: Partial<ShipGameState> = {}): ShipGameState => ({
    id: "c1",
    object: {
        thrust: 4,
        systems: [{ id: "h1", name: "hangar", fighters: 6 }],
        ordnance: [{ id: "m1", name: "missile", shots: 2 }],
    },
    systems: [],
    ammo: [],
    speed: 4,
    facing: 12,
    ...extra,
});

describe("commandValidation", () => {
    it("rejects fighter launch without hangar", () => {
        const ship: ShipGameState = {
            id: "s1",
            object: { thrust: 4, systems: [] },
            systems: [],
        };
        expect(validateLaunchFighters(ship)[0].message).toMatch(/hangar/);
    });

    it("warns fighter launch without phase 1 declaration", () => {
        const ship: ShipGameState = {
            id: "c1",
            objType: "ship",
            object: { systems: [{ id: "h1", name: "hangar" }] },
            systems: [],
            position: { x: 0, y: 0 },
        } as ShipGameState;
        const fold: FoldState = {
            meta: DEFAULT_META(),
            position: { objects: [ship as never] },
            pendingMoves: [],
        };
        const issues = validateCommand(fold, {
            name: "launchFighters",
            ship: "c1",
            id: "c1_h1",
            hangarId: "h1",
            position: { x: 1, y: 0 },
        } as never);
        expect(issues.some((i) => i.message.includes("did not declare launching fighters"))).toBe(
            true
        );
    });

    it("rejects ordnance from unknown system", () => {
        const issues = validateLaunchOrdnance(carrier(), "nope", "missile");
        expect(issues[0].severity).toBe("error");
        expect(issues[0].message).toMatch(/not on this ship/);
    });

    it("rejects ordnance when ammo exhausted", () => {
        const ship = carrier({ ammo: ["m1", "m1"] });
        const issues = validateLaunchOrdnance(ship, "m1", "missile");
        expect(issues.some((i) => i.message.includes("No ammunition"))).toBe(true);
    });

    it("rejects lay mine without minelayer declaration", () => {
        const ship: ShipGameState = {
            id: "s1",
            objType: "ship",
            object: { systems: [{ id: "ml1", name: "mineLayer", capacity: 2 }] },
            systems: [],
            position: { x: 0, y: 0 },
        } as ShipGameState;
        const fold: FoldState = {
            meta: DEFAULT_META(),
            position: { objects: [ship as never] },
            pendingMoves: [
                {
                    name: "moveShip",
                    id: "s1",
                    cinematicAllocation: { speedChange: "hold", speedChangeThrust: 0, turns: 0 },
                } as never,
            ],
        };
        const issues = validateLayMine(fold, {
            ship: "s1",
            systemId: "ml1",
            position: { x: 0, y: 0 },
        });
        expect(issues[0].message).toMatch(/did not declare/);
    });

    it("validatePlaceShip warns on construction issues", () => {
        vi.spyOn(shipValidation, "validateShipObject").mockReturnValue({
            wellFormed: true,
            strictlyValid: false,
            blockingMessages: [],
            warnings: ["Design exceeds mass allowance (systems, armour, or fighters)."],
            raw: { valid: false },
        });
        const issues = validatePlaceShip({
            name: "placeShip",
            id: "s1",
            object: { mass: 50 },
            svg: "<symbol viewBox='0 0 1 1'></symbol>",
            owner: "A",
            position: { x: 0, y: 0 },
            facing: 12,
            speed: 0,
        } as never);
        expect(issues).toEqual([
            {
                message:
                    "placeShip: Design exceeds mass allowance (systems, armour, or fighters).",
                severity: "warning",
            },
        ]);
        vi.restoreAllMocks();
    });

    it("validatePlaceShip errors on malformed JSON", () => {
        vi.spyOn(shipValidation, "validateShipObject").mockReturnValue({
            wellFormed: false,
            strictlyValid: false,
            blockingMessages: ["Ship JSON is not valid JSON."],
            warnings: [],
            raw: { valid: false },
        });
        const issues = validatePlaceShip({
            name: "placeShip",
            id: "s1",
            object: {},
            svg: "<symbol viewBox='0 0 1 1'></symbol>",
            owner: "A",
            position: { x: 0, y: 0 },
            facing: 12,
            speed: 0,
        } as never);
        expect(issues[0].severity).toBe("error");
        expect(issues[0].message).toMatch(/not valid JSON/i);
        vi.restoreAllMocks();
    });

    it("rejects cinematic speed above thrust", () => {
        const ship = carrier({ speed: 2 });
        const issues = validateCinematicAllocation(
            ship,
            { speedChange: "accel", speedChangeThrust: 8, turns: 0 },
            false
        );
        expect(issues.some((i) => i.message.includes("thrust"))).toBe(true);
    });

    it("rejects vector maneuver overspend", () => {
        const ship = carrier({ movementMode: "vector", course: 90 });
        const issues = validateVectorManeuverQueue(ship, [
            { type: "push", direction: "port", distance: 5 },
        ]);
        expect(issues.some((i) => i.message.includes("Maneuver points"))).toBe(true);
    });

    it("warns when declaring duplicate weapon for a ship", () => {
        const fold: FoldState = {
            meta: {
                ...DEFAULT_META(),
                phase: 11,
                segment: "orders",
                activation: { queue: ["S1"], index: 0 },
            },
            position: {
                map: { mode: "fixed", width: 48, height: 36 },
                objects: [
                    {
                        objType: "ship",
                        id: "S1",
                        owner: "P1",
                        object: {
                            systems: [{ name: "fireControl", id: "fc1" }],
                            weapons: [{ name: "beam", id: "b1", class: 2 }],
                        },
                        svg: "<symbol></symbol>",
                        position: { x: 0, y: 0 },
                        facing: 12,
                        speed: 0,
                    },
                ],
            } as never,
            pendingFireDeclarations: [
                {
                    name: "declareShipFire",
                    ship: "S1",
                    weapon: "b1",
                    target: "S2",
                } as never,
            ],
        };
        const issues = validateDeclareShipFire(fold, "S1", "b1");
        expect(issues.some((i) => i.message.includes("duplicate weapon"))).toBe(true);
    });

    it("validateDeclareShipFireBatch ignores already-pending weapons when only new decls are passed", () => {
        const fold: FoldState = {
            meta: {
                ...DEFAULT_META(),
                phase: 11,
                segment: "orders",
                activation: { queue: ["S1"], index: 0 },
            },
            position: {
                map: { mode: "fixed", width: 48, height: 36 },
                objects: [
                    {
                        objType: "ship",
                        id: "S1",
                        owner: "P1",
                        object: {
                            systems: [{ name: "fireControl", id: "fc1" }],
                            weapons: [
                                { name: "beam", id: "b1", class: 1 },
                                { name: "beam", id: "b2", class: 2 },
                            ],
                        },
                        svg: "<symbol></symbol>",
                        position: { x: 0, y: 0 },
                        facing: 12,
                        speed: 0,
                    },
                ],
            } as never,
            pendingFireDeclarations: [
                {
                    name: "declareShipFire",
                    ship: "S1",
                    weapon: "b1",
                    target: "S2",
                    notes: JSON.stringify({ profile: "beam", fireControlId: "fc1" }),
                } as never,
            ],
        };
        const allDecls = [
            {
                name: "declareShipFire",
                ship: "S1",
                weapon: "b1",
                target: "S2",
                notes: JSON.stringify({ profile: "beam", fireControlId: "fc1" }),
            },
            {
                name: "declareShipFire",
                ship: "S1",
                weapon: "b2",
                target: "S2",
                notes: JSON.stringify({ profile: "beam", fireControlId: "fc1" }),
            },
        ] as never[];
        const newOnly = filterNewFireDeclarations(fold, "S1", allDecls);
        expect(newOnly).toHaveLength(1);
        expect((newOnly[0] as { weapon?: string }).weapon).toBe("b2");

        const issues = validateDeclareShipFireBatch(fold, "S1", newOnly, { fc1: "S2" });
        expect(issues.some((i) => i.message.includes("already has a fire declaration"))).toBe(
            false
        );
        expect(issues.some((i) => i.message.includes("Duplicate weapon orders"))).toBe(false);
    });

    it("allows multiple weapons on one target with one fire control", () => {
        const fold: FoldState = {
            meta: {
                ...DEFAULT_META(),
                phase: 11,
                segment: "orders",
                activation: { queue: ["S1"], index: 0 },
            },
            position: {
                map: { mode: "fixed", width: 48, height: 36 },
                objects: [
                    {
                        objType: "ship",
                        id: "S1",
                        owner: "P1",
                        object: {
                            systems: [{ name: "fireControl", id: "fc1" }],
                            weapons: [
                                { name: "beam", id: "b1", class: 2 },
                                { name: "beam", id: "b2", class: 2 },
                            ],
                        },
                        svg: "<symbol></symbol>",
                        position: { x: 0, y: 0 },
                        facing: 12,
                        speed: 0,
                    },
                ],
            } as never,
            pendingFireDeclarations: [
                {
                    name: "declareShipFire",
                    ship: "S1",
                    weapon: "b1",
                    target: "S2",
                    notes: JSON.stringify({ profile: "beam", fireControlId: "fc1" }),
                } as never,
            ],
        };
        const issues = validateDeclareShipFire(
            fold,
            "S1",
            "b2",
            {},
            "S2",
            "beam",
            "fc1"
        );
        expect(issues.some((i) => i.message.includes("distinct target"))).toBe(false);
        expect(issues.some((i) => i.message.includes("fire-control module"))).toBe(false);
    });

    it("warns when distinct targets exceed fire control modules", () => {
        const fold: FoldState = {
            meta: {
                ...DEFAULT_META(),
                phase: 11,
                segment: "orders",
                activation: { queue: ["S1"], index: 0 },
            },
            position: {
                map: { mode: "fixed", width: 48, height: 36 },
                objects: [
                    {
                        objType: "ship",
                        id: "S1",
                        owner: "P1",
                        object: {
                            systems: [{ name: "fireControl", id: "fc1" }],
                            weapons: [
                                { name: "beam", id: "b1", class: 2 },
                                { name: "beam", id: "b2", class: 2 },
                            ],
                        },
                        svg: "<symbol></symbol>",
                        position: { x: 0, y: 0 },
                        facing: 12,
                        speed: 0,
                    },
                ],
            } as never,
            pendingFireDeclarations: [
                {
                    name: "declareShipFire",
                    ship: "S1",
                    weapon: "b1",
                    target: "S2",
                    notes: JSON.stringify({ profile: "beam", fireControlId: "fc1" }),
                } as never,
            ],
        };
        const issues = validateDeclareShipFire(
            fold,
            "S1",
            "b2",
            {},
            "S3",
            "beam",
            "fc1"
        );
        expect(issues.some((i) => i.message.includes("distinct target"))).toBe(true);
    });

    it("validateFireControlAssignments allows three weapons on one FC target", () => {
        const ship: ShipGameState = {
            id: "S1",
            object: {
                systems: [{ name: "fireControl", id: "fc1" }],
                weapons: [
                    { name: "beam", id: "b1" },
                    { name: "beam", id: "b2" },
                    { name: "beam", id: "b3" },
                ],
            },
        };
        const issues = validateFireControlAssignments(
            ship,
            { fc1: "S2" },
            [
                { weaponId: "b1", targetId: "S2", profile: "beam", fireControlId: "fc1" },
                { weaponId: "b2", targetId: "S2", profile: "beam", fireControlId: "fc1" },
                { weaponId: "b3", targetId: "S2", profile: "beam", fireControlId: "fc1" },
            ]
        );
        expect(issues.some((i) => i.message.includes("fire-control"))).toBe(false);
    });

    it("does not warn ship-already-declared when validating sequential weapon proposals", () => {
        let fold: FoldState = {
            meta: {
                ...DEFAULT_META(),
                phase: 11,
                segment: "orders",
                activation: { queue: ["S1"], index: 0 },
            },
            position: {
                map: { mode: "fixed", width: 48, height: 36 },
                objects: [
                    {
                        objType: "ship",
                        id: "S1",
                        owner: "P1",
                        object: {
                            systems: [{ name: "fireControl", id: "fc1" }],
                            weapons: [
                                { name: "beam", id: "b1", class: 2 },
                                { name: "beam", id: "b2", class: 2 },
                            ],
                        },
                        svg: "<symbol></symbol>",
                        position: { x: 0, y: 0 },
                        facing: 12,
                        speed: 0,
                    },
                ],
            } as never,
        };
        const decls = [
            {
                name: "declareShipFire",
                ship: "S1",
                weapon: "b1",
                target: "S2",
                notes: JSON.stringify({ profile: "beam", fireControlId: "fc1" }),
            },
            {
                name: "declareShipFire",
                ship: "S1",
                weapon: "b2",
                target: "S2",
                notes: JSON.stringify({ profile: "beam", fireControlId: "fc1" }),
            },
        ] as never[];
        for (const cmd of decls) {
            const issues = validateCommand(fold, cmd);
            expect(
                issues.some((i) => i.message.includes("already has fire declarations"))
            ).toBe(false);
            fold = applyCommand(fold, cmd).state;
        }
        expect(fold.pendingFireDeclarations).toHaveLength(2);
    });

    it("does not warn missing FC target when fireControlId is in the new declaration", () => {
        const fold: FoldState = {
            meta: {
                ...DEFAULT_META(),
                phase: 11,
                segment: "orders",
                activation: { queue: ["FrigateA1"], index: 0 },
            },
            position: {
                map: { mode: "fixed", width: 48, height: 36 },
                objects: [
                    {
                        objType: "ship",
                        id: "FrigateA1",
                        owner: "P1",
                        object: {
                            systems: [{ name: "fireControl", id: "SEVgE" }],
                            weapons: [{ name: "beam", id: "4Q_bf", class: 2 }],
                        },
                        svg: "<symbol></symbol>",
                        position: { x: 0, y: 0 },
                        facing: 12,
                        speed: 0,
                    },
                ],
            } as never,
        };
        const cmd = {
            name: "declareShipFire",
            ship: "FrigateA1",
            weapon: "4Q_bf",
            target: "FrigateB1",
            notes: JSON.stringify({
                profile: "beam",
                beamClass: 2,
                screens: 0,
                range: 21.86,
                arc: null,
                weaponName: "beam",
                fireControlId: "SEVgE",
            }),
        } as never;
        const issues = validateDeclareShipFireCommand(fold, cmd);
        expect(issues.some((i) => i.message.includes("No fire control assigned to target"))).toBe(
            false
        );
    });

    it("validateDeclareShipFireCommand validates a single new declaration in context", () => {
        const fold: FoldState = {
            meta: {
                ...DEFAULT_META(),
                phase: 11,
                segment: "orders",
                activation: { queue: ["S1"], index: 0 },
            },
            position: {
                map: { mode: "fixed", width: 48, height: 36 },
                objects: [
                    {
                        objType: "ship",
                        id: "S1",
                        owner: "P1",
                        object: {
                            systems: [{ name: "fireControl", id: "fc1" }],
                            weapons: [{ name: "beam", id: "b2", class: 2 }],
                        },
                        svg: "<symbol></symbol>",
                        position: { x: 0, y: 0 },
                        facing: 12,
                        speed: 0,
                    },
                ],
            } as never,
            pendingFireDeclarations: [
                {
                    name: "declareShipFire",
                    ship: "S1",
                    weapon: "b1",
                    target: "S2",
                    notes: JSON.stringify({ profile: "beam", fireControlId: "fc1" }),
                } as never,
            ],
        };
        const cmd = {
            name: "declareShipFire",
            ship: "S1",
            weapon: "b2",
            target: "S2",
            notes: JSON.stringify({ profile: "beam", fireControlId: "fc1" }),
        } as never;
        const issues = validateDeclareShipFireCommand(fold, cmd);
        expect(issues.some((i) => i.message.includes("already has fire declarations"))).toBe(
            false
        );
    });

    it("warns when declaring fire for an already-activated ship", () => {
        const fold: FoldState = {
            meta: {
                ...DEFAULT_META(),
                phase: 11,
                segment: "orders",
                activation: { queue: ["S1", "S2"], index: 1 },
            },
            position: {
                map: { mode: "fixed", width: 48, height: 36 },
                objects: [
                    {
                        objType: "ship",
                        id: "S1",
                        owner: "P1",
                        object: {},
                        svg: "<symbol></symbol>",
                        position: { x: 0, y: 0 },
                        facing: 12,
                        speed: 0,
                    },
                ],
            } as never,
        };
        const issues = validateDeclareShipFire(fold, "S1");
        expect(issues.some((i) => i.message.includes("already completed"))).toBe(true);
    });

    it("rejects transporter delivery without pending slot", () => {
        const fold: FoldState = {
            meta: { ...DEFAULT_META(), phase: 11 },
            position: {
                map: { mode: "fixed", width: 48, height: 36 },
                objects: [
                    {
                        objType: "ship",
                        id: "F1",
                        owner: "P1",
                        object: { systems: [{ name: "marines", id: "m1" }] },
                        svg: "<symbol></symbol>",
                        position: { x: 0, y: 0 },
                        facing: 12,
                        speed: 0,
                    },
                    {
                        objType: "ship",
                        id: "T1",
                        owner: "P2",
                        object: { systems: [{ name: "beam", id: "b1" }] },
                        svg: "<symbol></symbol>",
                        position: { x: 10, y: 0 },
                        facing: 12,
                        speed: 0,
                    },
                ],
            } as never,
        };
        const cmd = {
            name: "declareTransporterDelivery",
            firerShip: "F1",
            targetShip: "T1",
            weapon: "tr1",
            choice: { mode: "boarding", payload: "marine" },
        } as never;
        const issues = validateDeclareTransporterDelivery(fold, cmd);
        expect(issues.some((i) => i.message.includes("No pending transporter"))).toBe(true);
    });

    it("errors when transporter marine delivery exceeds firer availability", () => {
        const fold: FoldState = {
            meta: { ...DEFAULT_META(), phase: 11 },
            position: {
                map: { mode: "fixed", width: 48, height: 36 },
                objects: [
                    {
                        objType: "ship",
                        id: "F1",
                        owner: "P1",
                        object: {
                            systems: [
                                { name: "marines", id: "m1" },
                                { name: "marines", id: "m2" },
                            ],
                        },
                        crewDeployment: { deployed: ["m1", "m2"] },
                        svg: "<symbol></symbol>",
                        position: { x: 0, y: 0 },
                        facing: 12,
                        speed: 0,
                    },
                    {
                        objType: "ship",
                        id: "T1",
                        owner: "P2",
                        object: {},
                        svg: "<symbol></symbol>",
                        position: { x: 10, y: 0 },
                        facing: 12,
                        speed: 0,
                    },
                ],
            } as never,
            pendingTransporterDeliveries: [
                { firerShipId: "F1", targetShipId: "T1", weaponId: "tr1", remaining: 2 },
            ],
        };
        const cmd = {
            name: "declareTransporterDelivery",
            firerShip: "F1",
            targetShip: "T1",
            weapon: "tr1",
            choice: { mode: "boarding", payload: "marine" },
        } as never;
        const issues = validateDeclareTransporterDelivery(fold, cmd);
        expect(issues.some((i) => i.severity === "error" && /exceeds 0 available/.test(i.message))).toBe(
            true
        );
        const batch = validateTransporterDeliveryBatch(fold, "F1", [cmd, cmd]);
        expect(batch.some((i) => /Deploying 2 marine/.test(i.message))).toBe(true);
    });

    it("rejects commando delivery without system id", () => {
        const fold: FoldState = {
            meta: { ...DEFAULT_META(), phase: 11 },
            position: {
                map: { mode: "fixed", width: 48, height: 36 },
                objects: [
                    {
                        objType: "ship",
                        id: "F1",
                        owner: "P1",
                        object: { systems: [{ name: "marines", id: "m1" }] },
                        svg: "<symbol></symbol>",
                        position: { x: 0, y: 0 },
                        facing: 12,
                        speed: 0,
                    },
                    {
                        objType: "ship",
                        id: "T1",
                        owner: "P2",
                        object: { systems: [{ name: "beam", id: "b1" }] },
                        systems: [{ id: "b1", state: "ok" }],
                        svg: "<symbol></symbol>",
                        position: { x: 10, y: 0 },
                        facing: 12,
                        speed: 0,
                    },
                ],
            } as never,
            pendingTransporterDeliveries: [
                { firerShipId: "F1", targetShipId: "T1", weaponId: "tr1", remaining: 1 },
            ],
        };
        const cmd = {
            name: "declareTransporterDelivery",
            firerShip: "F1",
            targetShip: "T1",
            weapon: "tr1",
            choice: { mode: "commando", payload: "marine" },
        } as never;
        const issues = validateDeclareTransporterDelivery(fold, cmd);
        expect(issues.some((i) => i.message.includes("requires a target system"))).toBe(true);
    });

    it("fireOrderIneffectiveAtRangeIssue warns when beam class 1 is beyond 12 MU", () => {
        const issue = fireOrderIneffectiveAtRangeIssue({
            weaponId: "b1",
            weaponName: "beam",
            profileKey: "beam",
            beamClass: 1,
            rangeMu: 12.1,
        });
        expect(issue?.severity).toBe("warning");
        expect(issue?.message).toMatch(/rolls 0 dice/);
    });

    it("fireOrderIneffectiveAtRangeIssue warns when fixed-BD weapon exceeds max range", () => {
        const issue = fireOrderIneffectiveAtRangeIssue({
            weaponId: "g1",
            weaponName: "gatling",
            profileKey: "gatlingBd",
            beamClass: 1,
            rangeMu: 13,
        });
        expect(issue?.severity).toBe("warning");
        expect(issue?.message).toMatch(/exceeds max range 12 MU/);
    });

    it("fireOrderIneffectiveAtRangeIssue allows beam class 3 at 24 MU", () => {
        const issue = fireOrderIneffectiveAtRangeIssue({
            weaponId: "b3",
            profileKey: "beam",
            beamClass: 3,
            rangeMu: 24,
        });
        expect(issue).toBeUndefined();
    });

    it("fireDeclarationModeratorHints includes out-of-range warning for pending fire", () => {
        const meta = { ...DEFAULT_META(), phase: 11, turn: 1 };
        const position = {
            map: { mode: "fixed" as const, width: 48, height: 36 },
            objects: [
                {
                    objType: "ship" as const,
                    id: "S1",
                    owner: "P1",
                    object: {
                        weapons: [{ name: "beam", id: "b1", class: 1 }],
                    },
                    svg: "<symbol></symbol>",
                    position: { x: 0, y: 0 },
                    facing: 12,
                    speed: 0,
                },
            ],
        };
        const pending = [
            {
                name: "declareShipFire",
                ship: "S1",
                weapon: "b1",
                target: "S2",
                notes: JSON.stringify({
                    profile: "beam",
                    beamClass: 1,
                    range: 18,
                    fireControlId: "fc1",
                }),
            },
        ] as never[];
        const hints = fireDeclarationModeratorHints(meta, position, pending);
        expect(hints.some((h) => h.includes("rolls 0 dice"))).toBe(true);
    });
});
