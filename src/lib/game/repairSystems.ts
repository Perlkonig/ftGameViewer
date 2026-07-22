/** Phase 14 damage control: repair targets, dice, and resolution. */

import type { FullThrustGameCommand } from "@/schemas/commands";
import type { FullThrustGamePosition } from "@/schemas/position";
import type { RollSource } from "./dice";
import { dcpAvailabilityForShip } from "./crewDeployment";
import { isNonRepairableSystem, listShipSystems, type ShipSystemEntry } from "./shipSystems";
import type { CoreState } from "./coreSystems";
import { shipIsAbandoned } from "./coreSystems";
import type { RepairOrdersV1 } from "./repairOrders";
import {
    formatDcpRepairResultNotes,
    formatRegenArmourResultNotes,
    makeLogDice,
} from "./rollResults";

export interface RepairTarget {
    id: string;
    label: string;
    kind: "system" | "drive" | "core";
}

export type ShipWithRepairState = {
    id: string;
    object: unknown;
    systems?: { id: string; state?: string }[];
    coreState?: CoreState;
    crewDeployment?: { deployed?: string[] };
    dmgArmour?: { standard?: number; regenerative?: number; regenerativeLost?: number }[];
};

const MARINE_NAME = /^marines?$/i;
const DCP_NAME = /^damagecontrol|damage.?control|dcp$/i;

function isNonRepairableCrewSystem(entry: ShipSystemEntry): boolean {
    const n = (entry.name ?? "").toLowerCase();
    return MARINE_NAME.test(n) || DCP_NAME.test(n);
}

function deployedCrewIds(ship: ShipWithRepairState): Set<string> {
    return new Set(ship.crewDeployment?.deployed ?? []);
}

function systemState(ship: ShipWithRepairState, id: string): string | undefined {
    return ship.systems?.find((s) => s.id === id)?.state;
}

function formatSystemLabel(entry: ShipSystemEntry): string {
    const name = entry.name ?? entry.id;
    const n = name.toLowerCase();
    if (n === "drive") {
        const thrust = Number(entry.thrust);
        const thrustLabel = Number.isFinite(thrust) && thrust > 0 ? `T${thrust}` : "drive";
        return `Drive ${thrustLabel} (half thrust)`;
    }
    if (n === "beam" || n === "beambattery") {
        const cls = (entry as { class?: number }).class;
        const arc = (entry as { leftArc?: string }).leftArc;
        const bits = [`Beam battery`];
        if (typeof cls === "number") bits.push(`class ${cls}`);
        if (arc) bits.push(`(${arc} arc)`);
        return bits.join(" ");
    }
    if (n === "firecontrol") return "Fire control";
    if (n === "screen") return "Screen";
    if (n === "damagecontrol") return "Hired damage control";
    if (n === "marines" || n === "marine") return "Marines";
    if (entry.type === "weapon" || entry.type === "ordnance") {
        return `${name} (${entry.type})`;
    }
    return name;
}

function coreTargets(ship: ShipWithRepairState): RepairTarget[] {
    const cs = ship.coreState;
    if (!cs) return [];
    const targets: RepairTarget[] = [];
    if (cs.powerless && !shipIsAbandoned(cs)) {
        targets.push({ id: "_corePower", label: "Reactor (powerless)", kind: "core" });
    }
    if ((cs.uncontrolled ?? 0) > 0) {
        targets.push({
            id: "_coreBridge",
            label: `Bridge (uncontrolled, ${cs.uncontrolled} turn(s))`,
            kind: "core",
        });
    }
    if ((cs.lifeless ?? 0) > 0) {
        targets.push({
            id: "_coreLife",
            label: `Life support (${cs.lifeless} turn(s) remaining)`,
            kind: "core",
        });
    }
    return targets;
}

/** Enumerate repairable targets (damaged systems/drives/cores — not marines, hired DCP, or deployed crew). */
export function repairTargetsForShip(ship: ShipWithRepairState): RepairTarget[] {
    const targets: RepairTarget[] = [];
    const absent = deployedCrewIds(ship);
    for (const entry of listShipSystems(ship)) {
        if (isNonRepairableCrewSystem(entry) || isNonRepairableSystem(entry)) continue;
        if (absent.has(entry.id)) continue;
        const state = systemState(ship, entry.id);
        if (state !== "damaged") continue;
        const n = (entry.name ?? "").toLowerCase();
        targets.push({
            id: entry.id,
            label: formatSystemLabel(entry),
            kind: n === "drive" ? "drive" : "system",
        });
    }
    targets.push(...coreTargets(ship));
    return targets.sort((a, b) => a.label.localeCompare(b.label));
}

