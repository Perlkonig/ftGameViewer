import { describe, it, expect } from "vitest";
import { thresholdsCrossed, systemFailsThreshold, nextDriveState } from "./thresholds";
import { activationOrder, nextPhase, isCommandLegalInPhase } from "./phase";
import { DEFAULT_META } from "./types";
import {
    createNewPackage,
    parseGamePackage,
    parseLoadable,
    createCommandBundle,
    parseCommandBundle,
    packageFromParts,
} from "./package";
import { applyCommand, foldCommands } from "./applyCommand";
import type { FoldState } from "./applyCommand";
import type { FullThrustGameCommand } from "@/schemas/commands";
import type { FullThrustGamePosition } from "@/schemas/position";
import { buildPhase9PdResolveCommands } from "./pointDefensePhase9";

describe("thresholds", () => {
    it("detects row crossings", () => {
        // 12 hull, 3 rows of 4
        const t = thresholdsCrossed(12, 3, 3, 5);
        expect(t.thresholdsCrossed).toBe(1);
        expect(systemFailsThreshold(6, t.failOnOrAbove)).toBe(true);
    });

    it("drive threshold progression", () => {
        expect(nextDriveState("ok", true)).toBe("half");
        expect(nextDriveState("half", true)).toBe("disabled");
    });
});

describe("phase", () => {
    it("advances phase and wraps turn", () => {
        const meta = DEFAULT_META();
        meta.phase = 15;
        meta.turn = 2;
        expect(nextPhase(meta)).toEqual({ turn: 3, phase: 1 });
    });

    it("loser acts first in launch phase", () => {
        const order = activationOrder(
            ["A", "B"],
            { rolls: [{ player: "A", roll: 6 }, { player: "B", roll: 2 }], winner: "A" },
            3
        );
        expect(order[0]).toBe("B");
        expect(order[1]).toBe("A");
    });

    it("winner acts first in ship fire", () => {
        const order = activationOrder(
            ["A", "B"],
            { rolls: [{ player: "A", roll: 6 }, { player: "B", roll: 2 }], winner: "A" },
            11
        );
        expect(order[0]).toBe("A");
    });

    it("orders three players loser-first in launch phase", () => {
        const order = activationOrder(
            ["A", "B", "C"],
            {
                rolls: [
                    { player: "A", roll: 3 },
                    { player: "B", roll: 6 },
                    { player: "C", roll: 2 },
                ],
                winner: "B",
            },
            3
        );
        expect(order).toEqual(["A", "C", "B"]);
    });

    it("keeps player list when initiative winner is unknown", () => {
        expect(
            activationOrder(["A", "B"], { rolls: [], winner: "Z" }, 3)
        ).toEqual(["A", "B"]);
    });

    it("gates commands by phase", () => {
        expect(isCommandLegalInPhase("moveShip", 5)).toBe(true);
        expect(isCommandLegalInPhase("fireWeapon", 5)).toBe(false);
        expect(isCommandLegalInPhase("fireWeapon", 5, { moderator: true })).toBe(true);
        expect(isCommandLegalInPhase("dmgShip", 5, { moderator: true })).toBe(true);
    });
});

describe("package", () => {
    it("round-trips create/parse", () => {
        const pkg = createNewPackage({
            name: "Test",
            dicePolicy: "hybrid",
            map: { mode: "fixed", width: 72, height: 48 },
            players: [{ id: "A", colour: "#ff0000", vp: 0 }],
        });
        const parsed = parseGamePackage(JSON.parse(JSON.stringify(pkg)));
        expect(parsed.name).toBe("Test");
        expect(parsed.players).toHaveLength(1);
        expect(parsed.map.mode).toBe("fixed");
        expect(parsed.initialState.players).toHaveLength(1);
        expect(parsed.commands).toEqual([]);
    });

    it("loads legacy working saves without top-level players/map", () => {
        const legacy = {
            initialState: {
                map: { mode: "fixed", width: 48, height: 36 },
                players: [{ id: "A", colour: "#ff0000" }],
            },
            commands: [],
        };
        const pkg = parseLoadable(legacy);
        expect(pkg.players[0].id).toBe("A");
        expect(pkg.map.width).toBe(48);
    });

    it("parses command bundles", () => {
        const bundle = createCommandBundle([{ name: "_custom", msg: "hi" } as never], {
            playerId: "Alice",
        });
        const parsed = parseCommandBundle(JSON.parse(JSON.stringify(bundle)));
        expect(parsed.playerId).toBe("Alice");
        expect(parsed.commands).toHaveLength(1);
    });
});

