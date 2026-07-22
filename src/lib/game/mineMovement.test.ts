import { describe, expect, it } from "vitest";
import {
    declaredMineLayersFromPending,
    buildMinePhaseResolveCommands,
    collectDetonationEvents,
    distancePointToPath,
    mineLaysComplete,
    mineOrdnanceId,
    minePhaseDiceCount,
    pathWithinMu,
    pointOnPathAtFraction,
    resolvePhase5MovementSequence,
    shipsNeedingMinePlacements,
    type ResolvedShipMove,
} from "./mineMovement";
import { arrayRollSource, generatorRollSource, InsufficientDiceError } from "./dice";
import { DEFAULT_META } from "./types";
import type { FullThrustGamePosition } from "@/schemas/position";
import type { FullThrustGameCommand } from "@/schemas/commands";

const position = (): FullThrustGamePosition => ({
    map: { mode: "fixed", width: 72, height: 48 },
    objects: [
        {
            objType: "ship",
            id: "A",
            owner: "P1",
            object: { thrust: 4, systems: [{ id: "ml1", name: "mineLayer", capacity: 2 }] },
            svg: "<symbol></symbol>",
            position: { x: 0, y: 0 },
            facing: 12,
            speed: 2,
        },
        {
            objType: "ship",
            id: "B",
            owner: "P2",
            object: { thrust: 4 },
            svg: "<symbol></symbol>",
            position: { x: 10, y: 0 },
            facing: 12,
            speed: 0,
        },
    ],
} as FullThrustGamePosition);