export function damagedRegenArmourCount(ship: ShipWithRepairState): number {
    if (!Array.isArray(ship.dmgArmour)) return 0;
    return ship.dmgArmour.reduce((sum, row) => sum + (row.regenerative ?? 0), 0);
}

export function shipHasRegenerativeArmour(ship: ShipWithRepairState): boolean {
    const obj = ship.object as { armour?: [number, number][] };
    return (obj.armour ?? []).some((row) => (row[1] ?? 0) > 0);
}

export function shipHasRepairableDamage(ship: ShipWithRepairState): boolean {
    return repairTargetsForShip(ship).length > 0 || damagedRegenArmourCount(ship) > 0;
}

export function shipHasRegenRepairWork(ship: ShipWithRepairState): boolean {
    return damagedRegenArmourCount(ship) > 0 && shipHasRegenerativeArmour(ship);
}

/** Damaged systems/drives/cores and at least one DCP available to allocate. */
export function shipHasDcpRepairWork(ship: ShipWithRepairState): boolean {
    return (
        repairTargetsForShip(ship).length > 0 && dcpAvailabilityForShip(ship).available > 0
    );
}

/** Ships that should receive repair orders in phase 14 (DCP work or regen-only). */
export function shipNeedsRepairOrders(ship: ShipWithRepairState): boolean {
    return shipHasDcpRepairWork(ship) || shipHasRegenRepairWork(ship);
}

export function shipsWithRepairableDamage(position: FullThrustGamePosition): string[] {
    return (position.objects ?? [])
        .filter((o) => o.objType === "ship" && shipHasRepairableDamage(o as ShipWithRepairState))
        .map((o) => o.id)
        .sort();
}

export function shipsNeedingRepairOrders(position: FullThrustGamePosition): string[] {
    return (position.objects ?? [])
        .filter((o) => o.objType === "ship" && shipNeedsRepairOrders(o as ShipWithRepairState))
        .map((o) => o.id)
        .sort();
}

export function repairHintForShip(ship: ShipWithRepairState): string {
    const targets = repairTargetsForShip(ship);
    const regen = damagedRegenArmourCount(ship);
    if (targets.length === 0 && regen > 0) {
        return "regenerative armour only";
    }
    if (targets.length === 0) return "—";
    const labels = targets.map((t) => t.label);
    const max = 3;
    const shown = labels.slice(0, max);
    const extra = labels.length > max ? ` +${labels.length - max} more` : "";
    const regenNote = regen > 0 ? ", regen armour" : "";
    return `${shown.join(", ")}${extra}${regenNote}`;
}

export function repairAttemptSucceeds(roll: number, dcp: number): boolean {
    const dc = Math.min(3, Math.max(1, Math.floor(dcp)));
    return roll <= dc;
}

export function regenArmourRollOutcome(roll: number): "repaired" | "lost" | "noChange" {
    if (roll >= 5) return "repaired";
    if (roll === 1) return "lost";
    return "noChange";
}

/** Regen boxes in innermost-row-first, left-to-right order within each row. */
export function regenArmourBoxSlots(
    ship: ShipWithRepairState
): { row: number }[] {
    const slots: { row: number }[] = [];
    const rows = ship.dmgArmour ?? [];
    for (let row = 0; row < rows.length; row++) {
        const count = rows[row].regenerative ?? 0;
        for (let i = 0; i < count; i++) slots.push({ row });
    }
    return slots;
}

export function repairDiceCountForOrder(order: RepairOrdersV1): number {
    let n = 0;
    for (const alloc of order.allocations) {
        if (Math.floor(alloc.dcp) >= 1) n += 1;
    }
    return n;
}

export function repairDiceCountForShipOrder(
    ship: ShipWithRepairState,
    order: RepairOrdersV1
): number {
    let n = repairDiceCountForOrder(order);
    if (order.repairRegenArmour) {
        n += damagedRegenArmourCount(ship);
    }
    return n;
}

export function repairDiceCountForOrders(
    shipOrders: { shipId: string; order: RepairOrdersV1 }[],
    shipsById: Map<string, ShipWithRepairState>
): number {
    let total = 0;
    for (const { shipId, order } of shipOrders) {
        const ship = shipsById.get(shipId);
        if (!ship) continue;
        total += repairDiceCountForShipOrder(ship, order);
    }
    return total;
}

