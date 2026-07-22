/** Phase 7 homing missile / ordnance target allocation. */

import type { FullThrustGameCommand } from "@/schemas/commands";
import type { FullThrustGamePosition } from "@/schemas/position";
import { distance, type Point } from "./movement";
import { isVectorShip } from "./vectorMovement";
import { isDeployedFighter } from "./fighterMove";

export const HOMING_CINEMATIC_RANGE_MU = 6;
export const HOMING_VECTOR_RANGE_MU = 3;

export type OrdnanceAllocationAction = "target" | "destroy" | "skip";

export interface PendingOrdnanceAllocation {
    ordnanceId: string;
    action: OrdnanceAllocationAction;
    targetShipId?: string;
    proposed: boolean;
}

type OrdnanceObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "ordnance" }
>;
type ShipObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "ship" }
>;

const HOMING_TYPES = new Set([
    "missile",
    "salvo",
    "salvoER",
    "salvoMS",
    "amt",
]);

const SKIP_TYPES = new Set(["rocket", "plasmaBolt", "mine"]);

export function isMultistageStage1(ord: OrdnanceObj): boolean {
    return (
        ord.stage === 1 &&
        (ord.type === "salvoMS" || ord.type === "missile")
    );
}

export function ordnanceSkipsPhase7Allocation(ord: OrdnanceObj): boolean {
    if (SKIP_TYPES.has(ord.type)) return true;
    if (ord.type === "amt" && (ord as { detonateOpenSpace?: boolean }).detonateOpenSpace) {
        return true;
    }
    return false;
}

export function ordnanceNeedsPhase7Allocation(ord: OrdnanceObj): boolean {
    if (ordnanceSkipsPhase7Allocation(ord)) return false;
    if (HOMING_TYPES.has(ord.type)) return true;
    return false;
}

export function homingRangeForTargetShip(ship: ShipObj): number {
    return isVectorShip(ship) ? HOMING_VECTOR_RANGE_MU : HOMING_CINEMATIC_RANGE_MU;
}

function ordnancePosition(ord: OrdnanceObj): Point | undefined {
    const pos = ord.position;
    if (!pos || typeof pos !== "object" || !("x" in pos)) return undefined;
    return pos as Point;
}

function shipPosition(ship: ShipObj): Point | undefined {
    const pos = ship.position;
    if (!pos || typeof pos !== "object" || !("x" in pos)) return undefined;
    return pos as Point;
}

function isEnemyShip(
    ordOwner: string | undefined,
    ship: ShipObj
): boolean {
    return !!ordOwner && !!ship.owner && ordOwner !== ship.owner;
}

export function findClosestEnemyShip(
    position: FullThrustGamePosition,
    from: Point,
    ordOwner: string | undefined
): ShipObj | undefined {
    let best: ShipObj | undefined;
    let bestDist = Infinity;
    for (const obj of position.objects ?? []) {
        if (obj.objType !== "ship" || !obj.owner) continue;
        const ship = obj as ShipObj;
        if (!isEnemyShip(ordOwner, ship)) continue;
        const spos = shipPosition(ship);
        if (!spos) continue;
        const range = homingRangeForTargetShip(ship);
        const d = distance(from, spos);
        if (d > range) continue;
        if (d < bestDist || (d === bestDist && ship.id < (best?.id ?? ""))) {
            bestDist = d;
            best = ship;
        }
    }
    return best;
}

export function proposeAllocationForOrdnance(
    position: FullThrustGamePosition,
    ord: OrdnanceObj
): PendingOrdnanceAllocation {
    const opos = ordnancePosition(ord);
    if (!opos || ordnanceSkipsPhase7Allocation(ord)) {
        return { ordnanceId: ord.id, action: "skip", proposed: true };
    }
    const target = findClosestEnemyShip(position, opos, ord.owner);
    if (target) {
        return {
            ordnanceId: ord.id,
            action: "target",
            targetShipId: target.id,
            proposed: true,
        };
    }
    if (isMultistageStage1(ord)) {
        return { ordnanceId: ord.id, action: "skip", proposed: true };
    }
    return { ordnanceId: ord.id, action: "destroy", proposed: true };
}