describe("applyCommand meta", () => {
    it("setInitiative and advancePhase update meta", () => {
        const meta = DEFAULT_META();
        const position = {
            players: [
                { id: "A", colour: "#ff0000" },
                { id: "B", colour: "#0000ff" },
            ],
        } as FullThrustGamePosition;
        let fold: FoldState = { meta, position };
        fold = applyCommand(fold, {
            name: "setInitiative",
            rolls: [
                { player: "A", roll: 5 },
                { player: "B", roll: 3 },
            ],
            winner: "A",
        } as never).state;
        expect(fold.meta.initiative?.winner).toBe("A");

        fold = applyCommand(fold, {
            name: "advancePhase",
            phase: 3,
            turn: 1,
        } as never).state;
        expect(fold.meta.phase).toBe(3);
    });

    it("awardVP updates player", () => {
        const fold: FoldState = {
            meta: DEFAULT_META(),
            position: {
                players: [{ id: "A", colour: "#ff0000", vp: 0 }],
            } as FullThrustGamePosition,
        };
        const result = applyCommand(fold, {
            name: "awardVP",
            player: "A",
            vp: 10,
        } as never);
        expect(result.state.position.players![0].vp).toBe(10);
    });

    it("dmgShip and sysDisable mutate ship", () => {
        const fold: FoldState = {
            meta: DEFAULT_META(),
            position: {
                players: [{ id: "A", colour: "#ff0000" }],
                objects: [
                    {
                        objType: "ship" as const,
                        id: "s1",
                        owner: "A",
                        object: {},
                        svg: "<symbol viewBox='0 0 1 1'></symbol>",
                        position: { x: 0, y: 0 },
                        facing: 12 as const,
                        speed: 0,
                    },
                ],
            } as FullThrustGamePosition,
        };
        let state = applyCommand(fold, {
            name: "dmgShip",
            ship: "s1",
            hull: 2,
            armour: [1],
        } as never).state;
        expect(state.position.objects![0]).toMatchObject({ dmgHull: 2 });
        state = applyCommand(state, {
            name: "sysDisable",
            ship: "s1",
            system: "beam1",
            state: "damaged",
        } as never).state;
        expect(
            (state.position.objects![0] as { systems?: { id: string }[] }).systems?.[0].id
        ).toBe("beam1");
    });

    it("placeShip rejects vector when not allowed", () => {
        const fold: FoldState = {
            meta: { ...DEFAULT_META(), allowVectorMovement: false },
            position: {
                players: [{ id: "A", colour: "#ff0000" }],
            } as FullThrustGamePosition,
        };
        expect(() =>
            applyCommand(fold, {
                name: "placeShip",
                id: "s1",
                owner: "A",
                object: {},
                svg: "<symbol viewBox='0 0 1 1'></symbol>",
                position: { x: 0, y: 0 },
                facing: 12,
                speed: 0,
                movementMode: "vector",
                course: 90,
            } as never)
        ).toThrow(/Vector movement is not allowed/);
    });

    it("foldCommands respects headOffset", () => {
        const meta = DEFAULT_META();
        const position = {
            players: [{ id: "A", colour: "#ff0000" }],
        } as FullThrustGamePosition;
        const commands = [
            { name: "advancePhase", phase: 1 },
            { name: "advancePhase", phase: 2 },
        ] as never[];
        const full = foldCommands(meta, position, commands, 0);
        expect(full.state.meta.phase).toBe(2);
        const rewind = foldCommands(meta, position, commands, 1);
        expect(rewind.state.meta.phase).toBe(1);
    });

    it("setCoreState and ticks on turn wrap", () => {
        const fold: FoldState = {
            meta: { ...DEFAULT_META(), phase: 15, turn: 1 },
            position: {
                players: [{ id: "A", colour: "#ff0000" }],
                objects: [
                    {
                        objType: "ship" as const,
                        id: "s1",
                        owner: "A",
                        object: {},
                        svg: "<symbol viewBox='0 0 1 1'></symbol>",
                        position: { x: 0, y: 0 },
                        facing: 12 as const,
                        speed: 0,
                    },
                ],
            } as FullThrustGamePosition,
        };
        let state = applyCommand(fold, {
            name: "setCoreState",
            ship: "s1",
            powerless: true,
            uncontrolled: 2,
        } as never).state;
        expect(
            (state.position.objects![0] as { coreState?: { powerless?: boolean } }).coreState
                ?.powerless
        ).toBe(true);
        state = applyCommand(state, {
            name: "advancePhase",
            phase: 1,
        } as never).state;
        expect(state.meta.turn).toBe(2);
        expect(
            (state.position.objects![0] as { coreState?: { uncontrolled?: number } }).coreState
                ?.uncontrolled
        ).toBe(1);
    });
});

