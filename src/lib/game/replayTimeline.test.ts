import { describe, expect, it } from "vitest";
import type { FullThrustGameCommand } from "@/schemas/commands";
import { DEFAULT_META } from "./types";
import {
    headOffsetForTurnStart,
    nextTurnOffset,
    previousTurnOffset,
    turnReplayMarkers,
    turnStartOffsets,
} from "./replayTimeline";

describe("replayTimeline", () => {
    it("marks turn 1 at start and advances with phase commands", () => {
        const commands = [
            { name: "advancePhase", phase: 1 },
            { name: "advancePhase", phase: 2 },
        ] as FullThrustGameCommand[];
        const markers = turnReplayMarkers(DEFAULT_META(), commands);
        expect(markers[0]).toEqual({ turn: 1, endCommandIndex: -1 });
        expect(markers).toHaveLength(1);
    });

    it("adds marker when turn wraps 15 to 1", () => {
        const meta = { ...DEFAULT_META(), phase: 15 as const, turn: 1 };
        const commands = [
            { name: "advancePhase", phase: 1, turn: 2 },
        ] as FullThrustGameCommand[];
        const markers = turnReplayMarkers(meta, commands);
        expect(markers).toEqual([
            { turn: 1, endCommandIndex: -1 },
            { turn: 2, endCommandIndex: 0 },
        ]);
        expect(headOffsetForTurnStart(2, 1, markers)).toBe(0);
        expect(headOffsetForTurnStart(1, 1, markers)).toBe(1);
    });

    it("headOffsetForTurnStart matches fold head model", () => {
        const commands = [
            { name: "advancePhase", phase: 2 },
            { name: "advancePhase", phase: 3 },
            { name: "advancePhase", phase: 1, turn: 2 },
        ] as FullThrustGameCommand[];
        const markers = turnReplayMarkers(DEFAULT_META(), commands);
        expect(headOffsetForTurnStart(2, commands.length, markers)).toBe(0);
        expect(headOffsetForTurnStart(1, commands.length, markers)).toBe(
            commands.length - 0
        );
    });

    it("previous and next turn offsets step boundaries", () => {
        const meta = { ...DEFAULT_META(), phase: 15 as const, turn: 1 };
        const commands = [
            { name: "advancePhase", phase: 1, turn: 2 },
            { name: "_custom", msg: "x" },
            { name: "advancePhase", phase: 1, turn: 3 },
        ] as FullThrustGameCommand[];
        const markers = turnReplayMarkers(meta, commands);
        const offsets = turnStartOffsets(commands.length, markers);
        expect(previousTurnOffset(0, offsets)).toBe(2);
        expect(previousTurnOffset(2, offsets)).toBe(3);
        expect(nextTurnOffset(3, offsets)).toBe(2);
        expect(nextTurnOffset(2, offsets)).toBe(0);
    });
});
