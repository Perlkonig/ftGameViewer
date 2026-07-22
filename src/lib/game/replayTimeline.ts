/** Replay scrubber: turn boundaries in the command log. */

import type { FullThrustGameCommand } from "@/schemas/commands";
import type { GameMeta } from "./types";
import { coerceGamePhase } from "./phase";

export type TurnReplayMarker = {
    turn: number;
    /** Last command index applied at the start of this turn (inclusive). -1 = before any command. */
    endCommandIndex: number;
};

function applyAdvancePhaseToMeta(meta: GameMeta, cmd: FullThrustGameCommand): GameMeta {
    if (cmd.name !== "advancePhase") return meta;
    const phase = coerceGamePhase((cmd as { phase?: number }).phase ?? 1);
    const prevPhase = coerceGamePhase(meta.phase);
    const wrapping = phase === 1 && prevPhase === 15;
    const next: GameMeta = { ...meta, phase };
    const explicitTurn = (cmd as { turn?: number }).turn;
    if (explicitTurn !== undefined) {
        next.turn = explicitTurn;
    } else if (wrapping) {
        next.turn = meta.turn + 1;
    }
    return next;
}

/** Turn start markers in command-index order (turn 1 first). */
export function turnReplayMarkers(
    initialMeta: GameMeta,
    commands: FullThrustGameCommand[]
): TurnReplayMarker[] {
    const markers: TurnReplayMarker[] = [
        { turn: initialMeta.turn ?? 1, endCommandIndex: -1 },
    ];
    let meta: GameMeta = { ...initialMeta };

    for (let i = 0; i < commands.length; i++) {
        const prevTurn = meta.turn ?? 1;
        meta = applyAdvancePhaseToMeta(meta, commands[i]);
        const turn = meta.turn ?? 1;
        if (turn !== prevTurn) {
            const last = markers[markers.length - 1];
            if (!last || last.turn !== turn) {
                markers.push({ turn, endCommandIndex: i });
            }
        }
    }
    return markers;
}

export function headOffsetForTurnStart(
    turn: number,
    commandsLength: number,
    markers: TurnReplayMarker[]
): number {
    const marker = markers.find((m) => m.turn === turn);
    if (!marker) return commandsLength;
    return Math.max(0, commandsLength - (marker.endCommandIndex + 1));
}

/** headOffset values for each turn start, sorted ascending (older = larger offset). */
export function turnStartOffsets(
    commandsLength: number,
    markers: TurnReplayMarker[]
): { turn: number; offset: number }[] {
    return markers.map((m) => ({
        turn: m.turn,
        offset: headOffsetForTurnStart(m.turn, commandsLength, markers),
    }));
}

/** Next older turn boundary (larger headOffset), or undefined if at oldest. */
export function previousTurnOffset(
    currentOffset: number,
    offsets: { turn: number; offset: number }[]
): number | undefined {
    const sorted = [...offsets].sort((a, b) => a.offset - b.offset);
    for (const o of sorted) {
        if (o.offset > currentOffset) return o.offset;
    }
    return undefined;
}

/** Next newer turn boundary (smaller headOffset), or undefined if at latest. */
export function nextTurnOffset(
    currentOffset: number,
    offsets: { turn: number; offset: number }[]
): number | undefined {
    const sorted = [...offsets].sort((a, b) => b.offset - a.offset);
    for (const o of sorted) {
        if (o.offset < currentOffset) return o.offset;
    }
    return undefined;
}

/** Bar position 0–1 from left (oldest) for a turn marker tick. */
export function markerTrackFraction(
    endCommandIndex: number,
    commandsLength: number
): number {
    if (commandsLength <= 0) return 1;
    return (endCommandIndex + 1) / commandsLength;
}
