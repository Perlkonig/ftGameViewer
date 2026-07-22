import { describe, expect, it } from "vitest";
import { arrayRollSource } from "./dice";
import {
    damagedRegenArmourCount,
    regenArmourRollOutcome,
    repairAttemptSucceeds,
    repairAllocationPreview,
    repairDiceCountForShipOrder,
    repairHintForShip,
    repairTargetsForShip,
    resolveRepairOrdersCommands,
    shipHasDcpRepairWork,
    shipHasRepairableDamage,
    shipNeedsRepairOrders,
    shipsNeedingRepairOrders,
    type ShipWithRepairState,
} from "./repairSystems";
import type { RepairOrdersV1 } from "./repairOrders";
import { validateDeclareRepairOrdersCommand } from "./commandValidation";
import { DEFAULT_META } from "./types";
import type { FoldState } from "./applyCommand";

const damagedShip = (): ShipWithRepairState => ({
    id: "S1",
    object: {
        systems: [
            { name: "beam", class: 2, leftArc: "FP", id: "b1" },
            { name: "drive", thrust: 6, id: "d1" },
        ],
        armour: [[2, 1]],
    },
    systems: [
        { id: "b1", state: "damaged" },
        { id: "d1", state: "damaged" },
    ],
    coreState: { powerless: true },
    dmgArmour: [{ standard: 0, regenerative: 2, regenerativeLost: 0 }],
});

