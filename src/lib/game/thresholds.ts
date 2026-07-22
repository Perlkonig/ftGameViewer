/** Threshold check helpers when hull rows are destroyed. */

import type { FullThrustGamePosition } from "@/schemas/position";
import type { GameMeta } from "./types";
import { coreSystemsInThresholdEnabled } from "./types";

export interface BoardingCaptureState {
    by: string;
    turn?: number;
    resolved?: boolean;
}

export interface ShipHullState extends ShipThresholdState {
    boardingCapture?: BoardingCaptureState;
    empHullRowDrm?: number;
}

export interface ThresholdCrossing {
    /** Number of hull rows crossed in this hit. */
    thresholdsCrossed: number;
    /** Fail on this or higher on d6 for the highest new threshold (with +1 per extra). */
    failOnOrAbove: number;
    /** 1-based index of the highest row boundary crossed (not the last hull row). */
    thresholdIndex: number;
    /** +1 per extra row crossed in the same hit (added to each die). */
    rollBonus: number;
}

export interface PendingThreshold {
    failOnOrAbove: number;
    rollBonus: number;
    thresholdIndex: number;
    crossedRows: number;
}

export interface ShipThresholdState {
    /** @deprecated Legacy single pending check — use pendingThresholds. */
    pendingThreshold?: PendingThreshold;
    pendingThresholds?: PendingThreshold[];
    thresholdRowsResolved?: number;
    dmgHull?: number;
    object?: { hull?: { points?: number; rows?: number } };
}

/**
 * Hull is typically divided into rows. When a complete row is removed, threshold checks occur.
 * No check at the end of the last hull row (ship destroyed).
 */
export function thresholdsCrossed(
    hullBoxes: number,
    rowCount: number,
    dmgBefore: number,
    dmgAfter: number
): ThresholdCrossing {
    const rows = Math.max(1, rowCount);
    const rowSize = hullBoxes / rows;
    const rowBefore = Math.floor(dmgBefore / rowSize);
    const rowAfter = Math.floor(Math.min(dmgAfter, hullBoxes) / rowSize);

    if (rowAfter >= rows) {
        return { thresholdsCrossed: 0, failOnOrAbove: 7, thresholdIndex: 0, rollBonus: 0 };
    }

    const effectiveAfter = rowAfter;
    const crossed = Math.max(0, effectiveAfter - rowBefore);
    if (crossed === 0) {
        return { thresholdsCrossed: 0, failOnOrAbove: 7, thresholdIndex: 0, rollBonus: 0 };
    }

    const thresholdIndex = effectiveAfter;
    const baseFail = Math.max(1, 7 - thresholdIndex);
    const failOnOrAbove = Math.max(1, baseFail - (crossed - 1));
    const rollBonus = Math.max(0, crossed - 1);

    return { thresholdsCrossed: crossed, failOnOrAbove, thresholdIndex, rollBonus };
}

export function systemFailsThreshold(
    roll: number,
    failOnOrAbove: number,
    rollBonus = 0
): boolean {
    return Math.min(6, roll + rollBonus) >= failOnOrAbove;
}

/** Drive: 1st fail = half thrust; 2nd = disabled — tracked by caller via sysDisable state. */
export type DriveThresholdState = "ok" | "half" | "disabled";

export function nextDriveState(current: DriveThresholdState, failed: boolean): DriveThresholdState {
    if (!failed) return current;
    if (current === "ok") return "half";
    return "disabled";
}

export function hullLayout(ship: ShipThresholdState): { hullBoxes: number; rows: number } {
    const hull = ship.object?.hull;
    return {
        hullBoxes: hull?.points ?? 12,
        rows: hull?.rows ?? 3,
    };
}

/** True when `hullDamageAdded` fills the ship's last remaining hull box. */
export function shipDestroyedByHullDamage(
    ship: ShipThresholdState,
    hullDamageAdded: number
): boolean {
    if (hullDamageAdded <= 0) return false;
    const { hullBoxes } = hullLayout(ship);
    const dmgBefore = Number(ship.dmgHull ?? 0) || 0;
    if (dmgBefore >= hullBoxes) return false;
    return dmgBefore + hullDamageAdded >= hullBoxes;
}

