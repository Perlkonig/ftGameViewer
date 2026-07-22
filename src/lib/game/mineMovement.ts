/** Phase 5 mine laying, sweeping, and detonation helpers. */

import type { FullThrustGameCommand } from "@/schemas/commands";
import type { FullThrustGamePosition } from "@/schemas/position";
import type { GameMeta } from "@/lib/game/types";
import type { Point } from "@/lib/game/movement";
import { distance } from "@/lib/game/movement";
import {
    applyResolvedMovePatch,
    pendingMoveForShip,
    resolveMoveFromOrder,
} from "@/lib/game/movementResolve";
import { consumeAmmunitionPatch } from "@/lib/ammunition";
import {
    listShipSystems,
    isSystemDestroyed,
    type ShipGameState,
} from "@/lib/game/shipSystems";
import {
    beamDicePool,
    resolveBeamDieSplit,
    type ScreenLevel,
} from "@/lib/game/combat";
import {
    computeShipDamageApplication,
    pushHullDamageCommands,
} from "@/lib/game/resolveCombat";
import { shipDestroyedByHullDamage } from "@/lib/game/thresholds";
import {
    formatMineDetonationResultNotes,
    formatMineSweepDetonationResultNotes,
    formatMineSweepResultNotes,
    makeLogDice,
} from "@/lib/game/rollResults";
import type { RollSource } from "@/lib/game/dice";
import {
    syncFightersAttachedTo,
    syncAllAttachedFighters,
} from "@/lib/game/fighterAttachment";

export const MINE_DETECTION_MU = 3;
export const PATH_SNAP_TOLERANCE_MU = 0.25;

type ShipObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "ship" }
>;
type MineObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "ordnance"; type: "mine" }
>;

export interface MinePlacementNeed {
    shipId: string;
    systemId: string;
}

export interface ResolvedShipMove {
    shipId: string;
    path: Point[];
    sweepForMines: boolean;
}

export interface SweepEvent {
    shipId: string;
    mineId: string;
}

export interface DetonationEvent {
    mineId: string;
    targetShipId: string;
    beamClass: number;
}

function shipPoint(ship: ShipObj): Point {
    const p = ship.position;
    if (!p || typeof p !== "object" || !("x" in p)) return { x: 0, y: 0 };
    return { x: Number(p.x), y: Number(p.y) };
}

function moveShipCmd(
    cmd: FullThrustGameCommand
): cmd is FullThrustGameCommand & {
    id: string;
    sweepForMines?: boolean;
    deployMineLayers?: string[];
} {
    return cmd.name === "moveShip" && typeof (cmd as { id?: string }).id === "string";
}

function layMineCmd(
    cmd: FullThrustGameCommand
): cmd is FullThrustGameCommand & {
    ship: string;
    systemId: string;
    position: Point;
    id?: string;
} {
    return (
        cmd.name === "layMine" &&
        typeof (cmd as { ship?: string }).ship === "string" &&
        typeof (cmd as { systemId?: string }).systemId === "string" &&
        !!(cmd as { position?: Point }).position
    );
}

/** Stable ordnance id for a laid mine (replay-safe; matches layMine command id when set). */
export function mineOrdnanceId(
    lay: { ship: string; systemId: string; position: Point },
    turn: number
): string {
    const x = lay.position.x.toFixed(2);
    const y = lay.position.y.toFixed(2);
    return `mine_${lay.ship}_${lay.systemId}_t${turn}_${x}_${y}`;
}

export function declaredMineLayersFromPending(
    pendingMoves: FullThrustGameCommand[] | undefined,
    shipId: string
): string[] {
    const cmd = pendingMoveForShip(pendingMoves, shipId) as
        | (FullThrustGameCommand & { deployMineLayers?: string[] })
        | undefined;
    return [...(cmd?.deployMineLayers ?? [])];
}