describe("mineMovement", () => {
    it("detects path proximity", () => {
        const path = [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
        ];
        expect(pathWithinMu(path, { x: 2, y: 0.1 }, 0.25)).toBe(true);
        expect(distancePointToPath(path, { x: 2, y: 2 })).toBeGreaterThan(1);
    });

    it("interpolates along path fraction", () => {
        const path = [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
        ];
        expect(pointOnPathAtFraction(path, 0.5)).toEqual({ x: 5, y: 0 });
    });

    it("gates mine lays until all declared layers placed", () => {
        const pendingMoves = [
            {
                name: "moveShip",
                id: "A",
                deployMineLayers: ["ml1"],
                cinematicAllocation: { speedChange: "hold", speedChangeThrust: 0, turns: 0 },
            },
        ] as FullThrustGameCommand[];
        expect(mineLaysComplete(pendingMoves, [])).toBe(false);
        expect(shipsNeedingMinePlacements(pendingMoves, [])).toEqual([
            { shipId: "A", systemId: "ml1" },
        ]);
        const pendingLayMines = [
            { name: "layMine", ship: "A", systemId: "ml1", position: { x: 1, y: 0 } },
        ] as FullThrustGameCommand[];
        expect(mineLaysComplete(pendingMoves, pendingLayMines)).toBe(true);
        expect(declaredMineLayersFromPending(pendingMoves, "A")).toEqual(["ml1"]);
    });

    it("resolves minelayer ships before others and consumes ammo", () => {
        const pendingMoves = [
            {
                name: "moveShip",
                id: "B",
                cinematicAllocation: { speedChange: "hold", speedChangeThrust: 0, turns: 0 },
            },
            {
                name: "moveShip",
                id: "A",
                deployMineLayers: ["ml1"],
                cinematicAllocation: { speedChange: "hold", speedChangeThrust: 0, turns: 0 },
            },
        ] as FullThrustGameCommand[];
        const pendingLayMines = [
            { name: "layMine", ship: "A", systemId: "ml1", position: { x: 1, y: 0 } },
        ] as FullThrustGameCommand[];
        const result = resolvePhase5MovementSequence(
            position(),
            DEFAULT_META(),
            pendingMoves,
            pendingLayMines
        );
        const shipA = result.position.objects?.find((o) => o.id === "A") as {
            ammo?: string[];
            movementFlags?: { sweepForMines?: boolean };
        };
        expect(shipA?.ammo).toEqual(["ml1"]);
        const mines = result.position.objects?.filter(
            (o) => o.objType === "ordnance" && o.type === "mine"
        );
        expect(mines?.length).toBe(1);
        expect(mines?.[0].deployedTurn).toBe(1);
    });

    it("detects hostile mine detonation within 3 MU of movement path", () => {
        const pos = {
            map: { mode: "fixed", width: 72, height: 48 },
            objects: [
                {
                    objType: "ship",
                    id: "A1",
                    owner: "P1",
                    object: { thrust: 6, systems: [{ id: "ml", name: "mineLayer", capacity: 3 }] },
                    svg: "<symbol></symbol>",
                    position: { x: 27.97, y: 19.06 },
                    facing: 3,
                    speed: 6,
                },
                {
                    objType: "ship",
                    id: "B1",
                    owner: "P2",
                    object: { thrust: 6, systems: [{ id: "ml", name: "mineLayer", capacity: 3 }] },
                    svg: "<symbol></symbol>",
                    position: { x: 36.72, y: 18.83 },
                    facing: 9,
                    speed: 6,
                },
                {
                    objType: "ordnance",
                    id: "mine_p1",
                    type: "mine",
                    owner: "P1",
                    position: { x: 27.97, y: 19.06 },
                    deployedTurn: 1,
                },
                {
                    objType: "ordnance",
                    id: "mine_p2",
                    type: "mine",
                    owner: "P2",
                    position: { x: 36.72, y: 18.83 },
                    deployedTurn: 1,
                },
            ],
        } as FullThrustGamePosition;
        const meta = { ...DEFAULT_META(), turn: 2, phase: 5 as const };
        const pendingMoves = [
            {
                name: "moveShip",
                id: "A1",
                cinematicAllocation: { speedChange: "hold", speedChangeThrust: 0, turns: 0 },
            },
            {
                name: "moveShip",
                id: "B1",
                cinematicAllocation: { speedChange: "hold", speedChangeThrust: 0, turns: 0 },
            },
        ] as FullThrustGameCommand[];
        const result = resolvePhase5MovementSequence(pos, meta, pendingMoves, []);
        const dets = collectDetonationEvents(result.moves, result.position, meta);
        expect(dets).toHaveLength(2);
        expect(minePhaseDiceCount(result.moves, result.position, meta).detonations).toBe(8);
    });

    it("records per-event damage in logDice results for hostile detonation", () => {
        const pos = {
            map: { mode: "fixed", width: 72, height: 48 },
            objects: [
                {
                    objType: "ship",
                    id: "A1",
                    owner: "P1",
                    object: { thrust: 6 },
                    svg: "<symbol></symbol>",
                    position: { x: 33.97, y: 19.06 },
                    facing: 3,
                    speed: 6,
                },
                {
                    objType: "ordnance",
                    id: "mine_p2",
                    type: "mine",
                    owner: "P2",
                    position: { x: 36.72, y: 18.83 },
                    deployedTurn: 1,
                },
            ],
        } as FullThrustGamePosition;
        const meta = { ...DEFAULT_META(), turn: 2, phase: 5 as const };
        const moves: ResolvedShipMove[] = [
            {
                shipId: "A1",
                path: [
                    { x: 27.97, y: 19.06 },
                    { x: 33.97, y: 19.06 },
                ],
                sweepForMines: false,
            },
        ];
        const source = arrayRollSource([5, 5, 5, 5, 5, 5, 5, 5]);
        const { cmds } = buildMinePhaseResolveCommands(pos, meta, moves, source);
        const logDice = cmds.filter((c) => c.name === "logDice");
        expect(logDice).toHaveLength(1);
        const result = (logDice[0] as { result?: string }).result ?? "";
        expect(result).toContain("mine_p2");
        expect(result).toContain("A1");
        expect(result).toMatch(/Hit|Miss/);
        expect(cmds.some((c) => c.name === "dmgShip" && (c as { ship?: string }).ship === "A1")).toBe(
            true
        );
    });

    it("uses stable mine ids from lay position and turn", () => {
        expect(
            mineOrdnanceId(
                {
                    ship: "B1",
                    systemId: "nxPMh",
                    position: { x: 36.71874854536877, y: 18.833667400534676 },
                },
                1
            )
        ).toBe("mine_B1_nxPMh_t1_36.72_18.83");
    });

    it("consumes extra dice for penetrating beam rerolls beyond the minimum pool", () => {
        const pos = {
            map: { mode: "fixed", width: 72, height: 48 },
            objects: [
                {
                    objType: "ship",
                    id: "A1",
                    owner: "P1",
                    object: { thrust: 6 },
                    svg: "<symbol></symbol>",
                    position: { x: 33.97, y: 19.06 },
                    facing: 3,
                    speed: 6,
                },
                {
                    objType: "ordnance",
                    id: "mine_p2",
                    type: "mine",
                    owner: "P2",
                    position: { x: 36.72, y: 18.83 },
                    deployedTurn: 1,
                },
            ],
        } as FullThrustGamePosition;
        const meta = { ...DEFAULT_META(), turn: 2, phase: 5 as const };
        const moves: ResolvedShipMove[] = [
            {
                shipId: "A1",
                path: [
                    { x: 27.97, y: 19.06 },
                    { x: 33.97, y: 19.06 },
                ],
                sweepForMines: false,
            },
        ];
        const minimum = minePhaseDiceCount(moves, pos, meta).total;
        const faces = Array.from({ length: 20 }, () => 6);
        const source = generatorRollSource(() => faces.shift() ?? 3);
        const mark = source.mark();
        buildMinePhaseResolveCommands(pos, meta, moves, source);
        expect(source.consumedSince(mark).length).toBeGreaterThan(minimum);

        const shortSource = arrayRollSource([6, 6, 6, 6]);
        expect(() => buildMinePhaseResolveCommands(pos, meta, moves, shortSource)).toThrow(
            InsufficientDiceError
        );
    });
});