/** True when all hull boxes are marked destroyed (dmgHull >= hull capacity). */
export function isShipHullDestroyed(ship: ShipThresholdState): boolean {
    const { hullBoxes } = hullLayout(ship);
    const dmg = Number(ship.dmgHull ?? 0) || 0;
    return dmg >= hullBoxes;
}

/** Boarding-captured ships are not removed by the phase 11→12 hull sweep. */
export function isShipExemptFromHullDestruction(ship: ShipHullState): boolean {
    return ship.boardingCapture != null;
}

/** Ship ids eligible for removal at end of phase 11 (hull depleted, not captured). */
export function shipsForPhase11HullDestruction(position: FullThrustGamePosition): string[] {
    const ids: string[] = [];
    for (const obj of position.objects ?? []) {
        if (obj.objType !== "ship") continue;
        const ship = obj as ShipHullState;
        if (!isShipHullDestroyed(ship)) continue;
        if (isShipExemptFromHullDestruction(ship)) continue;
        ids.push(ship.id);
    }
    return ids;
}

/** Pending hull threshold checks (supports legacy single pendingThreshold). */
export function pendingThresholdList(ship: ShipThresholdState): PendingThreshold[] {
    if (ship.pendingThresholds?.length) {
        return [...ship.pendingThresholds].sort((a, b) => a.thresholdIndex - b.thresholdIndex);
    }
    if (ship.pendingThreshold) return [ship.pendingThreshold];
    return [];
}

function setPendingThresholdList(ship: ShipThresholdState, queue: PendingThreshold[]): void {
    delete ship.pendingThreshold;
    if (queue.length === 0) {
        delete ship.pendingThresholds;
    } else {
        ship.pendingThresholds = queue.sort((a, b) => a.thresholdIndex - b.thresholdIndex);
    }
}

/** Update ship pending thresholds after hull damage is applied. */
export function applyHullDamageThreshold(
    ship: ShipThresholdState,
    dmgBefore: number,
    hullAdded: number
): void {
    if (hullAdded <= 0) return;
    const { hullBoxes, rows } = hullLayout(ship);
    const dmgAfter = Number(ship.dmgHull ?? 0) || 0;
    const crossing = thresholdsCrossed(hullBoxes, rows, dmgBefore, dmgAfter);
    if (crossing.thresholdsCrossed <= 0 || crossing.thresholdIndex <= 0) return;

    const resolved = ship.thresholdRowsResolved ?? 0;
    if (crossing.thresholdIndex <= resolved) return;

    let queue = pendingThresholdList(ship);

    if (crossing.thresholdsCrossed > 1) {
        const entry: PendingThreshold = {
            failOnOrAbove: crossing.failOnOrAbove,
            rollBonus: crossing.rollBonus,
            thresholdIndex: crossing.thresholdIndex,
            crossedRows: crossing.thresholdsCrossed,
        };
        const idx = queue.findIndex((q) => q.thresholdIndex === crossing.thresholdIndex);
        if (idx >= 0) queue[idx] = entry;
        else queue.push(entry);
    } else if (
        !queue.some((q) => q.thresholdIndex === crossing.thresholdIndex) &&
        crossing.thresholdIndex > resolved
    ) {
        queue.push({
            failOnOrAbove: crossing.failOnOrAbove,
            rollBonus: crossing.rollBonus,
            thresholdIndex: crossing.thresholdIndex,
            crossedRows: crossing.thresholdsCrossed,
        });
    }

    setPendingThresholdList(ship, queue);
}

export function clearPendingThreshold(ship: ShipThresholdState, thresholdIndex?: number): void {
    const queue = pendingThresholdList(ship);
    if (!queue.length) return;

    if (thresholdIndex !== undefined) {
        const resolved = ship.thresholdRowsResolved ?? 0;
        ship.thresholdRowsResolved = Math.max(resolved, thresholdIndex);
        setPendingThresholdList(
            ship,
            queue.filter((q) => q.thresholdIndex !== thresholdIndex)
        );
        return;
    }

    const first = queue[0];
    ship.thresholdRowsResolved = first.thresholdIndex;
    setPendingThresholdList(ship, queue.slice(1));
}

export function shipsHavePendingThresholds(position: FullThrustGamePosition): boolean {
    for (const obj of position.objects ?? []) {
        if (obj.objType !== "ship") continue;
        if (pendingThresholdList(obj as ShipThresholdState).length > 0) return true;
    }
    return false;
}

export { coreSystemsInThresholdEnabled };
export type { GameMeta };
