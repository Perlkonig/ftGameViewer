import { describe, expect, it } from "vitest";
import { applyCommand, foldCommands } from "./applyCommand";
import { minePhaseDiceCount, resolvePhase5MovementSequence } from "./mineMovement";
import { metaForCommandReplay } from "./types";
import type { FullThrustGamePosition } from "@/schemas/position";
import type { FullThrustGameCommand } from "@/schemas/commands";

const minesGameCommands = [
    {
        name: "placeShip",
        id: "A1",
        owner: "Player 1",
        position: { x: 22, y: 19 },
        facing: 3,
        speed: 0,
        object: {
            systems: [
                { name: "mineLayer", capacity: 3, id: "nxPMh" },
                { name: "drive", thrust: 6, id: "qm5Fg" },
            ],
        },
        svg: '<symbol viewBox="0 0 100 100"><path d="M0 0 L10 10"/></symbol>',
    },
    {
        name: "placeShip",
        id: "B1",
        owner: "Player 2",
        position: { x: 43, y: 19 },
        facing: 9,
        speed: 0,
        object: {
            systems: [
                { name: "mineLayer", capacity: 3, id: "nxPMh" },
                { name: "drive", thrust: 6, id: "qm5Fg" },
            ],
        },
        svg: '<symbol viewBox="0 0 100 100"><path d="M0 0 L10 10"/></symbol>',
    },
    {
        name: "moveShip",
        id: "A1",
        cinematicAllocation: { speedChange: "accel", speedChangeThrust: 6, turns: 0 },
        deployMineLayers: ["nxPMh"],
    },
    {
        name: "moveShip",
        id: "B1",
        cinematicAllocation: { speedChange: "accel", speedChangeThrust: 6, turns: 0 },
        deployMineLayers: ["nxPMh"],
    },
    { name: "advancePhase", phase: 2, turn: 1 },
    {
        name: "setInitiative",
        rolls: [
            { player: "Player 1", roll: 5 },
            { player: "Player 2", roll: 1 },
        ],
        winner: "Player 1",
    },
    { name: "advancePhase", phase: 3, turn: 1 },
    { name: "advancePhase", phase: 4, turn: 1 },
    { name: "advancePhase", phase: 5, turn: 1 },
    {
        name: "layMine",
        ship: "A1",
        systemId: "nxPMh",
        position: { x: 28, y: 19 },
    },
    {
        name: "layMine",
        ship: "B1",
        systemId: "nxPMh",
        position: { x: 37, y: 19 },
    },
    { name: "resolvePhase5Movement" },
    { name: "advancePhase", phase: 6, turn: 1 },
    { name: "advancePhase", phase: 7, turn: 1 },
    { name: "advancePhase", phase: 8, turn: 1 },
    { name: "advancePhase", phase: 9, turn: 1 },
    { name: "advancePhase", phase: 10, turn: 1 },
    { name: "advancePhase", phase: 11, turn: 1 },
    { name: "advancePhase", phase: 12, turn: 1 },
    { name: "advancePhase", phase: 13, turn: 1 },
    { name: "advancePhase", phase: 14, turn: 1 },
    { name: "advancePhase", phase: 15, turn: 1 },
    { name: "advancePhase", phase: 1, turn: 2 },
    { name: "advancePhase", phase: 2, turn: 2 },
    {
        name: "setInitiative",
        rolls: [
            { player: "Player 1", roll: 6 },
            { player: "Player 2", roll: 3 },
        ],
        winner: "Player 1",
    },
    { name: "advancePhase", phase: 3, turn: 2 },
    { name: "advancePhase", phase: 4, turn: 2 },
    { name: "advancePhase", phase: 5, turn: 2 },
] as FullThrustGameCommand[];

const initial: FullThrustGamePosition = {
    map: { mode: "fixed", width: 72, height: 48 },
    players: [
        { id: "Player 1", colour: "#e41a1c", vp: 0 },
        { id: "Player 2", colour: "#377eb8", vp: 0 },
    ],
    objects: [],
};

function headerAtTurn2Phase5() {
    return metaForCommandReplay({
        version: "1.0.0",
        name: "Mines",
        createdAt: "2026-07-15T02:11:32.201Z",
        turn: 2,
        phase: 5,
        dicePolicy: "hybrid",
        allowVectorMovement: false,
        includeCoreSystemsInThreshold: true,
        initiative: {
            rolls: [
                { player: "Player 1", roll: 6 },
                { player: "Player 2", roll: 3 },
            ],
            winner: "Player 1",
        },
    });
}

