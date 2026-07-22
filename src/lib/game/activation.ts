import type { FullThrustGamePosition } from "@/schemas/position";
import type { ActivationCursor, GamePhase, InitiativeState } from "./types";
import { activationOrder } from "./phase";
import {
    listShipSystems,
    isSystemDestroyed,
    shipHasOperationalWeapons,
    type ShipGameState,
} from "./shipSystems";
import { contestedShipsForPhase12 } from "./boardingState";
import { shipsNeedingRepairOrders } from "./repairSystems";
import { listLaunchableSystems } from "./ordnanceLaunch";
import { multistageNeedingOrders } from "./ordnanceLaunch";
import { launchableWings } from "@/lib/hangars";
import { phase7HasAllocationContent } from "./ordnanceAllocation";
import { fighterAttackAllocationsFromPosition } from "./fighterEngagement";
import { furballWorkNeeded } from "./fighterPhase8";

function shipHasLaunchableOrdnance(ship: ShipGameState): boolean {
    return listLaunchableSystems(ship).length > 0;
}

export function shipHasLaunchableFighters(
    ship: ShipGameState,
    position: FullThrustGamePosition
): boolean {
    return launchableWings(ship, position).length > 0;
}

export function shipCanLaunchInPhase3(
    ship: ShipGameState,
    position: FullThrustGamePosition
): boolean {
    return shipHasLaunchableOrdnance(ship) || shipHasLaunchableFighters(ship, position);
}

export function shipCanFire(ship: ShipGameState): boolean {
    return shipHasOperationalWeapons(ship);
}

function ownerOf(
    position: FullThrustGamePosition,
    id: string
): string | undefined {
    const obj = position.objects?.find((o) => o.id === id);
    if (!obj) return undefined;
    if ("owner" in obj && typeof obj.owner === "string") return obj.owner;
    return undefined;
}

/**
 * Build alternating ship/group activation queue for segmented phases.
 * Loser-first for phases 3–4; winner-first for phase 11.
 */
export function buildActivationQueue(
    phase: GamePhase,
    position: FullThrustGamePosition,
    playerIds: string[],
    initiative: InitiativeState | undefined,
    turn = 1
): string[] {
    const order = activationOrder(playerIds, initiative, phase);
    if (order.length === 0) return [];

    let candidates: { id: string; owner: string }[] = [];

    if (phase === 3) {
        for (const obj of position.objects ?? []) {
            if (obj.objType !== "ship" || !obj.owner || !obj.position) continue;
            const ship = obj as ShipGameState;
            if (shipCanLaunchInPhase3(ship, position)) {
                candidates.push({ id: obj.id, owner: obj.owner });
            }
        }
        for (const msId of multistageNeedingOrders(position, turn)) {
            const ord = position.objects?.find((o) => o.id === msId);
            if (ord?.owner) {
                candidates.push({ id: msId, owner: ord.owner });
            }
        }
    } else if (phase === 4) {
        for (const obj of position.objects ?? []) {
            if (obj.objType !== "fighters" || !obj.owner) continue;
            const pos = obj.position;
            if (!pos || typeof pos !== "object" || !("x" in pos)) continue;
            candidates.push({ id: obj.id, owner: obj.owner });
        }
    } else if (phase === 11) {
        for (const obj of position.objects ?? []) {
            if (obj.objType !== "ship" || !obj.owner || !obj.position) continue;
            if (shipCanFire(obj as ShipGameState)) {
                candidates.push({ id: obj.id, owner: obj.owner });
            }
        }
    } else if (phase === 12) {
        return contestedShipsForPhase12(position);
    }

    if (candidates.length === 0) return [];

    const byOwner = new Map<string, string[]>();
    for (const c of candidates) {
        if (!byOwner.has(c.owner)) byOwner.set(c.owner, []);
        byOwner.get(c.owner)!.push(c.id);
    }
    for (const ids of byOwner.values()) ids.sort();

    const queue: string[] = [];
    const counts = new Map(order.map((p) => [p, byOwner.get(p)?.length ?? 0]));
    const maxRounds = Math.max(...counts.values(), 0);

    for (let round = 0; round < maxRounds; round++) {
        for (const player of order) {
            const ids = byOwner.get(player);
            if (ids && ids.length > round) {
                queue.push(ids[round]);
            }
        }
    }
    return queue;
}

export function freshActivationCursor(queue: string[]): ActivationCursor {
    return { queue, index: 0 };
}

export function initSegmentMetaForPhase(
    phase: GamePhase,
    position: FullThrustGamePosition,
    playerIds: string[],
    initiative: InitiativeState | undefined,
    turn = 1
): { segment: "orders"; activation: ActivationCursor } | undefined {
    if (phase === 14) {
        if (shipsNeedingRepairOrders(position).length === 0) return undefined;
        return { segment: "orders", activation: freshActivationCursor([]) };
    }
    if (phase === 7) {
        if (!phase7HasAllocationContent(position)) return undefined;
        return { segment: "orders", activation: freshActivationCursor([]) };
    }
    if (phase === 8) {
        const allocations = fighterAttackAllocationsFromPosition(position, turn);
        if (!furballWorkNeeded(position, allocations)) return undefined;
        return { segment: "orders", activation: freshActivationCursor([]) };
    }
    if (phase === 9) {
        return { segment: "orders", activation: freshActivationCursor([]) };
    }
    const queue = buildActivationQueue(phase, position, playerIds, initiative, turn);
    if (queue.length === 0) return undefined;
    return { segment: "orders", activation: freshActivationCursor(queue) };
}