export function buildOrdnanceAllocationProposals(
    position: FullThrustGamePosition
): PendingOrdnanceAllocation[] {
    const proposals: PendingOrdnanceAllocation[] = [];
    for (const obj of position.objects ?? []) {
        if (obj.objType !== "ordnance") continue;
        const ord = obj as OrdnanceObj;
        if (!ordnanceNeedsPhase7Allocation(ord) && !ordnanceSkipsPhase7Allocation(ord)) {
            continue;
        }
        if (ordnanceSkipsPhase7Allocation(ord)) {
            proposals.push({ ordnanceId: ord.id, action: "skip", proposed: true });
        } else {
            proposals.push(proposeAllocationForOrdnance(position, ord));
        }
    }
    return proposals;
}

export function applyOrdnanceAllocationsToPosition(
    position: FullThrustGamePosition,
    pending: PendingOrdnanceAllocation[]
): void {
    if (!position.objects) return;
    const remove = new Set<string>();
    for (const entry of pending) {
        const ord = position.objects.find(
            (o) => o.objType === "ordnance" && o.id === entry.ordnanceId
        ) as OrdnanceObj | undefined;
        if (!ord) continue;
        if (entry.action === "target" && entry.targetShipId) {
            ord.targetShip = entry.targetShipId;
        } else if (entry.action === "destroy") {
            remove.add(entry.ordnanceId);
        }
    }
    if (remove.size > 0) {
        position.objects = position.objects.filter((o) => !remove.has(o.id));
    }
}

export function formatOrdnanceAllocationSummary(entry: PendingOrdnanceAllocation): string {
    if (entry.action === "target" && entry.targetShipId) {
        return `${entry.ordnanceId} → ${entry.targetShipId}`;
    }
    return `${entry.ordnanceId}: ${entry.action}`;
}

/** Logged commands to record pending proposals before applying them to the board. */
export function phase7OrdnanceLogCommands(
    pending: PendingOrdnanceAllocation[]
): FullThrustGameCommand[] {
    if (pending.length === 0) return [];
    const cmds: FullThrustGameCommand[] = [];
    for (const entry of pending) {
        cmds.push({
            name: "allocateOrdnanceTarget",
            ordnanceId: entry.ordnanceId,
            action: entry.action,
            targetShipId: entry.targetShipId,
        } as FullThrustGameCommand);
    }
    cmds.push({ name: "applyOrdnanceAllocations" } as FullThrustGameCommand);
    return cmds;
}

export function phase7HasAllocationContent(position: FullThrustGamePosition): boolean {
    for (const obj of position.objects ?? []) {
        if (obj.objType === "ordnance" && ordnanceNeedsPhase7Allocation(obj as OrdnanceObj)) {
            return true;
        }
        if (isDeployedFighter(obj)) return true;
    }
    return false;
}

export function homingOrdnanceWithoutTarget(
    position: FullThrustGamePosition,
    pending: PendingOrdnanceAllocation[] | undefined
): string[] {
    const pendingById = new Map((pending ?? []).map((p) => [p.ordnanceId, p]));
    const unallocated: string[] = [];
    for (const obj of position.objects ?? []) {
        if (obj.objType !== "ordnance") continue;
        const ord = obj as OrdnanceObj;
        if (!ordnanceNeedsPhase7Allocation(ord)) continue;
        const p = pendingById.get(ord.id);
        if (!p || p.action === "skip" || (p.action === "destroy" && !isMultistageStage1(ord))) {
            if (p?.action === "target" && p.targetShipId) continue;
            if (ord.targetShip) continue;
            if (p?.action === "destroy") continue;
            unallocated.push(ord.id);
        }
    }
    return unallocated.sort();
}