export function shipsNeedingMinePlacements(
    pendingMoves: FullThrustGameCommand[] | undefined,
    pendingLayMines: FullThrustGameCommand[] | undefined
): MinePlacementNeed[] {
    const needs: MinePlacementNeed[] = [];
    for (const cmd of pendingMoves ?? []) {
        if (!moveShipCmd(cmd)) continue;
        for (const systemId of cmd.deployMineLayers ?? []) {
            const laid = (pendingLayMines ?? []).some(
                (l) =>
                    layMineCmd(l) &&
                    l.ship === cmd.id &&
                    l.systemId === systemId
            );
            if (!laid) needs.push({ shipId: cmd.id, systemId });
        }
    }
    return needs;
}

export function mineLaysComplete(
    pendingMoves: FullThrustGameCommand[] | undefined,
    pendingLayMines: FullThrustGameCommand[] | undefined
): boolean {
    return shipsNeedingMinePlacements(pendingMoves, pendingLayMines).length === 0;
}

function segmentPointDistance(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    px: number,
    py: number
): number {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return distance({ x: ax, y: ay }, { x: px, y: py });
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    return distance({ x: px, y: py }, { x: cx, y: cy });
}

export function distancePointToPath(path: Point[], point: Point): number {
    if (path.length === 0) return Infinity;
    if (path.length === 1) return distance(path[0], point);
    let min = Infinity;
    for (let i = 0; i < path.length - 1; i++) {
        const a = path[i];
        const b = path[i + 1];
        min = Math.min(
            min,
            segmentPointDistance(a.x, a.y, b.x, b.y, point.x, point.y)
        );
    }
    return min;
}

export function pathWithinMu(path: Point[], point: Point, radius: number): boolean {
    return distancePointToPath(path, point) <= radius + 1e-6;
}