describe("repairSystems", () => {
    it("enumerates damaged systems, drives, and core knockouts", () => {
        const ship = damagedShip();
        const targets = repairTargetsForShip(ship);
        const ids = targets.map((t) => t.id);
        expect(ids).toContain("b1");
        expect(ids).toContain("d1");
        expect(ids).toContain("_corePower");
        expect(targets.find((t) => t.id === "d1")?.label).toMatch(/half thrust/i);
    });

    it("treats damaged regen armour as repairable", () => {
        const ship: ShipWithRepairState = {
            id: "R1",
            object: { armour: [[0, 2]] },
            dmgArmour: [{ regenerative: 1 }],
        };
        expect(shipHasRepairableDamage(ship)).toBe(true);
        expect(repairHintForShip(ship)).toBe("regenerative armour only");
        expect(damagedRegenArmourCount(ship)).toBe(1);
    });

    it("DCP repair succeeds when roll <= allocated DCP", () => {
        expect(repairAttemptSucceeds(1, 1)).toBe(true);
        expect(repairAttemptSucceeds(2, 2)).toBe(true);
        expect(repairAttemptSucceeds(3, 3)).toBe(true);
        expect(repairAttemptSucceeds(2, 1)).toBe(false);
        expect(repairAttemptSucceeds(4, 3)).toBe(false);
    });

    it("counts dice for system attempts and regen boxes", () => {
        const ship = damagedShip();
        const order: RepairOrdersV1 = {
            v: 1,
            allocations: [
                { targetId: "b1", dcp: 2 },
                { targetId: "d1", dcp: 0 },
            ],
            repairRegenArmour: true,
        };
        expect(repairDiceCountForShipOrder(ship, order)).toBe(3);
    });

    it("regen armour outcomes follow 5-6 repair, 1 lost, 2-4 no change", () => {
        expect(regenArmourRollOutcome(5)).toBe("repaired");
        expect(regenArmourRollOutcome(6)).toBe("repaired");
        expect(regenArmourRollOutcome(1)).toBe("lost");
        expect(regenArmourRollOutcome(3)).toBe("noChange");
    });

    it("resolveRepairOrdersCommands emits sysEnable and adjustRegenArmour", () => {
        const ship = damagedShip();
        const order: RepairOrdersV1 = {
            v: 1,
            allocations: [{ targetId: "b1", dcp: 3 }],
            repairRegenArmour: true,
        };
        const source = arrayRollSource([1, 5, 6]);
        const cmds = resolveRepairOrdersCommands("S1", ship, order, source);
        expect(cmds.some((c) => c.name === "sysEnable" && (c as { system?: string }).system === "b1")).toBe(
            true
        );
        expect(
            cmds.some(
                (c) =>
                    c.name === "adjustRegenArmour" &&
                    (c as { regenerative?: number }).regenerative === -1 &&
                    (c as { regenerativeLost?: number }).regenerativeLost === undefined
            )
        ).toBe(true);
        expect(cmds.some((c) => c.name === "resolveRepairOrders")).toBe(true);
    });

    it("excludes marines, hired DCP, and deployed crew from repair targets", () => {
        const ship: ShipWithRepairState = {
            id: "S1",
            object: {
                systems: [
                    { name: "marines", id: "m1" },
                    { name: "damageControl", id: "dcp1" },
                    { name: "fireControl", id: "fc1" },
                ],
            },
            systems: [
                { id: "m1", state: "damaged" },
                { id: "dcp1", state: "damaged" },
                { id: "fc1", state: "damaged" },
                { id: "m2", state: "damaged" },
            ],
            crewDeployment: { deployed: ["m2"] },
        };
        const ids = repairTargetsForShip(ship).map((t) => t.id);
        expect(ids).toEqual(["fc1"]);
    });

    it("shipNeedsRepairOrders requires DCP for system damage", () => {
        const withDcp: ShipWithRepairState = {
            id: "S1",
            object: {
                mass: 90,
                systems: [{ name: "fireControl", id: "fc1" }],
            },
            systems: [{ id: "fc1", state: "damaged" }],
        };
        expect(shipHasDcpRepairWork(withDcp)).toBe(true);
        expect(shipNeedsRepairOrders(withDcp)).toBe(true);

        const noDcp: ShipWithRepairState = {
            id: "S1",
            object: {
                mass: 90,
                hull: { points: 20, rows: 4 },
                systems: [{ name: "fireControl", id: "fc1" }],
            },
            dmgHull: 20,
            systems: [{ id: "fc1", state: "damaged" }],
        };
        expect(shipHasDcpRepairWork(noDcp)).toBe(false);
        expect(shipNeedsRepairOrders(noDcp)).toBe(false);
    });

    it("shipsNeedingRepairOrders includes regen-only ships", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            objects: [
                {
                    objType: "ship" as const,
                    id: "R1",
                    object: { armour: [[0, 2]] },
                    dmgArmour: [{ regenerative: 1 }],
                },
            ],
        };
        expect(shipsNeedingRepairOrders(position)).toEqual(["R1"]);
    });

    it("example: mass-90 ship allocates 3 DCP to firecon and 2 to weapon", () => {
        const ship: ShipWithRepairState = {
            id: "Cruiser",
            object: {
                mass: 90,
                systems: [{ name: "fireControl", id: "fc1" }],
                weapons: [{ name: "beam", id: "w1", class: 2 }],
            },
            systems: [
                { id: "fc1", state: "damaged" },
                { id: "w1", state: "damaged" },
            ],
        };
        const order: RepairOrdersV1 = {
            v: 1,
            allocations: [
                { targetId: "fc1", dcp: 3 },
                { targetId: "w1", dcp: 2 },
            ],
        };
        const preview = repairAllocationPreview(ship, order);
        expect(preview.map((p) => p.successOn)).toEqual(["1–3", "1–2"]);
        const source = arrayRollSource([3, 2]);
        const cmds = resolveRepairOrdersCommands("Cruiser", ship, order, source);
        expect(cmds.some((c) => c.name === "sysEnable" && (c as { system?: string }).system === "fc1")).toBe(
            true
        );
        expect(cmds.some((c) => c.name === "sysEnable" && (c as { system?: string }).system === "w1")).toBe(
            true
        );
    });

    it("rejects repair declare from wrong owner", () => {
        const fold: FoldState = {
            meta: { ...DEFAULT_META(), phase: 14, segment: "orders" },
            position: {
                map: { mode: "fixed", width: 72, height: 48 },
                objects: [
                    {
                        objType: "ship",
                        id: "S1",
                        owner: "P2",
                        object: {
                            mass: 50,
                            systems: [{ name: "fireControl", id: "fc1" }],
                        },
                        systems: [{ id: "fc1", state: "damaged" }],
                    },
                ],
            },
        };
        const issues = validateDeclareRepairOrdersCommand(
            fold,
            fold.position,
            {
                name: "declareRepairOrders",
                ship: "S1",
                notes: JSON.stringify({
                    v: 1,
                    allocations: [{ targetId: "fc1", dcp: 1 }],
                }),
            } as never,
            [],
            { actingPlayer: "P1", moderator: false }
        );
        expect(issues.some((i) => i.severity === "error" && i.message.includes("P2"))).toBe(true);
    });

    it("excludes magazines and single-use ordnance racks from repair targets", () => {
        const ship: ShipWithRepairState = {
            id: "S1",
            object: {
                systems: [{ name: "magazine", id: "mag1" }],
                ordnance: [
                    { name: "salvo", id: "salvo1" },
                    { name: "missile", id: "hm1" },
                    { name: "amt", id: "amt1" },
                    { name: "salvoLauncher", id: "sl1", magazine: "mag1" },
                ],
            },
            systems: [
                { id: "mag1", state: "damaged" },
                { id: "salvo1", state: "damaged" },
                { id: "hm1", state: "damaged" },
                { id: "amt1", state: "damaged" },
                { id: "sl1", state: "damaged" },
            ],
        };
        const ids = repairTargetsForShip(ship).map((t) => t.id);
        expect(ids).toEqual(["sl1"]);
    });
});
