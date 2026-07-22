/** Persistent enemy boarder state on defender ships (per-unit model). */

import type { FullThrustGamePosition } from "@/schemas/position";
import type { ShipGameState } from "./shipSystems";

export interface InvaderEntry {
    type: "marines" | "damageControl";
    owner?: number | string;
}

export interface BoarderUnit {
    id: string;
    type: "dcp" | "marine";
    owner: string;
    fromShip?: string;
    boardedTurn?: number;
    allocation?: "kill" | "raze";
    sourceMarineId?: string;
    sourceDcpId?: string;
    sourceBuiltinDcp?: boolean;
}

export interface ShipBoarders {
    units: BoarderUnit[];
}

export type ShipWithBoarders = ShipGameState & {
    owner?: string;
    dmgHull?: number;
    dmgArmour?: { standard?: number; regenerative?: number }[];
    boarders?: ShipBoarders;
};

let boarderIdCounter = 0;

export function nextBoarderUnitId(prefix = "brd"): string {
    boarderIdCounter += 1;
    return `${prefix}-${boarderIdCounter}`;
}

/** @internal test helper */
export function resetBoarderIdCounter(): void {
    boarderIdCounter = 0;
}

export function boarderUnitsOnShip(ship: ShipWithBoarders, owner?: string): BoarderUnit[] {
    const units = ship.boarders?.units ?? [];
    return owner ? units.filter((u) => u.owner === owner) : [...units];
}

export function findBoarderUnit(ship: ShipWithBoarders, unitId: string): BoarderUnit | undefined {
    return ship.boarders?.units?.find((u) => u.id === unitId);
}

export function shipHasBoarders(ship: ShipWithBoarders): boolean {
    return (ship.boarders?.units?.length ?? 0) > 0;
}

export function shipsWithBoarders(position: FullThrustGamePosition): string[] {
    const ids: string[] = [];
    for (const obj of position.objects ?? []) {
        if (obj.objType !== "ship") continue;
        if (shipHasBoarders(obj as ShipWithBoarders)) ids.push(obj.id);
    }
    return ids.sort();
}

export function contestedShipsForPhase12(position: FullThrustGamePosition): string[] {
    return shipsWithBoarders(position);
}

export function attackerOwnersOnShip(ship: ShipWithBoarders): string[] {
    return [...new Set(boarderUnitsOnShip(ship).map((u) => u.owner))].sort();
}

export function totalBoardersOnShip(
    ship: ShipWithBoarders,
    owner?: string
): { dcp: number; marines: number } {
    const units = boarderUnitsOnShip(ship, owner);
    return units.reduce(
        (acc, u) => {
            if (u.type === "dcp") acc.dcp += 1;
            else acc.marines += 1;
            return acc;
        },
        { dcp: 0, marines: 0 }
    );
}

export function boardersToInvaderEntries(ship: ShipWithBoarders): InvaderEntry[] {
    return boarderUnitsOnShip(ship).map((u) => ({
        type: u.type === "dcp" ? "damageControl" : "marines",
        owner: u.owner,
    }));
}

function ensureBoarders(ship: ShipWithBoarders): BoarderUnit[] {
    if (!ship.boarders) ship.boarders = { units: [] };
    if (!ship.boarders.units) ship.boarders.units = [];
    return ship.boarders.units;
}

export interface NewBoarderUnit {
    type: "dcp" | "marine";
    fromShip?: string;
    boardedTurn?: number;
    sourceMarineId?: string;
    sourceDcpId?: string;
    sourceBuiltinDcp?: boolean;
}

/** Add boarder units for one attacker owner. Returns created unit ids. */
export function addBoarderUnits(
    ship: ShipWithBoarders,
    owner: string,
    units: NewBoarderUnit[]
): string[] {
    const list = ensureBoarders(ship);
    const ids: string[] = [];
    for (const spec of units) {
        const id = nextBoarderUnitId();
        list.push({
            id,
            type: spec.type,
            owner,
            fromShip: spec.fromShip,
            boardedTurn: spec.boardedTurn,
            sourceMarineId: spec.sourceMarineId,
            sourceDcpId: spec.sourceDcpId,
            sourceBuiltinDcp: spec.sourceBuiltinDcp,
        });
        ids.push(id);
    }
    return ids;
}

