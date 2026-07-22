/** Fold-state helpers for dual-use mounts, EMP banking, and transporter delivery. */

import type { FullThrustGameCommand } from "@/schemas/commands";
import type { FoldState } from "./applyCommand";
import { bankEmpHitsOnTarget, type BankedEmpState } from "./empFire";
import { decodeFireDeclarationNotes } from "./resolveCombat";

export interface PendingTransporterDelivery {
    firerShipId: string;
    targetShipId: string;
    weaponId: string;
    /** Remaining delivery slots (one per transporter beam hit). */
    remaining: number;
}

export function markWeaponUsed(
    fold: FoldState,
    weaponId: string,
    usage: "pds" | "shipFire"
): Record<string, "pds" | "shipFire"> {
    return { ...(fold.weaponUsedThisTurn ?? {}), [weaponId]: usage };
}

export function weaponsFromFireDeclarations(
    declarations: FullThrustGameCommand[],
    shipId: string
): string[] {
    const ids: string[] = [];
    for (const decl of declarations) {
        if (decl.name !== "declareShipFire") continue;
        const c = decl as { ship?: string; weapon?: string };
        if (c.ship !== shipId || !c.weapon) continue;
        ids.push(c.weapon);
    }
    return ids;
}

export function applyBankEmpHitsCommand(
    state: BankedEmpState | undefined,
    cmd: {
        targetShip?: string;
        firerShip?: string;
        weapon?: string;
        hits?: number;
    }
): BankedEmpState {
    const hits = Number(cmd.hits ?? 0);
    if (!cmd.targetShip || !cmd.firerShip || !cmd.weapon || hits <= 0) {
        return state ?? {};
    }
    return bankEmpHitsOnTarget(state, cmd.targetShip, cmd.firerShip, cmd.weapon, hits);
}

export function queueTransporterDelivery(
    existing: PendingTransporterDelivery[] | undefined,
    firerShipId: string,
    targetShipId: string,
    weaponId: string,
    hits: number
): PendingTransporterDelivery[] {
    if (hits <= 0) return existing ?? [];
    const list = [...(existing ?? [])];
    const idx = list.findIndex(
        (p) =>
            p.firerShipId === firerShipId &&
            p.targetShipId === targetShipId &&
            p.weaponId === weaponId
    );
    if (idx >= 0) {
        list[idx] = { ...list[idx], remaining: list[idx].remaining + hits };
    } else {
        list.push({ firerShipId, targetShipId, weaponId, remaining: hits });
    }
    return list;
}

export function consumeTransporterDeliverySlot(
    existing: PendingTransporterDelivery[] | undefined,
    firerShipId: string,
    targetShipId: string,
    weaponId: string
): { remaining: PendingTransporterDelivery[]; hadSlot: boolean } {
    const list = [...(existing ?? [])];
    const idx = list.findIndex(
        (p) =>
            p.firerShipId === firerShipId &&
            p.targetShipId === targetShipId &&
            p.weaponId === weaponId &&
            p.remaining > 0
    );
    if (idx < 0) return { remaining: list, hadSlot: false };
    const entry = list[idx];
    if (entry.remaining <= 1) {
        list.splice(idx, 1);
    } else {
        list[idx] = { ...entry, remaining: entry.remaining - 1 };
    }
    return { remaining: list, hadSlot: true };
}

export function totalPendingTransporterSlots(
    pending: PendingTransporterDelivery[] | undefined
): number {
    return (pending ?? []).reduce((sum, p) => sum + p.remaining, 0);
}

export function pendingForFirer(
    pending: PendingTransporterDelivery[] | undefined,
    firerShipId: string
): PendingTransporterDelivery[] {
    return (pending ?? []).filter((p) => p.firerShipId === firerShipId && p.remaining > 0);
}

export function hasPendingTransporterDeliveries(
    pending: PendingTransporterDelivery[] | undefined
): boolean {
    return totalPendingTransporterSlots(pending) > 0;
}

export function pendingTransporterSummary(
    pending: PendingTransporterDelivery[] | undefined
): string[] {
    return (pending ?? [])
        .filter((p) => p.remaining > 0)
        .map(
            (p) =>
                `${p.firerShipId} → ${p.targetShipId} (${p.remaining} slot${p.remaining === 1 ? "" : "s"})`
        );
}

export function assertNoPendingTransporterDeliveries(
    pending: PendingTransporterDelivery[] | undefined
): void {
    const lines = pendingTransporterSummary(pending);
    if (lines.length) {
        throw new Error(
            `Transporter delivery pending — declare delivery before advancing: ${lines.join("; ")}`
        );
    }
}

export function profileFromDeclaration(decl: FullThrustGameCommand): string {
    const notes = (decl as { notes?: string }).notes;
    return decodeFireDeclarationNotes(notes).profile ?? "beam";
}