describe("mines game replay", () => {
    it("loads at turn 2 phase 5 with ships at speed 6 and cleared phase5ResolvedMoves", () => {
        const folded = foldCommands(headerAtTurn2Phase5(), initial, minesGameCommands, 0);
        expect(folded.error).toBeUndefined();
        expect(folded.state.meta.phase).toBe(5);
        expect(folded.state.meta.turn).toBe(2);
        expect(folded.state.phase5ResolvedMoves ?? []).toHaveLength(0);
        expect(folded.state.phase5MovementResolved).toBeFalsy();

        const a1 = folded.state.position.objects?.find((o) => o.id === "A1") as {
            position?: { x: number; y: number };
            speed?: number;
        };
        expect(a1?.speed).toBe(6);
        expect(a1?.position?.x).toBeCloseTo(28, 0);
    });

    it("drifts on resolvePhase5Movement with no turn-2 orders and detects detonations", () => {
        const folded = foldCommands(headerAtTurn2Phase5(), initial, minesGameCommands, 0);
        const resolved = applyCommand(folded.state, {
            name: "resolvePhase5Movement",
        } as FullThrustGameCommand);
        const a1 = resolved.state.position.objects?.find((o) => o.id === "A1") as {
            position?: { x: number; y: number };
        };
        expect(a1?.position?.x).toBeCloseTo(34, 0);
        const dice = minePhaseDiceCount(
            resolved.state.phase5ResolvedMoves ?? [],
            resolved.state.position,
            resolved.state.meta
        );
        expect(dice.detonations).toBeGreaterThan(0);
    });

    it("blocks advancing 5 to 6 until mine dice are resolved", () => {
        const folded = foldCommands(headerAtTurn2Phase5(), initial, minesGameCommands, 0);
        expect(() =>
            applyCommand(folded.state, { name: "advancePhase", phase: 6, turn: 2 } as never)
        ).toThrow(/Resolve mine sweep\/detonation/);
    });

    it("advancing 4 to 5 does not move ships", () => {
        const cmdsThroughPhase4 = minesGameCommands.slice(0, -1);
        const folded = foldCommands(headerAtTurn2Phase5(), initial, cmdsThroughPhase4, 0);
        const at4 = applyCommand(folded.state, {
            name: "advancePhase",
            phase: 5,
            turn: 2,
        } as never).state;
        const a1 = at4.position.objects?.find((o) => o.id === "A1") as {
            position?: { x: number; y: number };
        };
        expect(a1?.position?.x).toBeCloseTo(28, 0);
        expect(at4.phase5ResolvedMoves ?? []).toHaveLength(0);
    });

    it("preview drift dice when advancing from phase 5 without explicit resolve", () => {
        const folded = foldCommands(headerAtTurn2Phase5(), initial, minesGameCommands, 0);
        const preview = resolvePhase5MovementSequence(
            folded.state.position,
            folded.state.meta,
            folded.state.pendingMoves,
            folded.state.pendingLayMines
        );
        const dice = minePhaseDiceCount(preview.moves, preview.position, folded.state.meta);
        expect(dice.detonations).toBeGreaterThan(0);
    });

    it("removes detonated mines on replay when objDestroy uses legacy random ids", () => {
        const folded = foldCommands(headerAtTurn2Phase5(), initial, minesGameCommands, 0);
        let state = applyCommand(folded.state, {
            name: "resolvePhase5Movement",
        } as FullThrustGameCommand).state;
        const mines = state.position.objects?.filter(
            (o) => o.objType === "ordnance" && (o as { type?: string }).type === "mine"
        );
        expect(mines?.length).toBe(2);
        for (const mine of mines ?? []) {
            state = applyCommand(state, {
                name: "objDestroy",
                uuid: `${mine.id}_legacy_random_suffix`,
            } as FullThrustGameCommand).state;
        }
        const remaining = state.position.objects?.filter(
            (o) => o.objType === "ordnance" && (o as { type?: string }).type === "mine"
        );
        expect(remaining ?? []).toHaveLength(0);
    });

    it("advances 5 to 6 after movement and mine phase are fully resolved", () => {
        const folded = foldCommands(headerAtTurn2Phase5(), initial, minesGameCommands, 0);
        let state = folded.state;
        state = applyCommand(state, { name: "resolvePhase5Movement" } as never).state;
        const a1AfterMove = state.position.objects?.find((o) => o.id === "A1") as {
            position?: { x: number; y: number };
        };
        expect(state.phase5MovementResolved).toBe(true);
        state = applyCommand(state, {
            name: "logDice",
            purpose: "test",
            rolls: [5, 2, 3, 3],
        } as never).state;
        state = applyCommand(state, {
            name: "dmgShip",
            ship: "A1",
            hull: 1,
            armour: [0],
        } as never).state;
        state = applyCommand(state, {
            name: "objDestroy",
            uuid: "mine_B1_nxPMh_test",
        } as never).state;
        state = applyCommand(state, {
            name: "resolveMinePhase",
            rolls: [5, 2, 3, 3],
            preExpanded: true,
        } as never).state;
        expect(state.phase5MovementResolved).toBe(true);
        expect(state.phase5ResolvedMoves ?? []).toHaveLength(0);
        const advanced = applyCommand(state, {
            name: "advancePhase",
            phase: 6,
            turn: 2,
        } as never).state;
        expect(advanced.meta.phase).toBe(6);
        const a1After = advanced.position.objects?.find((o) => o.id === "A1") as {
            position?: { x: number; y: number };
        };
        expect(a1After?.position?.x).toBeCloseTo(a1AfterMove?.position?.x ?? 0, 0);
    });
});