describe("deferred movement orders", () => {
    const shipPosition = (fold: FoldState, id: string) =>
        (
            fold.position.objects?.find((o) => o.id === id) as {
                position?: { x: number; y: number };
            }
        )?.position;

    const baseShipFold = (): FoldState => ({
        meta: { ...DEFAULT_META(), phase: 1, turn: 1 },
        position: {
            players: [{ id: "A", colour: "#f00" }],
            objects: [
                {
                    objType: "ship",
                    id: "s1",
                    owner: "A",
                    object: {},
                    svg: "<symbol viewBox='0 0 1 1'></symbol>",
                    position: { x: 1, y: 1 },
                    facing: 12,
                    speed: 0,
                },
            ],
        } as FullThrustGamePosition,
    });

    const moveS1 = {
        name: "moveShip",
        id: "s1",
        cinematicAllocation: { speedChange: "hold", speedChangeThrust: 0, turns: 0 },
    } as never;

    const moveS1Legacy = {
        name: "moveShip",
        id: "s1",
        position: { x: 5, y: 5 },
        facing: 12,
        speed: 2,
        vectors: [
            { x: 1, y: 1 },
            { x: 5, y: 5 },
        ],
    } as never;

    it("defers moveShip before phase 5 and resolves via resolvePhase5Movement", () => {
        let fold = baseShipFold();
        (fold.position.objects![0] as { speed?: number }).speed = 2;
        fold = applyCommand(fold, moveS1).state;
        expect(shipPosition(fold, "s1")).toEqual({ x: 1, y: 1 });
        expect(fold.pendingMoves).toHaveLength(1);

        fold = applyCommand(fold, { name: "advancePhase", phase: 5 } as never).state;
        expect(fold.pendingMoves).toHaveLength(1);
        expect(shipPosition(fold, "s1")).toEqual({ x: 1, y: 1 });

        fold = applyCommand(fold, { name: "resolvePhase5Movement" } as never).state;
        expect(fold.pendingMoves).toHaveLength(0);
        expect(shipPosition(fold, "s1")).toEqual({ x: 1, y: -1 });
    });

    it("does not move ships on entering phase 5 without resolve", () => {
        let fold = baseShipFold();
        (fold.position.objects![0] as { speed?: number }).speed = 2;
        fold = applyCommand(fold, { name: "advancePhase", phase: 5 } as never).state;
        expect(shipPosition(fold, "s1")).toEqual({ x: 1, y: 1 });
    });

    it("applies legacy absolute moveShip on resolvePhase5Movement", () => {
        let fold = baseShipFold();
        fold = applyCommand(fold, moveS1Legacy).state;
        fold = applyCommand(fold, { name: "advancePhase", phase: 5 } as never).state;
        fold = applyCommand(fold, { name: "resolvePhase5Movement" } as never).state;
        expect(shipPosition(fold, "s1")).toEqual({ x: 5, y: 5 });
    });

    it("applies moveShip immediately in phase 5", () => {
        let fold = baseShipFold();
        (fold.position.objects![0] as { speed?: number }).speed = 2;
        fold.meta.phase = 5;
        fold = applyCommand(fold, moveS1).state;
        expect(shipPosition(fold, "s1")).toEqual({ x: 1, y: -1 });
        expect(fold.pendingMoves ?? []).toHaveLength(0);
    });

    it("rejects duplicate pending movement orders for the same ship", () => {
        let fold = baseShipFold();
        fold = applyCommand(fold, moveS1).state;
        expect(() => applyCommand(fold, moveS1)).toThrow(/duplicate movement order/);
    });

    it("foldCommands keeps pending moves after advance to phase 5", () => {
        const meta = { ...DEFAULT_META(), phase: 1 as const, turn: 1 };
        const position = baseShipFold().position;
        (position.objects![0] as { speed?: number }).speed = 2;
        const commands = [
            moveS1,
            { name: "advancePhase", phase: 5 },
        ] as never[];
        const full = foldCommands(meta, position, commands, 0);
        expect(shipPosition(full.state, "s1")).toEqual({ x: 1, y: 1 });
        expect(full.state.pendingMoves).toHaveLength(1);
        const rewind = foldCommands(meta, position, commands, 1);
        expect(shipPosition(rewind.state, "s1")).toEqual({ x: 1, y: 1 });
        expect(rewind.state.pendingMoves).toHaveLength(1);
    });

    it("auto-resolves pending mines when advancing from phase 5 to 6", () => {
        let fold = baseShipFold();
        (fold.position.objects![0] as { speed?: number }).speed = 2;
        fold = applyCommand(
            fold,
            {
                ...moveS1,
                deployMineLayers: ["ml1"],
            } as never
        ).state;
        fold = applyCommand(fold, { name: "advancePhase", phase: 5 } as never).state;
        fold = applyCommand(
            fold,
            {
                name: "layMine",
                ship: "s1",
                systemId: "ml1",
                position: { x: 2, y: 1 },
            } as never
        ).state;
        fold = applyCommand(fold, { name: "advancePhase", phase: 6 } as never).state;
        expect(fold.meta.phase).toBe(6);
        expect(fold.pendingLayMines ?? []).toHaveLength(0);
        const mines = fold.position.objects?.filter(
            (o) => o.objType === "ordnance" && o.type === "mine"
        );
        expect(mines?.length).toBe(1);
        expect(mines?.[0].position).toEqual({ x: 2, y: 1 });
    });
});

