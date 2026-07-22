/** Optional Core Systems / reactor helpers (phase 15). */

import type { FullThrustGameCommand } from "@/schemas/commands";
import type { FullThrustGamePosition } from "@/schemas/position";
import type { GameMeta } from "./types";
import { coreSystemsInThresholdEnabled, reactorBreachesEnabled } from "./types";
import { formatReactorResultNotes, makeLogDice } from "./rollResults";
import type { RollSource } from "./dice";
import { arrayRollSource, chainedRollSource } from "./dice";
import { resolveReactorBreachBlast, shipMass } from "./reactorBreach";

export interface CoreState {
    powerless?: boolean;
    /** Turns until life support fails. */
    lifeless?: number;
    /** Turns remaining out of control. */
    uncontrolled?: number;
    /** Reactor dumped — no explosion rolls. */
    dumped?: boolean;
    /** Turn when crew abandoned ship; lowers explosion threshold each phase 15. */
    abandonedSinceTurn?: number;
}

export interface ReactorCheckResult {
    exploded: boolean;
    roll: number;
    skipped: boolean;
    threshold: number;
}

export function shipIsAbandoned(core?: CoreState): boolean {
    return core?.abandonedSinceTurn !== undefined;
}

/** Base explode-on 5; abandoned ships drop by 1 per turn since abandon (floor 2). */
export function reactorExplosionThreshold(
    core: CoreState | undefined,
    currentTurn: number
): number {
    const base = 5;
    if (core?.abandonedSinceTurn === undefined) return base;
    const turnsAbandoned = currentTurn - core.abandonedSinceTurn;
    return Math.max(2, base - turnsAbandoned);
}

export function resolveReactorExplosion(
    roll: number,
    core?: CoreState,
    currentTurn = 1
): ReactorCheckResult {
    if (!core?.powerless || core.dumped) {
        return { exploded: false, roll: 0, skipped: true, threshold: 5 };
    }
    const r = Math.max(1, Math.min(6, Math.round(roll)));
    const threshold = reactorExplosionThreshold(core, currentTurn);
    return { exploded: r >= threshold, roll: r, skipped: false, threshold };
}

/** Decrement turn-based core countdowns (call on turn wrap 14→0). */
export function tickCoreState(state: CoreState | undefined): CoreState | undefined {
    if (!state) return undefined;
    const next: CoreState = { ...state };
    if (typeof next.uncontrolled === "number") {
        next.uncontrolled = Math.max(0, next.uncontrolled - 1);
        if (next.uncontrolled === 0) delete next.uncontrolled;
    }
    if (typeof next.lifeless === "number") {
        next.lifeless = Math.max(0, next.lifeless - 1);
    }
    return next;
}

export function mergeCoreState(
    current: CoreState | undefined,
    patch: CoreState
): CoreState {
    const next: CoreState = { ...(current ?? {}) };
    if (patch.powerless !== undefined) {
        if (patch.powerless) next.powerless = true;
        else {
            delete next.powerless;
            delete next.abandonedSinceTurn;
        }
    }
    if (patch.lifeless !== undefined) {
        if (patch.lifeless < 0) delete next.lifeless;
        else next.lifeless = patch.lifeless;
    }
    if (patch.uncontrolled !== undefined) {
        if (patch.uncontrolled < 0) delete next.uncontrolled;
        else next.uncontrolled = patch.uncontrolled;
    }
    if (patch.dumped !== undefined) {
        if (patch.dumped) next.dumped = true;
        else delete next.dumped;
    }
    if (patch.abandonedSinceTurn !== undefined) {
        if (patch.abandonedSinceTurn < 0) delete next.abandonedSinceTurn;
        else next.abandonedSinceTurn = patch.abandonedSinceTurn;
    }
    return next;
}

export function coreSystemsEnabled(meta: GameMeta): boolean {
    return coreSystemsInThresholdEnabled(meta);
}

/** ftLibShip SSD ids for knocked-out core systems (bridge / life / reactor). */
export type CoreRenderId = "_coreBridge" | "_coreLife" | "_corePower";

export function coreDisabledRenderIds(core?: CoreState): CoreRenderId[] {
    if (!core) return [];
    const ids: CoreRenderId[] = [];
    if ((core.uncontrolled ?? 0) > 0) ids.push("_coreBridge");
    if ((core.lifeless ?? 0) > 0) ids.push("_coreLife");
    if (core.powerless) ids.push("_corePower");
    return ids;
}

/** Unstable reactor awaiting end-of-turn explosion roll (damaged, not dumped). */
export function shipHasUnstableReactor(ship: { coreState?: CoreState }): boolean {
    const cs = ship.coreState;
    return !!(cs?.powerless && !cs?.dumped);
}

export function shipsNeedingReactorRoll(
    position: FullThrustGamePosition,
    meta: GameMeta
): string[] {
    if (!coreSystemsEnabled(meta)) return [];
    return (position.objects ?? [])
        .filter((o) => o.objType === "ship" && shipHasUnstableReactor(o as { coreState?: CoreState }))
        .map((o) => o.id)
        .sort();
}

export function reactorDiceCount(position: FullThrustGamePosition, meta: GameMeta): number {
    return shipsNeedingReactorRoll(position, meta).length;
}

export function buildReactorResolveCommands(
    position: FullThrustGamePosition,
    meta: GameMeta,
    reactorRolls: number[],
    extraDice?: RollSource
): FullThrustGameCommand[] {
    const shipIds = shipsNeedingReactorRoll(position, meta);
    const source = extraDice
        ? chainedRollSource(reactorRolls, extraDice)
        : arrayRollSource(reactorRolls);
    const cmds: FullThrustGameCommand[] = [];
    const recordedRolls: number[] = [];
    const pendingLogged = new Set<string>();

    for (const shipId of shipIds) {
        const ship = position.objects?.find((o) => o.objType === "ship" && o.id === shipId) as
            | ({ coreState?: CoreState } & { object?: { mass?: number }; mass?: number })
            | undefined;
        const roll = source.next();
        recordedRolls.push(roll);
        const result = resolveReactorExplosion(roll, ship?.coreState, meta.turn);
        const notes = formatReactorResultNotes(
            shipId,
            roll,
            result.exploded,
            result.skipped,
            result.threshold
        );
        cmds.push(
            makeLogDice({
                purpose: `reactor ${shipId}`,
                rolls: [roll],
                source: "moderatorSequence",
                result: notes,
            })
        );
        if (!result.skipped) {
            cmds.push({ name: "_custom", msg: notes } as FullThrustGameCommand);
            if (result.exploded && ship) {
                const mass = shipMass(ship);
                if (reactorBreachesEnabled(meta)) {
                    const breach = resolveReactorBreachBlast(
                        position,
                        shipId,
                        mass,
                        source,
                        meta
                    );
                    cmds.push(...breach.commands);
                    for (const id of breach.pendingThresholdShips) {
                        if (!pendingLogged.has(id)) {
                            pendingLogged.add(id);
                            cmds.push({
                                name: "_custom",
                                msg: `Threshold pending for ${id} (reactor breach) — resolve in phase 13`,
                            } as FullThrustGameCommand);
                        }
                    }
                }
                cmds.push({ name: "objDestroy", uuid: shipId } as FullThrustGameCommand);
            }
        }
    }

    cmds.push({
        name: "resolveReactorBreaches",
        rolls: recordedRolls,
        shipIds,
    } as FullThrustGameCommand);

    return cmds;
}