function successCommandsForTarget(
    shipId: string,
    targetId: string
): FullThrustGameCommand[] {
    if (targetId === "_corePower") {
        return [{ name: "setCoreState", ship: shipId, powerless: false } as FullThrustGameCommand];
    }
    if (targetId === "_coreBridge") {
        return [{ name: "setCoreState", ship: shipId, uncontrolled: 0 } as FullThrustGameCommand];
    }
    if (targetId === "_coreLife") {
        return [{ name: "setCoreState", ship: shipId, lifeless: 0 } as FullThrustGameCommand];
    }
    return [
        {
            name: "sysEnable",
            ship: shipId,
            system: targetId,
            state: "repaired",
        } as FullThrustGameCommand,
    ];
}

export function resolveRepairOrdersCommands(
    shipId: string,
    ship: ShipWithRepairState,
    order: RepairOrdersV1,
    source: RollSource
): FullThrustGameCommand[] {
    const cmds: FullThrustGameCommand[] = [];
    const mark = source.mark();
    const lines: string[] = [];

    for (const alloc of order.allocations) {
        const dcp = Math.floor(alloc.dcp);
        if (dcp < 1) continue;
        const roll = source.next();
        const success = repairAttemptSucceeds(roll, dcp);
        const notes = formatDcpRepairResultNotes(shipId, alloc.targetId, roll, dcp, success);
        lines.push(notes);
        cmds.push(
            makeLogDice({
                purpose: `DCP repair ${shipId}/${alloc.targetId}`,
                rolls: [roll],
                source: "client",
                result: notes,
            })
        );
        if (success) {
            cmds.push(...successCommandsForTarget(shipId, alloc.targetId));
        } else {
            cmds.push({ name: "_custom", msg: notes } as FullThrustGameCommand);
        }
    }

    if (order.repairRegenArmour) {
        const slots = regenArmourBoxSlots(ship);
        for (const slot of slots) {
            const roll = source.next();
            const outcome = regenArmourRollOutcome(roll);
            const notes = formatRegenArmourResultNotes(shipId, slot.row, roll, outcome);
            lines.push(notes);
            cmds.push(
                makeLogDice({
                    purpose: `regen armour ${shipId} row ${slot.row}`,
                    rolls: [roll],
                    source: "client",
                    result: notes,
                })
            );
            if (outcome === "repaired") {
                cmds.push({
                    name: "adjustRegenArmour",
                    ship: shipId,
                    row: slot.row,
                    regenerative: -1,
                } as FullThrustGameCommand);
            } else if (outcome === "lost") {
                cmds.push({
                    name: "adjustRegenArmour",
                    ship: shipId,
                    row: slot.row,
                    regenerative: -1,
                    regenerativeLost: 1,
                } as FullThrustGameCommand);
            } else {
                cmds.push({ name: "_custom", msg: notes } as FullThrustGameCommand);
            }
        }
    }

    const consumed = source.consumedSince(mark);
    cmds.push({
        name: "resolveRepairOrders",
        ship: shipId,
        rolls: consumed,
    } as FullThrustGameCommand);
    cmds.push({
        name: "_custom",
        msg: `Repair ${shipId}: ${lines.join("; ")}`,
    } as FullThrustGameCommand);

    return cmds;
}

export function repairOrderSummary(shipId: string, order: RepairOrdersV1): string {
    const parts: string[] = [];
    for (const a of order.allocations) {
        if (a.dcp >= 1) parts.push(`${a.targetId}×${a.dcp} DCP`);
    }
    if (order.repairRegenArmour) parts.push("regen armour");
    if (parts.length === 0) return `${shipId}: (empty)`;
    return `${shipId}: ${parts.join(", ")}`;
}

export interface RepairAllocationPreview {
    targetId: string;
    label: string;
    dcp: number;
    successOn: string;
}

export function repairAllocationPreview(
    ship: ShipWithRepairState,
    order: RepairOrdersV1
): RepairAllocationPreview[] {
    const labelById = new Map(repairTargetsForShip(ship).map((t) => [t.id, t.label]));
    return order.allocations
        .filter((a) => Math.floor(a.dcp) >= 1)
        .map((a) => {
            const dcp = Math.min(3, Math.max(1, Math.floor(a.dcp)));
            return {
                targetId: a.targetId,
                label: labelById.get(a.targetId) ?? a.targetId,
                dcp,
                successOn: dcp === 1 ? "1" : `1–${dcp}`,
            };
        });
}