/** Remove boarder units by id. Returns removed units. */
export function removeBoarderUnits(ship: ShipWithBoarders, unitIds: string[]): BoarderUnit[] {
    const ids = new Set(unitIds);
    const list = ship.boarders?.units ?? [];
    const removed = list.filter((u) => ids.has(u.id));
    const remaining = list.filter((u) => !ids.has(u.id));
    if (remaining.length === 0) {
        delete ship.boarders;
    } else if (ship.boarders) {
        ship.boarders.units = remaining;
    }
    return removed;
}

/** Remove N units of a type for an owner (FIFO). Returns removed units. */
export function removeBoarderUnitsByType(
    ship: ShipWithBoarders,
    owner: string,
    type: "dcp" | "marine",
    count: number
): BoarderUnit[] {
    const n = Math.max(0, Math.floor(count));
    if (n <= 0) return [];
    const victims = boarderUnitsOnShip(ship, owner).filter((u) => u.type === type).slice(0, n);
    return removeBoarderUnits(
        ship,
        victims.map((u) => u.id)
    );
}

/** Replace all units for an owner with the given type counts. */
export function setBoarderUnitsForOwner(
    ship: ShipWithBoarders,
    owner: string,
    counts: { dcp: number; marines: number; boardedTurn?: number; fromShip?: string }
): void {
    const existing = boarderUnitsOnShip(ship, owner);
    if (existing.length) {
        removeBoarderUnits(
            ship,
            existing.map((u) => u.id)
        );
    }
    const specs: NewBoarderUnit[] = [];
    const fromShip = counts.fromShip;
    const boardedTurn = counts.boardedTurn;
    for (let i = 0; i < Math.max(0, counts.dcp); i++) {
        specs.push({ type: "dcp", fromShip, boardedTurn });
    }
    for (let i = 0; i < Math.max(0, counts.marines); i++) {
        specs.push({ type: "marine", fromShip, boardedTurn });
    }
    if (specs.length) addBoarderUnits(ship, owner, specs);
}

/** Adjust unit counts for an owner (+/−). Positive adds anonymous units; negative removes FIFO. */
export function adjustBoarderUnits(
    ship: ShipWithBoarders,
    owner: string,
    delta: { dcp?: number; marines?: number; boardedTurn?: number; fromShip?: string },
    added?: NewBoarderUnit[]
): { added: BoarderUnit[]; removed: BoarderUnit[] } {
    const dcpDelta = Math.floor(delta.dcp ?? 0);
    const marineDelta = Math.floor(delta.marines ?? 0);
    const removed: BoarderUnit[] = [];
    if (dcpDelta < 0) removed.push(...removeBoarderUnitsByType(ship, owner, "dcp", -dcpDelta));
    if (marineDelta < 0) removed.push(...removeBoarderUnitsByType(ship, owner, "marine", -marineDelta));

    const created: BoarderUnit[] = [];
    if (added?.length) {
        const ids = addBoarderUnits(ship, owner, added);
        for (const id of ids) {
            const u = findBoarderUnit(ship, id);
            if (u) created.push(u);
        }
    } else {
        const specs: NewBoarderUnit[] = [];
        for (let i = 0; i < Math.max(0, dcpDelta); i++) {
            specs.push({
                type: "dcp",
                fromShip: delta.fromShip,
                boardedTurn: delta.boardedTurn,
            });
        }
        for (let i = 0; i < Math.max(0, marineDelta); i++) {
            specs.push({
                type: "marine",
                fromShip: delta.fromShip,
                boardedTurn: delta.boardedTurn,
            });
        }
        if (specs.length) {
            const ids = addBoarderUnits(ship, owner, specs);
            for (const id of ids) {
                const u = findBoarderUnit(ship, id);
                if (u) created.push(u);
            }
        }
    }
    return { added: created, removed };
}