export function nearestPointOnPath(path: Point[], point: Point): Point {
    if (path.length === 0) return point;
    if (path.length === 1) return { ...path[0] };
    let best = { ...path[0] };
    let min = Infinity;
    for (let i = 0; i < path.length - 1; i++) {
        const a = path[i];
        const b = path[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lenSq = dx * dx + dy * dy;
        let t = 0;
        if (lenSq > 0) {
            t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq;
            t = Math.max(0, Math.min(1, t));
        }
        const cx = a.x + t * dx;
        const cy = a.y + t * dy;
        const d = distance(point, { x: cx, y: cy });
        if (d < min) {
            min = d;
            best = { x: cx, y: cy };
        }
    }
    return best;
}

export function pointOnPathAtFraction(path: Point[], fraction: number): Point {
    if (path.length === 0) return { x: 0, y: 0 };
    if (path.length === 1) return { ...path[0] };
    const segments: { a: Point; b: Point; len: number }[] = [];
    let total = 0;
    for (let i = 0; i < path.length - 1; i++) {
        const len = distance(path[i], path[i + 1]);
        segments.push({ a: path[i], b: path[i + 1], len });
        total += len;
    }
    if (total <= 0) return { ...path[0] };
    let target = Math.max(0, Math.min(1, fraction)) * total;
    for (const seg of segments) {
        if (target <= seg.len) {
            const t = seg.len > 0 ? target / seg.len : 0;
            return {
                x: seg.a.x + (seg.b.x - seg.a.x) * t,
                y: seg.a.y + (seg.b.y - seg.a.y) * t,
            };
        }
        target -= seg.len;
    }
    return { ...path[path.length - 1] };
}

export function previewPathForPendingShip(
    ship: ShipGameState,
    pendingMoves: FullThrustGameCommand[] | undefined
): Point[] {
    const cmd = pendingMoveForShip(pendingMoves, ship.id);
    return resolveMoveFromOrder(ship, cmd).path;
}

function isActiveMine(mine: MineObj, meta: GameMeta): boolean {
    const turn = mine.deployedTurn;
    if (turn === undefined) return true;
    return turn < meta.turn;
}

function listMines(position: FullThrustGamePosition): MineObj[] {
    return (position.objects ?? []).filter(
        (o): o is MineObj => o.objType === "ordnance" && o.type === "mine"
    );
}

function shipScreens(ship: ShipObj): ScreenLevel {
    let level: ScreenLevel = 0;
    for (const sys of listShipSystems(ship as ShipGameState)) {
        if ((sys.name ?? "") !== "screen") continue;
        if (isSystemDestroyed(ship as ShipGameState, sys.id)) continue;
        if ((sys as { area?: boolean }).area) level = 2;
        else if (level < 1) level = 1;
    }
    return level;
}

const MINE_DETONATION_DICE = 4;

function resolveMineBeamDamage(
    ship: ShipObj,
    source: RollSource
): { normal: number; penetrating: number } {
    const screens = shipScreens(ship);
    let normal = 0;
    let penetrating = 0;
    for (let i = 0; i < MINE_DETONATION_DICE; i++) {
        const { result } = resolveBeamDieSplit(source, screens);
        normal += result.normalDamage;
        penetrating += result.penetratingDamage;
    }
    return { normal, penetrating };
}

export function collectSweepEvents(
    moves: ResolvedShipMove[],
    position: FullThrustGamePosition
): SweepEvent[] {
    const mines = listMines(position);
    const events: SweepEvent[] = [];
    const seen = new Set<string>();
    for (const move of moves) {
        if (!move.sweepForMines) continue;
        for (const mine of mines) {
            const mpos = mine.position as Point;
            if (!mpos || !("x" in mpos)) continue;
            if (!pathWithinMu(move.path, mpos, MINE_DETECTION_MU)) continue;
            const key = `${move.shipId}:${mine.id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            events.push({ shipId: move.shipId, mineId: mine.id });
        }
    }
    return events;
}

export function collectDetonationEvents(
    moves: ResolvedShipMove[],
    position: FullThrustGamePosition,
    meta: GameMeta
): DetonationEvent[] {
    const mines = listMines(position).filter((m) => isActiveMine(m, meta));
    const events: DetonationEvent[] = [];
    const seen = new Set<string>();
    for (const move of moves) {
        const ship = position.objects?.find(
            (o) => o.objType === "ship" && o.id === move.shipId
        ) as ShipObj | undefined;
        if (!ship) continue;
        for (const mine of mines) {
            if (mine.owner === ship.owner) continue;
            const mpos = mine.position as Point;
            if (!mpos || !("x" in mpos)) continue;
            if (!pathWithinMu(move.path, mpos, MINE_DETECTION_MU)) continue;
            const key = `${mine.id}:${move.shipId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            events.push({
                mineId: mine.id,
                targetShipId: move.shipId,
                beamClass: mine.beamClass ?? 1,
            });
        }
    }
    return events;
}

export function minePhaseDiceCount(
    moves: ResolvedShipMove[],
    position: FullThrustGamePosition,
    meta: GameMeta
): { sweeps: number; detonations: number; total: number } {
    const sweeps = collectSweepEvents(moves, position).length;
    const dets = collectDetonationEvents(moves, position, meta).length;
    return {
        sweeps,
        detonations: dets * MINE_DETONATION_DICE,
        total: sweeps + dets * MINE_DETONATION_DICE,
    };
}

export interface Phase5MovementResult {
    position: FullThrustGamePosition;
    moves: ResolvedShipMove[];
    warnings: string[];
}

export function resolvePhase5MovementSequence(
    position: FullThrustGamePosition,
    meta: GameMeta,
    pendingMoves: FullThrustGameCommand[] | undefined,
    pendingLayMines: FullThrustGameCommand[] | undefined
): Phase5MovementResult {
    const next = structuredClone(position) as FullThrustGamePosition;
    const warnings: string[] = [];
    const moves: ResolvedShipMove[] = [];

    const pendingById = new Map<string, FullThrustGameCommand>();
    for (const cmd of pendingMoves ?? []) {
        if (moveShipCmd(cmd)) pendingById.set(cmd.id, cmd);
    }

    const minelayerIds = new Set<string>();
    for (const cmd of pendingMoves ?? []) {
        if (moveShipCmd(cmd) && (cmd.deployMineLayers?.length ?? 0) > 0) {
            minelayerIds.add(cmd.id);
        }
    }

    const shipIds = (next.objects ?? [])
        .filter((o) => o.objType === "ship" && o.position != null)
        .map((o) => o.id);

    const orderedIds = [
        ...shipIds.filter((id) => minelayerIds.has(id)),
        ...shipIds.filter((id) => !minelayerIds.has(id)),
    ];

    for (const shipId of orderedIds) {
        const obj = next.objects?.find((o) => o.id === shipId);
        if (!obj || obj.objType !== "ship") continue;
        const ship = obj as ShipObj;
        const cmd = pendingById.get(shipId);
        const patch = resolveMoveFromOrder(ship as ShipGameState, cmd);
        warnings.push(...patch.warnings);
        const sweepForMines = !!(cmd as { sweepForMines?: boolean })?.sweepForMines;
        moves.push({ shipId, path: patch.path, sweepForMines });
        applyResolvedMovePatch(ship, patch);
        syncFightersAttachedTo(next, shipId, "ship");
        if (sweepForMines) {
            (ship as ShipObj & { movementFlags?: { sweepForMines?: boolean } }).movementFlags =
                { sweepForMines: true };
        } else {
            delete (ship as ShipObj & { movementFlags?: unknown }).movementFlags;
        }
    }

    syncAllAttachedFighters(next);

    for (const lay of pendingLayMines ?? []) {
        if (!layMineCmd(lay)) continue;
        const ship = next.objects?.find(
            (o) => o.objType === "ship" && o.id === lay.ship
        ) as ShipObj | undefined;
        if (!ship) {
            warnings.push(`layMine: ship not found ${lay.ship}`);
            continue;
        }
        const id =
            typeof lay.id === "string" && lay.id.trim()
                ? lay.id
                : mineOrdnanceId(lay, meta.turn);
        if (!next.objects) next.objects = [];
        if (next.objects.some((o) => o.id === id)) {
            warnings.push(`layMine: mine already exists at id ${id}`);
            continue;
        }
        next.objects.push({
            objType: "ordnance",
            id,
            owner: ship.owner,
            type: "mine",
            position: lay.position,
            range: MINE_DETECTION_MU,
            deployedTurn: meta.turn,
            beamClass: 1,
        } as MineObj);
        ship.ammo = consumeAmmunitionPatch(ship as ShipGameState, lay.systemId);
    }

    return { position: next, moves, warnings };
}

export function extractMinePhaseLogLines(cmds: FullThrustGameCommand[]): string[] {
    return cmds
        .filter((c) => c.name === "logDice")
        .map((c) => {
            const purpose = (c as { purpose?: string }).purpose ?? "resolveMinePhase";
            const result = (c as { result?: string }).result ?? "";
            const label = purpose.replace(/^resolveMinePhase:\s*/, "");
            return result ? `${label} — ${result}` : label;
        });
}

export function buildMinePhaseResolveCommands(
    position: FullThrustGamePosition,
    meta: GameMeta,
    moves: ResolvedShipMove[],
    source: RollSource
): { cmds: FullThrustGameCommand[]; warnings: string[] } {
    const cmds: FullThrustGameCommand[] = [];
    const warnings: string[] = [];
    const sweepEvents = collectSweepEvents(moves, position);
    const detEvents = collectDetonationEvents(moves, position, meta);

    for (const ev of sweepEvents) {
        const eventMark = source.mark();
        const roll = source.next();
        const purpose = `resolveMinePhase: sweep ${ev.shipId} → mine ${ev.mineId}`;

        if (roll === 1) {
            const mine = position.objects?.find((o) => o.id === ev.mineId) as MineObj | undefined;
            const ship = position.objects?.find(
                (o) => o.objType === "ship" && o.id === ev.shipId
            ) as ShipObj | undefined;
            if (mine && ship) {
                const { normal, penetrating } = resolveMineBeamDamage(ship, source);
                const total = normal + penetrating;
                const applied = computeShipDamageApplication(
                    ship,
                    normal,
                    penetrating,
                    "standard"
                );
                const destroyed = applied
                    ? shipDestroyedByHullDamage(ship, applied.hullDamage)
                    : false;
                cmds.push(
                    makeLogDice({
                        purpose,
                        rolls: source.consumedSince(eventMark),
                        source: "moderatorSequence",
                        result: formatMineSweepDetonationResultNotes(
                            ev.mineId,
                            ev.shipId,
                            roll,
                            total,
                            applied,
                            destroyed
                        ),
                    })
                );
                pushHullDamageCommands(cmds, ev.shipId, ship, normal, penetrating, "standard");
                cmds.push({
                    name: "objDestroy",
                    uuid: ev.mineId,
                } as FullThrustGameCommand);
                warnings.push(
                    `Mine ${ev.mineId} detonated on sweeper ${ev.shipId} (roll 1).`
                );
            } else {
                cmds.push(
                    makeLogDice({
                        purpose,
                        rolls: source.consumedSince(eventMark),
                        source: "moderatorSequence",
                        result: formatMineSweepResultNotes(roll, ev.mineId, ev.shipId),
                    })
                );
            }
        } else if (roll >= 3) {
            cmds.push(
                makeLogDice({
                    purpose,
                    rolls: source.consumedSince(eventMark),
                    source: "moderatorSequence",
                    result: formatMineSweepResultNotes(roll, ev.mineId, ev.shipId),
                })
            );
            cmds.push({ name: "objDestroy", uuid: ev.mineId } as FullThrustGameCommand);
            warnings.push(`Mine ${ev.mineId} disabled by ${ev.shipId} (roll ${roll}).`);
        } else {
            cmds.push(
                makeLogDice({
                    purpose,
                    rolls: source.consumedSince(eventMark),
                    source: "moderatorSequence",
                    result: formatMineSweepResultNotes(roll, ev.mineId, ev.shipId),
                })
            );
            warnings.push(`Mine ${ev.mineId} unaffected by sweep from ${ev.shipId} (roll 2).`);
        }
    }

    for (const ev of detEvents) {
        const ship = position.objects?.find(
            (o) => o.objType === "ship" && o.id === ev.targetShipId
        ) as ShipObj | undefined;
        if (!ship) continue;
        const eventMark = source.mark();
        const { normal, penetrating } = resolveMineBeamDamage(ship, source);
        const total = normal + penetrating;
        const applied = computeShipDamageApplication(ship, normal, penetrating, "standard");
        const destroyed = applied ? shipDestroyedByHullDamage(ship, applied.hullDamage) : false;
        const result = formatMineDetonationResultNotes(
            ev.mineId,
            ev.targetShipId,
            total,
            applied,
            destroyed
        );
        cmds.push(
            makeLogDice({
                purpose: `resolveMinePhase: mine ${ev.mineId} → ${ev.targetShipId}`,
                rolls: source.consumedSince(eventMark),
                source: "moderatorSequence",
                result,
            })
        );
        pushHullDamageCommands(cmds, ev.targetShipId, ship, normal, penetrating, "standard");
        cmds.push({ name: "objDestroy", uuid: ev.mineId } as FullThrustGameCommand);
        if (total > 0) {
            warnings.push(result);
        }
    }

    return { cmds, warnings };
}

/** Store resolved moves on meta for dice step (ephemeral via command log replay). */
export interface StoredPhase5Moves {
    moves: ResolvedShipMove[];
}

export function encodePhase5Moves(moves: ResolvedShipMove[]): string {
    return JSON.stringify({ moves });
}

export function decodePhase5Moves(notes: string | undefined): ResolvedShipMove[] {
    if (!notes) return [];
    try {
        const parsed = JSON.parse(notes) as StoredPhase5Moves;
        return parsed.moves ?? [];
    } catch {
        return [];
    }
}