describe("mine placement replay", () => {
    const falke = (id: string, owner: string, x: number, y: number, facing: number) => ({
        objType: "ship" as const,
        id,
        owner,
        object: {
            systems: [
                { name: "drive", thrust: 6, id: "qm5Fg" },
                { name: "mineLayer", capacity: 3, id: "nxPMh" },
            ],
        },
        svg: "<symbol viewBox='0 0 1 1'></symbol>",
        position: { x, y },
        facing,
        speed: 0,
        movementMode: "cinematic" as const,
    });

    it("does not false-flag layMine when package header is ahead of the log", () => {
        const headerMeta = { ...DEFAULT_META(), phase: 5 as const, turn: 2 };
        const initial: FullThrustGamePosition = {
            map: { mode: "fixed", width: 72, height: 48 },
            players: [
                { id: "Player 1", colour: "#e41a1c", vp: 0 },
                { id: "Player 2", colour: "#377eb8", vp: 0 },
            ],
            objects: [],
        };
        const commands = [
            {
                name: "placeShip",
                id: "A1",
                owner: "Player 1",
                object: falke("A1", "Player 1", 0, 0, 3).object,
                svg: falke("A1", "Player 1", 0, 0, 3).svg,
                position: { x: 22, y: 19 },
                facing: 3,
                speed: 0,
            },
            {
                name: "placeShip",
                id: "B1",
                owner: "Player 2",
                object: falke("B1", "Player 2", 0, 0, 9).object,
                svg: falke("B1", "Player 2", 0, 0, 9).svg,
                position: { x: 43, y: 19 },
                facing: 9,
                speed: 0,
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
        ] as never[];

        const folded = foldCommands(headerMeta, initial, commands, 0);
        const layErrors = folded.warnings.filter(
            (w) => w.command === "layMine" && w.severity === "error"
        );
        expect(layErrors).toHaveLength(0);
        expect(folded.state.pendingLayMines ?? []).toHaveLength(0);
        const mines = folded.state.position.objects?.filter(
            (o) => o.objType === "ordnance" && o.type === "mine"
        );
        expect(mines?.length).toBe(2);
    });

    it("blocks advancing past phase 5 while mine detonation dice are pending", () => {
        let fold: FoldState = {
            meta: { ...DEFAULT_META(), phase: 5, turn: 2 },
            position: {
                map: { mode: "fixed", width: 72, height: 48 },
                objects: [
                    {
                        objType: "ship",
                        id: "A1",
                        owner: "P1",
                        object: { thrust: 6 },
                        svg: "<symbol></symbol>",
                        position: { x: 27.97, y: 19.06 },
                        facing: 3,
                        speed: 6,
                    },
                    {
                        objType: "ship",
                        id: "B1",
                        owner: "P2",
                        object: { thrust: 6 },
                        svg: "<symbol></symbol>",
                        position: { x: 36.72, y: 18.83 },
                        facing: 9,
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
            } as FullThrustGamePosition,
            pendingMoves: [
                {
                    name: "moveShip",
                    id: "A1",
                    cinematicAllocation: { speedChange: "hold", speedChangeThrust: 0, turns: 0 },
                },
            ] as never[],
        };
        fold = applyCommand(fold, { name: "resolvePhase5Movement" } as never).state;
        expect(() => applyCommand(fold, { name: "advancePhase", phase: 6 } as never)).toThrow(
            /Resolve mine sweep\/detonation/
        );
    });

    it("resolves drift for all ships when no explicit orders remain in phase 5", () => {
        let fold: FoldState = {
            meta: { ...DEFAULT_META(), phase: 5, turn: 2 },
            position: {
                map: { mode: "fixed", width: 72, height: 48 },
                objects: [
                    {
                        objType: "ship",
                        id: "A1",
                        owner: "P1",
                        object: { thrust: 6 },
                        svg: "<symbol></symbol>",
                        position: { x: 27.97, y: 19.06 },
                        facing: 3,
                        speed: 6,
                    },
                    {
                        objType: "ship",
                        id: "B1",
                        owner: "P2",
                        object: { thrust: 6 },
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
            } as FullThrustGamePosition,
        };
        fold = applyCommand(fold, { name: "resolvePhase5Movement" } as never).state;
        expect(fold.pendingMoves ?? []).toHaveLength(0);
        expect(fold.phase5ResolvedMoves?.length).toBe(2);
        expect(fold.phase5MovementResolved).toBe(true);
        const a1 = fold.position.objects?.find((o) => o.id === "A1") as {
            position?: { x: number; y: number };
        };
        expect(a1?.position?.x).toBeCloseTo(33.97, 1);
        expect(() => applyCommand(fold, { name: "advancePhase", phase: 6 } as never)).toThrow(
            /Resolve mine sweep\/detonation/
        );
    });
});

describe("phase segments", () => {
    const launchPosition = (): FullThrustGamePosition => ({
        map: { mode: "fixed", width: 72, height: 48 },
        players: [
            { id: "P1", colour: "#f00", vp: 0 },
            { id: "P2", colour: "#00f", vp: 0 },
        ],
        objects: [
            {
                objType: "ship",
                id: "S1",
                owner: "P1",
                object: { systems: [{ name: "Salvo-1", id: "sys1" }] },
                svg: "<symbol viewBox='0 0 1 1'></symbol>",
                position: { x: 1, y: 1 },
                facing: 12,
                speed: 0,
            },
        ] as unknown as FullThrustGamePosition["objects"],
    });

    it("advanceSegment toggles orders and resolve", () => {
        let fold: FoldState = {
            meta: {
                ...DEFAULT_META(),
                phase: 3,
                segment: "orders",
                activation: { queue: ["S1"], index: 0 },
            },
            position: launchPosition(),
        };
        fold = applyCommand(fold, { name: "advanceSegment" } as never).state;
        expect(fold.meta.segment).toBe("resolve");
        fold = applyCommand(fold, { name: "advanceSegment" } as never).state;
        expect(fold.meta.segment).toBe("orders");
        expect(fold.meta.activation?.index).toBe(1);
    });

    it("declare and resolve launch ordnance for current ship", () => {
        let fold: FoldState = {
            meta: {
                ...DEFAULT_META(),
                phase: 3,
                segment: "orders",
                activation: { queue: ["S1"], index: 0 },
            },
            position: launchPosition(),
        };
        fold = applyCommand(fold, {
            name: "declareLaunchOrdnance",
            ship: "S1",
            id: "m1",
            systemId: "sys1",
            position: { x: 4, y: 4 },
            type: "missile",
            range: 6,
        } as never).state;
        expect(fold.pendingLaunches).toHaveLength(1);
        expect(fold.position.objects?.filter((o) => o.objType === "ordnance")).toHaveLength(0);

        fold = applyCommand(fold, { name: "advanceSegment" } as never).state;
        fold = applyCommand(fold, {
            name: "resolveLaunchOrdnance",
            ship: "S1",
        } as never).state;
        expect(fold.pendingLaunches).toHaveLength(0);
        const ord = fold.position.objects?.find((o) => o.objType === "ordnance");
        expect(ord?.position).toEqual({ x: 4, y: 4 });
    });

    it("launchOrdnance consumes magazine ammo and scopes glyph id", () => {
        let fold: FoldState = {
            meta: { ...DEFAULT_META(), phase: 3, turn: 1 },
            position: {
                map: { mode: "fixed", width: 72, height: 48 },
                players: [{ id: "P1", colour: "#f00", vp: 0 }],
                objects: [
                    {
                        objType: "ship",
                        id: "S1",
                        owner: "P1",
                        object: {
                            systems: [{ id: "mag1", name: "magazine", capacity: 3 }],
                            ordnance: [
                                {
                                    id: "sl1",
                                    name: "salvoLauncher",
                                    leftArc: "FP",
                                    numArcs: 3,
                                    magazine: "mag1",
                                },
                            ],
                        },
                        svg: "<symbol viewBox='0 0 1 1'></symbol>",
                        position: { x: 10, y: 10 },
                        facing: 12,
                        speed: 0,
                    },
                ],
            },
        };
        fold = applyCommand(fold, {
            name: "launchOrdnance",
            ship: "S1",
            id: "salvo-1",
            systemId: "sl1",
            position: { x: 12, y: 10 },
            type: "salvo",
            deployedTurn: 1,
        } as never).state;
        const ship = fold.position.objects?.find((o) => o.id === "S1") as {
            ammo?: string[];
        };
        expect(ship?.ammo).toEqual(["mag1"]);
        const ord = fold.position.objects?.find((o) => o.id === "salvo-1") as {
            svg?: string;
            facing?: number;
            salvoCount?: number;
        };
        expect(ord?.svg).toContain('id="salvo-1"');
        expect(ord?.facing).toBe(3);
        expect(ord?.salvoCount).toBe(6);
    });

    it("package round-trips segment and activation mid-sequence", () => {
        const meta = {
            ...DEFAULT_META(),
            phase: 11 as const,
            segment: "resolve" as const,
            activation: { queue: ["S1", "S2"], index: 1 },
            initiative: {
                rolls: [
                    { player: "P1", roll: 2 },
                    { player: "P2", roll: 5 },
                ],
                winner: "P2",
            },
        };
        const position = launchPosition();
        const commands = [
            { name: "advancePhase", phase: 11, turn: 1 },
            { name: "advanceSegment" },
            { name: "declareShipFire", ship: "S1", weapon: "b1", target: "S2" },
        ] as never[];
        const folded = foldCommands(meta, position, commands, 0);
        const pkg = packageFromParts(folded.state.meta, position, commands);
        const parsed = parseGamePackage(JSON.parse(JSON.stringify(pkg)));
        expect(parsed.segment).toBe(folded.state.meta.segment);
        expect(parsed.activation).toEqual(folded.state.meta.activation);
    });

    it("allows declareShipFire for any ship in phase 11 orders", () => {
        let fold: FoldState = {
            meta: {
                ...DEFAULT_META(),
                phase: 11,
                segment: "orders",
                activation: { queue: ["S2", "S1"], index: 0 },
            },
            position: launchPosition(),
        };
        fold = applyCommand(fold, {
            name: "declareShipFire",
            ship: "S1",
            weapon: "b1",
            target: "S2",
        } as never).state;
        expect(fold.pendingFireDeclarations).toHaveLength(1);
        expect((fold.pendingFireDeclarations![0] as { ship?: string }).ship).toBe("S1");
    });

    it("allows declareShipFire in phase 9 for PDS orders", () => {
        let fold: FoldState = {
            meta: { ...DEFAULT_META(), phase: 9 },
            position: launchPosition(),
        };
        fold = applyCommand(fold, {
            name: "declareShipFire",
            ship: "S1",
            weapon: "pds1",
            target: "F1",
            notes: JSON.stringify({ profile: "pds", pdsDice: 2 }),
        } as never).state;
        expect(fold.pendingFireDeclarations).toHaveLength(1);
        expect((fold.pendingFireDeclarations![0] as { weapon?: string }).weapon).toBe("pds1");
    });

    const repairPosition = (): FullThrustGamePosition => ({
        map: { mode: "fixed", width: 72, height: 48 },
        players: [{ id: "P1", colour: "#f00", vp: 0 }],
        objects: [
            {
                objType: "ship",
                id: "S1",
                owner: "P1",
                object: {
                    systems: [{ name: "beam", class: 1, id: "b1" }],
                },
                systems: [{ id: "b1", state: "damaged" }],
                svg: "<symbol viewBox='0 0 1 1'></symbol>",
                position: { x: 1, y: 1 },
                facing: 12,
                speed: 0,
            },
        ] as unknown as FullThrustGamePosition["objects"],
    });

    it("queues declareRepairOrders in phase 14 and clears on resolve", () => {
        let fold: FoldState = {
            meta: {
                ...DEFAULT_META(),
                phase: 14,
                segment: "orders",
                activation: { queue: [], index: 0 },
            },
            position: repairPosition(),
        };
        const notes = JSON.stringify({
            v: 1,
            allocations: [{ targetId: "b1", dcp: 2 }],
        });
        fold = applyCommand(fold, {
            name: "declareRepairOrders",
            ship: "S1",
            notes,
        } as never).state;
        expect(fold.pendingRepairOrders).toHaveLength(1);

        fold = applyCommand(fold, { name: "advanceSegment" } as never).state;
        expect(fold.meta.segment).toBe("resolve");

        fold = applyCommand(fold, {
            name: "resolveRepairOrders",
            ship: "S1",
            rolls: [2],
        } as never).state;
        expect(fold.pendingRepairOrders).toHaveLength(0);
    });

    it("advanceSegment toggles phase 14 orders and resolve without advancing index", () => {
        let fold: FoldState = {
            meta: {
                ...DEFAULT_META(),
                phase: 14,
                segment: "orders",
                activation: { queue: [], index: 0 },
            },
            position: repairPosition(),
        };
        fold = applyCommand(fold, { name: "advanceSegment" } as never).state;
        expect(fold.meta.segment).toBe("resolve");
        expect(fold.meta.activation?.index).toBe(0);
        fold = applyCommand(fold, { name: "advanceSegment" } as never).state;
        expect(fold.meta.segment).toBe("orders");
        expect(fold.meta.activation?.index).toBe(0);
    });

    it("phase 7 advanceSegment does not return from fighter allocation to missile allocation", () => {
        let fold: FoldState = {
            meta: {
                ...DEFAULT_META(),
                phase: 7,
                segment: "resolve",
                activation: { queue: [], index: 0 },
            },
            position: {
                map: { mode: "fixed", width: 72, height: 48 },
                players: [],
                objects: [],
            },
        };
        fold = applyCommand(fold, { name: "advanceSegment" } as never).state;
        expect(fold.meta.segment).toBe("resolve");
    });

    it("phase 7 applies pending ordnance allocations on advanceSegment orders→resolve", () => {
        let fold: FoldState = {
            meta: {
                ...DEFAULT_META(),
                phase: 7,
                segment: "orders",
                activation: { queue: [], index: 0 },
            },
            position: {
                map: { mode: "fixed", width: 72, height: 48 },
                players: [
                    { id: "P1", colour: "#f00" },
                    { id: "P2", colour: "#00f" },
                ],
                objects: [
                    {
                        objType: "ordnance",
                        id: "M1",
                        owner: "P1",
                        type: "missile",
                        position: { x: 0, y: 0 },
                    },
                    {
                        objType: "ship",
                        id: "S2",
                        owner: "P2",
                        position: { x: 3, y: 0 },
                        facing: 12,
                        speed: 0,
                        object: {},
                        svg: "",
                    },
                ],
            },
        };
        fold = applyCommand(fold, { name: "proposeOrdnanceAllocations" } as never).state;
        expect(fold.pendingOrdnanceAllocations?.[0]?.targetShipId).toBe("S2");
        fold = applyCommand(fold, { name: "advanceSegment" } as never).state;
        expect(fold.meta.segment).toBe("resolve");
        expect(fold.pendingOrdnanceAllocations).toEqual([]);
        const ord = fold.position.objects?.find((o) => o.id === "M1") as { targetShip?: string };
        expect(ord?.targetShip).toBe("S2");
    });

    it("keeps attackAllocation through phase 9 and clears leaving phase 9", () => {
        let fold: FoldState = {
            meta: { ...DEFAULT_META(), phase: 7, segment: "resolve", turn: 1 },
            position: {
                map: { mode: "fixed", width: 72, height: 48 },
                players: [{ id: "P1", colour: "#f00" }],
                objects: [
                    {
                        objType: "fighters",
                        id: "FG1",
                        owner: "P1",
                        type: "standard",
                        number: 6,
                        endurance: 6,
                        skill: "standard",
                        position: { x: 0, y: 0 },
                    },
                ],
            },
        };
        fold = applyCommand(fold, {
            name: "declareFighterAttack",
            id: "FG1",
            targetType: "ship",
            targetId: "S1",
        } as never).state;
        const fighter = () =>
            fold.position.objects?.find((o) => o.id === "FG1") as {
                attackAllocation?: { targetId: string };
            };
        expect(fighter().attackAllocation?.targetId).toBe("S1");

        fold = applyCommand(fold, { name: "advancePhase", phase: 8, turn: 1 } as never).state;
        expect(fighter().attackAllocation?.targetId).toBe("S1");

        fold = applyCommand(fold, { name: "advancePhase", phase: 9, turn: 1 } as never).state;
        expect(fighter().attackAllocation?.targetId).toBe("S1");

        fold = applyCommand(fold, { name: "advancePhase", phase: 10, turn: 1 } as never).state;
        expect(fighter().attackAllocation).toBeUndefined();
    });

    it("declarePointDefense apply uses replay commands for furball strike-through threats", () => {
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            players: [
                { id: "P1", colour: "#e41a1c" },
                { id: "P2", colour: "#377eb8" },
            ],
            objects: [
                {
                    objType: "ship" as const,
                    id: "S1",
                    owner: "P1",
                    position: { x: 0, y: 0 },
                    object: { weapons: [{ name: "pds", id: "p1" }] },
                },
                {
                    objType: "fighters" as const,
                    id: "ATK",
                    owner: "P2",
                    type: "standard" as const,
                    number: 6,
                    endurance: 6,
                    skill: "standard" as const,
                    position: { x: 2, y: 0 },
                    facing: 12,
                    attackAllocation: {
                        turn: 1,
                        targetType: "ship" as const,
                        targetId: "S1",
                    },
                },
                {
                    objType: "fighters" as const,
                    id: "SCR",
                    owner: "P1",
                    type: "standard" as const,
                    number: 6,
                    endurance: 6,
                    skill: "standard" as const,
                    position: { x: 1, y: 0 },
                    facing: 12,
                    fighterAttachment: {
                        kind: "screen" as const,
                        targetType: "ship" as const,
                        targetId: "S1",
                    },
                },
            ],
        } as FullThrustGamePosition;
        const replayCommands = [
            { name: "advancePhase", phase: 7, turn: 1 },
            { name: "declareFighterAttack", id: "ATK", targetType: "ship", targetId: "S1" },
            { name: "advancePhase", phase: 8, turn: 1 },
            {
                name: "declareFurball",
                engagement: {
                    attackers: [{ id: "ATK", targetIds: ["S1"] }],
                    defenders: [],
                },
            },
            { name: "resolvePhase8Furballs", rolls: [4, 4, 4] },
            { name: "advancePhase", phase: 9, turn: 1 },
        ] as FullThrustGameCommand[];
        const fold: FoldState = {
            meta: {
                ...DEFAULT_META(),
                phase: 9,
                segment: "orders",
                turn: 1,
                activation: { queue: [], index: 0 },
            },
            position: structuredClone(position) as FullThrustGamePosition,
        };
        const pdCmd = {
            name: "declarePointDefense",
            defenderShip: "S1",
            weapon: "p1",
            supportedShip: "S1",
            threatId: "ATK",
            profile: "pds",
        } as FullThrustGameCommand;

        expect(() => applyCommand(fold, pdCmd)).toThrow(/not a valid incoming threat/);
        const applied = applyCommand(fold, pdCmd, { replayCommands });
        expect(applied.state.phase9PdDeclarations).toHaveLength(1);
        expect(applied.state.phase9PdDeclarations?.[0].threatId).toBe("ATK");
    });

    it("scrub-back shows intermediate state between phase 9 PD mounts", () => {
        let fold: FoldState = {
            meta: {
                ...DEFAULT_META(),
                phase: 9,
                segment: "resolve",
                turn: 1,
                activation: { queue: [], index: 0 },
            },
            position: {
                map: { mode: "fixed", width: 72, height: 48 },
                objects: [
                    {
                        objType: "ship",
                        id: "S1",
                        owner: "P1",
                        position: { x: 0, y: 0 },
                        object: {
                            weapons: [
                                { name: "pds", id: "p1" },
                                { name: "pds", id: "p2" },
                            ],
                        },
                    },
                    {
                        objType: "fighters",
                        id: "F1",
                        owner: "P2",
                        number: 6,
                        position: { x: 1, y: 0 },
                        attackAllocation: { targetId: "S1", targetType: "ship", turn: 1 },
                    },
                ],
            },
            phase9PdDeclarations: [
                {
                    defenderShip: "S1",
                    weapon: "p1",
                    supportedShip: "S1",
                    threatId: "F1",
                    profile: "pds",
                },
                {
                    defenderShip: "S1",
                    weapon: "p2",
                    supportedShip: "S1",
                    threatId: "F1",
                    profile: "pds",
                },
            ],
        };
        const resolveCmds = buildPhase9PdResolveCommands({
            rolls: [5, 5],
            notes: "test",
            allocations: [
                {
                    declaration: fold.phase9PdDeclarations![0],
                    kills: 1,
                    rolls: [5],
                    summary: "mount 1",
                },
                {
                    declaration: fold.phase9PdDeclarations![1],
                    kills: 1,
                    rolls: [5],
                    summary: "mount 2",
                },
            ],
            pdKillsByOrdnance: {},
            survivingFighterAttackers: [],
        });
        for (const cmd of resolveCmds) {
            if (cmd.name === "resolvePhase9Complete") continue;
            fold = applyCommand(fold, cmd as never).state;
            if (cmd.name === "resolvePointDefenseMount" && cmd.weapon === "p1") {
                const f = fold.position.objects?.find((o) => o.id === "F1");
                expect(f?.objType === "fighters" ? f.number : -1).toBe(5);
            }
        }
        const fAfter = fold.position.objects?.find((o) => o.id === "F1");
        expect(fAfter?.objType === "fighters" ? fAfter.number : -1).toBe(4);
    });

    it("marks weapons used on resolveShipFire", () => {
        let fold: FoldState = {
            meta: { ...DEFAULT_META(), phase: 11, segment: "resolve" },
            position: launchPosition(),
            pendingFireDeclarations: [
                {
                    name: "declareShipFire",
                    ship: "S1",
                    weapon: "gat1",
                    target: "S2",
                    notes: JSON.stringify({ profile: "gatlingBd", range: 6 }),
                },
            ] as never[],
        };
        fold = applyCommand(fold, { name: "resolveShipFire", ship: "S1" } as never).state;
        expect(fold.weaponUsedThisTurn?.gat1).toBe("shipFire");
        expect(fold.pendingFireDeclarations).toHaveLength(0);
    });

    it("banks emp hits via command", () => {
        let fold: FoldState = {
            meta: { ...DEFAULT_META(), phase: 11 },
            position: launchPosition(),
        };
        fold = applyCommand(fold, {
            name: "bankEmpHits",
            targetShip: "S2",
            firerShip: "S1",
            weapon: "e1",
            hits: 2,
        } as never).state;
        expect(fold.bankedEmpHits?.S2?.totalHits).toBe(2);
    });

    it("increments empHullRowDrm on hull damage in phase 11", () => {
        const hullShip = {
            objType: "ship" as const,
            id: "T1",
            owner: "P2",
            object: {
                hull: { points: 12, rows: 3 },
                systems: [{ name: "drive", id: "d1" }],
            },
            svg: "<symbol></symbol>",
            position: { x: 0, y: 0 },
            facing: 0,
            speed: 0,
        };
        let fold: FoldState = {
            meta: { ...DEFAULT_META(), phase: 11 },
            position: {
                map: { mode: "fixed", width: 72, height: 48 },
                objects: [hullShip] as never,
            },
        };
        fold = applyCommand(fold, {
            name: "dmgShip",
            ship: "T1",
            hull: 4,
        } as never).state;
        const ship = fold.position.objects!.find((o) => o.id === "T1") as { empHullRowDrm?: number };
        expect(ship.empHullRowDrm).toBe(1);
    });

    it("clears empHullRowDrm when turn wraps", () => {
        const hullShip = {
            objType: "ship" as const,
            id: "T1",
            owner: "P2",
            empHullRowDrm: 2,
            object: { hull: { points: 12, rows: 3 }, systems: [] },
            svg: "<symbol></symbol>",
            position: { x: 0, y: 0 },
            facing: 0,
            speed: 0,
        };
        let fold: FoldState = {
            meta: { ...DEFAULT_META(), phase: 15, turn: 1 },
            position: {
                map: { mode: "fixed", width: 72, height: 48 },
                objects: [hullShip] as never,
            },
        };
        fold = applyCommand(fold, { name: "advancePhase" } as never).state;
        const ship = fold.position.objects!.find((o) => o.id === "T1") as { empHullRowDrm?: number };
        expect(ship.empHullRowDrm).toBeUndefined();
        expect(fold.meta.turn).toBe(2);
    });

    it("queues and declares transporter marine delivery", () => {
        const validTacoma = `{"hull":{"points":15,"rows":4},"systems":[{"name":"drive","id":"d1"},{"name":"marines","id":"F1-m1"},{"name":"marines","id":"F1-m2"}],"weapons":[],"mass":50}`;
        const baseShip = (id: string, owner: string) => ({
            objType: "ship" as const,
            id,
            owner,
            object: JSON.parse(validTacoma),
            svg: "<symbol></symbol>",
            position: { x: 0, y: 0 },
            facing: 0,
            speed: 0,
        });
        let fold: FoldState = {
            meta: { ...DEFAULT_META(), phase: 11 },
            position: {
                map: { mode: "fixed", width: 72, height: 48 },
                objects: [baseShip("F1", "P1"), baseShip("T1", "P2")] as never,
            },
        };
        fold = applyCommand(fold, {
            name: "queueTransporterDelivery",
            firerShip: "F1",
            targetShip: "T1",
            weapon: "tr1",
            hits: 1,
        } as never).state;
        expect(fold.pendingTransporterDeliveries?.[0]?.remaining).toBe(1);
        fold = applyCommand(fold, {
            name: "declareTransporterDelivery",
            firerShip: "F1",
            targetShip: "T1",
            weapon: "tr1",
            attackerOwner: "P1",
            choice: { mode: "boarding", payload: "marine" },
        } as never).state;
        expect(fold.pendingTransporterDeliveries ?? []).toHaveLength(0);
        const target = fold.position.objects!.find((o) => o.id === "T1") as {
            boarders?: { units?: { type: string; fromShip?: string }[] };
        };
        expect(target.boarders?.units?.filter((u) => u.type === "marine")).toHaveLength(1);
        expect(target.boarders?.units?.[0]?.fromShip).toBe("F1");
    });

    it("blocks advanceSegment when transporter deliveries remain in phase 11 resolve", () => {
        let fold: FoldState = {
            meta: { ...DEFAULT_META(), phase: 11, segment: "resolve" },
            position: { map: { mode: "fixed", width: 72, height: 48 } },
            pendingTransporterDeliveries: [
                { firerShipId: "F1", targetShipId: "T1", weaponId: "tr1", remaining: 1 },
            ],
        };
        expect(() => applyCommand(fold, { name: "advanceSegment" } as never)).toThrow(
            /Transporter delivery pending/
        );
    });
});
