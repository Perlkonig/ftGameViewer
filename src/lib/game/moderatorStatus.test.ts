import { describe, expect, it } from "vitest";
import { DEFAULT_META } from "./types";
import {
    buildModeratorStatus,
    commandActingPlayer,
    commandsInCurrentPhaseSegment,
    playersWhoActedInPhase,
} from "./moderatorStatus";
import type { FullThrustGameCommand } from "@/schemas/commands";
import { foldCommands } from "./applyCommand";
import type { FullThrustGamePosition } from "@/schemas/position";

const emptyPosition = (): FullThrustGamePosition => ({
    map: { mode: "fixed", width: 72, height: 48 },
    players: [
        { id: "P1", colour: "#f00", vp: 0 },
        { id: "P2", colour: "#00f", vp: 0 },
    ],
    objects: [
        {
            objType: "ship",
            id: "S1",
            owner: "P2",
            object: { systems: [{ name: "Salvo-1", id: "sys1" }] },
            svg: "<symbol viewBox='0 0 1 1'></symbol>",
            position: { x: 1, y: 1 },
            facing: 12,
            speed: 0,
        },
        {
            objType: "ship",
            id: "S2",
            owner: "P1",
            object: { systems: [{ name: "Salvo-1", id: "sys2" }] },
            svg: "<symbol viewBox='0 0 1 1'></symbol>",
            position: { x: 2, y: 2 },
            facing: 12,
            speed: 0,
        },
    ],
} as unknown as FullThrustGamePosition);

describe("moderatorStatus", () => {
    it("hints for current ship activation in phase 3 orders segment", () => {
        const packageMeta = DEFAULT_META();
        const position = emptyPosition();
        const initiative = {
            rolls: [
                { player: "P1", roll: 2 },
                { player: "P2", roll: 5 },
            ],
            winner: "P2",
        };

        const status = buildModeratorStatus({
            meta: {
                ...packageMeta,
                turn: 1,
                phase: 3,
                initiative,
                segment: "orders",
                activation: { queue: ["S2", "S1"], index: 0 },
            },
            position,
            playerIds: ["P1", "P2"],
            packageMeta,
            initialPosition: emptyPosition(),
            commands: [],
        });

        expect(status.currentActivationId).toBe("S2");
        expect(status.hints.some((h) => h.includes("launch orders for S2"))).toBe(true);
    });

    it("lists possible launches for ordnance and fighter carriers in phase 3", () => {
        const packageMeta = DEFAULT_META();
        const position = emptyPosition();
        const ordnanceShip = position.objects!.find((o) => o.id === "S2")!;
        (ordnanceShip as { object: Record<string, unknown> }).object = {
            systems: [{ name: "Salvo-1", id: "sys2" }],
            ordnance: [{ name: "missile", id: "m1", shots: 2 }],
        };
        position.objects!.push({
            objType: "ship",
            id: "S3",
            owner: "P1",
            object: { systems: [{ name: "hangar", id: "h1", fighters: 6 }] },
            hangars: { h1: { occupied: true, deployed: false } },
            svg: "<symbol viewBox='0 0 1 1'></symbol>",
            position: { x: 3, y: 3 },
            facing: 12,
            speed: 0,
        } as never);
        position.objects!.push({
            objType: "fighters",
            id: "F1",
            owner: "P1",
            type: "standard",
            position: { ship: "S3", hangar: "h1" },
            number: 6,
            endurance: 6,
            skill: "standard",
        } as never);

        const status = buildModeratorStatus({
            meta: {
                ...packageMeta,
                turn: 1,
                phase: 3,
                initiative: {
                    rolls: [
                        { player: "P1", roll: 2 },
                        { player: "P2", roll: 5 },
                    ],
                    winner: "P2",
                },
                segment: "orders",
                activation: { queue: ["S2", "S3"], index: 0 },
            },
            position,
            playerIds: ["P1", "P2"],
            packageMeta,
            initialPosition: emptyPosition(),
            commands: [],
        });

        expect(
            status.hints.some(
                (h) =>
                    h.includes("Possible launches") &&
                    h.includes("S2 (ordnance)") &&
                    h.includes("S3 (fighters")
            )
        ).toBe(true);
    });

    it("suggests advancing when all segment activations complete", () => {
        const packageMeta = DEFAULT_META();
        const position = emptyPosition();

        const status = buildModeratorStatus({
            meta: {
                ...packageMeta,
                turn: 1,
                phase: 3,
                initiative: {
                    rolls: [
                        { player: "P1", roll: 2 },
                        { player: "P2", roll: 5 },
                    ],
                    winner: "P2",
                },
                segment: "orders",
                activation: { queue: ["S2", "S1"], index: 2 },
            },
            position,
            playerIds: ["P1", "P2"],
            packageMeta,
            initialPosition: emptyPosition(),
            commands: [],
        });

        expect(status.hints.some((h) => h.includes("advance phase"))).toBe(true);
    });

    it("phase 11 orders does not imply a mandatory ship activation order", () => {
        const packageMeta = DEFAULT_META();
        const position = emptyPosition();

        const status = buildModeratorStatus({
            meta: {
                ...packageMeta,
                turn: 1,
                phase: 11,
                initiative: {
                    rolls: [
                        { player: "P1", roll: 2 },
                        { player: "P2", roll: 5 },
                    ],
                    winner: "P2",
                },
                segment: "orders",
                activation: { queue: ["S2", "S1"], index: 0 },
            },
            position,
            playerIds: ["P1", "P2"],
            packageMeta,
            initialPosition: emptyPosition(),
            commands: [],
        });

        expect(status.currentActivationId).toBeUndefined();
        expect(status.activationLabel).toBe("player sequence (winner first)");
        expect(status.hints.some((h) => h.includes("ship order is not required"))).toBe(true);
        expect(status.hints.some((h) => h.includes("Player sequence"))).toBe(false);
        expect(status.hints.some((h) => h.includes("Optional Next-step resolve order"))).toBe(
            false
        );
        expect(status.hints.some((h) => h.includes("Ships awaiting activation — P2: S1; P1: S2"))).toBe(
            true
        );
        expect(status.hints.some((h) => h.includes("Resolve order (winner first)"))).toBe(false);
        expect(status.hints.some((h) => h.includes("Expecting fire declarations"))).toBe(false);
    });

    it("phase 11 orders excludes declared ships and advances to next player", () => {
        const packageMeta = DEFAULT_META();
        const position = emptyPosition();
        const commands: FullThrustGameCommand[] = [
            { name: "advancePhase", phase: 11, turn: 1 },
            { name: "declareShipFire", ship: "S2", weapon: "b1", target: "S1" },
        ];

        const status = buildModeratorStatus({
            meta: {
                ...packageMeta,
                turn: 1,
                phase: 11,
                initiative: {
                    rolls: [
                        { player: "P1", roll: 2 },
                        { player: "P2", roll: 5 },
                    ],
                    winner: "P2",
                },
                segment: "orders",
                activation: { queue: ["S2", "S1"], index: 0 },
            },
            position,
            playerIds: ["P1", "P2"],
            packageMeta,
            initialPosition: emptyPosition(),
            commands,
            pendingFireDeclarations: commands.filter((c) => c.name === "declareShipFire"),
        });

        const awaitingHint = status.hints.find((h) => h.startsWith("Ships awaiting activation"));
        expect(awaitingHint).toContain("P2: S1");
        expect(awaitingHint).not.toContain("S2");
    });

    it("phase 11 resolve hints when next player still needs orders", () => {
        const packageMeta = DEFAULT_META();
        const position = emptyPosition();
        const commands: FullThrustGameCommand[] = [
            { name: "advancePhase", phase: 11, turn: 1 },
            { name: "declareShipFire", ship: "S1", weapon: "b1", target: "S2" },
            { name: "resolveShipFire", ship: "S1" },
            { name: "advanceSegment" },
        ];

        const folded = foldCommands(packageMeta, position, commands, 0);
        const status = buildModeratorStatus({
            meta: {
                ...folded.state.meta,
                segment: "resolve",
                initiative: {
                    rolls: [
                        { player: "P1", roll: 2 },
                        { player: "P2", roll: 5 },
                    ],
                    winner: "P2",
                },
                activation: { queue: ["S1", "S2"], index: 0 },
            },
            position: folded.state.position,
            playerIds: ["P1", "P2"],
            packageMeta,
            initialPosition: emptyPosition(),
            commands,
            pendingFireDeclarations: folded.state.pendingFireDeclarations,
        });

        expect(status.hints.some((h) => h.includes("More orders needed"))).toBe(true);
        expect(status.hints.some((h) => h.includes("P1: S2"))).toBe(true);
        expect(
            status.hints.some((h) => h.includes("No pending fire declarations — skip resolve"))
        ).toBe(false);
    });

    it("phase 11 resolve to orders does not advance activation index", () => {
        const packageMeta = DEFAULT_META();
        const position = emptyPosition();
        const commands: FullThrustGameCommand[] = [
            { name: "advancePhase", phase: 11, turn: 1 },
            { name: "advanceSegment" },
            { name: "advanceSegment" },
        ];

        const folded = foldCommands(packageMeta, position, commands, 0);
        expect(folded.state.meta.segment).toBe("orders");
        expect(folded.state.meta.activation?.index).toBe(0);
    });

    it("resolves command owners from ship id", () => {
        const position = emptyPosition();
        expect(
            commandActingPlayer(
                { name: "moveShip", id: "S1", position: { x: 1, y: 1 }, facing: 12, speed: 1 },
                position
            )
        ).toBe("P2");
    });

    it("slices commands for the current phase segment", () => {
        const packageMeta = DEFAULT_META();
        const initial = emptyPosition();
        const commands: FullThrustGameCommand[] = [
            { name: "setInitiative", rolls: [{ player: "P1", roll: 4 }], winner: "P1" },
        ];
        const slice = commandsInCurrentPhaseSegment(
            commands,
            { turn: 1, phase: 1 },
            packageMeta,
            initial
        );
        expect(slice.map((c) => c.name)).toEqual(["setInitiative"]);
    });

    it("slices phase 12 commands when package header is at phase 12", () => {
        const initial = emptyPosition();
        const commands: FullThrustGameCommand[] = [
            { name: "advancePhase", phase: 12, turn: 1 },
            {
                name: "declareBoardingAttackerOrders",
                ship: "S2",
                notes: JSON.stringify({
                    v: 2,
                    attackerOwner: "P1",
                    unitAllocations: [],
                }),
            },
        ];
        const headerMeta = {
            ...DEFAULT_META(),
            turn: 1,
            phase: 12 as const,
            segment: "orders" as const,
            boardingStep: "attacker" as const,
        };
        const slice = commandsInCurrentPhaseSegment(
            commands,
            { turn: 1, phase: 12 },
            headerMeta,
            initial
        );
        expect(slice.map((c) => c.name)).toEqual(["declareBoardingAttackerOrders"]);
    });

    it("counts acted players in phase", () => {
        const position = emptyPosition();
        const cmds = [
            {
                name: "launchOrdnance",
                ship: "S1",
                id: "m1",
                systemId: "s",
                position: { x: 0, y: 0 },
                type: "missile",
            },
        ] as FullThrustGameCommand[];
        const acted = playersWhoActedInPhase([...cmds], 3, position);
        expect([...acted]).toEqual(["P2"]);
    });

    const repairPosition = (): FullThrustGamePosition => ({
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
                object: { systems: [{ name: "beam", class: 1, id: "b1" }] },
                systems: [{ id: "b1", state: "damaged" }],
                svg: "<symbol viewBox='0 0 1 1'></symbol>",
                position: { x: 1, y: 1 },
                facing: 12,
                speed: 0,
            },
            {
                objType: "ship",
                id: "S2",
                owner: "P2",
                object: { armour: [[0, 2]] },
                dmgArmour: [{ regenerative: 1 }],
                svg: "<symbol viewBox='0 0 1 1'></symbol>",
                position: { x: 2, y: 2 },
                facing: 12,
                speed: 0,
            },
        ] as unknown as FullThrustGamePosition["objects"],
    });

    it("phase 14 hints undeclared repair ships and omits declared", () => {
        const packageMeta = DEFAULT_META();
        const position = repairPosition();
        const commands: FullThrustGameCommand[] = [
            { name: "advancePhase", phase: 14, turn: 1 },
            {
                name: "declareRepairOrders",
                ship: "S1",
                notes: JSON.stringify({ v: 1, allocations: [{ targetId: "b1", dcp: 1 }] }),
            },
        ];
        const folded = foldCommands(packageMeta, position, commands, 0);
        const status = buildModeratorStatus({
            meta: {
                ...folded.state.meta,
                segment: "orders",
                activation: { queue: [], index: 0 },
            },
            position: folded.state.position,
            playerIds: ["P1", "P2"],
            packageMeta,
            initialPosition: repairPosition(),
            commands,
            pendingRepairOrders: folded.state.pendingRepairOrders,
        });
        expect(status.hints.some((h) => h.includes("Ships awaiting repair orders"))).toBe(true);
        expect(status.hints.some((h) => h.includes("S2") && h.includes("regenerative armour"))).toBe(
            true
        );
        expect(status.hints.some((h) => h.includes("S1") && h.includes("awaiting"))).toBe(false);
    });

    it("phase 14 suggests advance when nothing needs repair", () => {
        const packageMeta = DEFAULT_META();
        const position = emptyPosition();
        const status = buildModeratorStatus({
            meta: { ...packageMeta, turn: 1, phase: 14 },
            position,
            playerIds: ["P1", "P2"],
            packageMeta,
            initialPosition: position,
            commands: [],
        });
        expect(status.hints.some((h) => h.includes("No ships need repair"))).toBe(true);
    });

    it("phase 14 warns on duplicate repair declares", () => {
        const packageMeta = DEFAULT_META();
        const position = repairPosition();
        const notes = JSON.stringify({ v: 1, allocations: [{ targetId: "b1", dcp: 1 }] });
        const commands: FullThrustGameCommand[] = [
            { name: "advancePhase", phase: 14, turn: 1 },
            { name: "declareRepairOrders", ship: "S1", notes },
            { name: "declareRepairOrders", ship: "S1", notes },
        ];
        const folded = foldCommands(packageMeta, position, commands, 0);
        const status = buildModeratorStatus({
            meta: {
                ...folded.state.meta,
                segment: "orders",
                activation: { queue: [], index: 0 },
            },
            position: folded.state.position,
            playerIds: ["P1", "P2"],
            packageMeta,
            initialPosition: repairPosition(),
            commands,
            pendingRepairOrders: folded.state.pendingRepairOrders,
        });
        expect(
            status.hints.some((h) => h.includes("Multiple repair orders for S1"))
        ).toBe(true);
    });

    it("phase 14 does not warn duplicate when only one declare in log", () => {
        const packageMeta = DEFAULT_META();
        const position: FullThrustGamePosition = {
            map: { mode: "fixed", width: 72, height: 48 },
            players: [{ id: "P1", colour: "#f00", vp: 0 }],
            objects: [
                {
                    objType: "ship",
                    id: "S1",
                    owner: "P1",
                    object: { systems: [{ name: "beam", class: 1, id: "b1" }] },
                    systems: [{ id: "b1", state: "damaged" }],
                    svg: "<symbol viewBox='0 0 1 1'></symbol>",
                    position: { x: 1, y: 1 },
                    facing: 12,
                    speed: 0,
                },
            ] as unknown as FullThrustGamePosition["objects"],
        };
        const notes = JSON.stringify({ v: 1, allocations: [{ targetId: "b1", dcp: 1 }] });
        const commands: FullThrustGameCommand[] = [
            { name: "advancePhase", phase: 14, turn: 1 },
            { name: "declareRepairOrders", ship: "S1", notes },
        ];
        const folded = foldCommands(packageMeta, position, commands, 0);
        const status = buildModeratorStatus({
            meta: {
                ...folded.state.meta,
                segment: "orders",
                activation: { queue: [], index: 0 },
            },
            position: folded.state.position,
            playerIds: ["P1"],
            packageMeta,
            initialPosition: position,
            commands,
            pendingRepairOrders: folded.state.pendingRepairOrders,
        });
        expect(
            status.hints.some((h) => h.includes("Multiple repair orders"))
        ).toBe(false);
        expect(status.hints.some((h) => h.includes("All repair orders received"))).toBe(true);
    });

    it("hints for pending minelayer placements in phase 5", () => {
        const packageMeta = DEFAULT_META();
        const position = emptyPosition();
        const status = buildModeratorStatus({
            meta: { ...packageMeta, turn: 1, phase: 5 },
            position,
            playerIds: ["P1", "P2"],
            packageMeta,
            initialPosition: position,
            commands: [],
            pendingMoves: [
                {
                    name: "moveShip",
                    id: "S1",
                    deployMineLayers: ["ml1"],
                } as FullThrustGameCommand,
            ],
        });
        expect(status.hints.some((h) => h.includes("minelayer placement"))).toBe(true);
    });

    it("phase 7 hints show missile then fighter allocation segments", () => {
        const packageMeta = DEFAULT_META();
        const position: FullThrustGamePosition = {
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
                    objType: "fighters",
                    id: "FG1",
                    owner: "P1",
                    type: "standard",
                    number: 6,
                    endurance: 6,
                    skill: "standard",
                    position: { x: 1, y: 0 },
                    facing: 12,
                },
            ],
        };
        const meta = {
            ...packageMeta,
            turn: 1,
            phase: 7 as const,
            segment: "orders" as const,
            activation: { queue: [], index: 0 },
        };
        const statusOrders = buildModeratorStatus({
            meta,
            position,
            playerIds: ["P1", "P2"],
            packageMeta,
            initialPosition: position,
            commands: [],
            pendingOrdnanceAllocations: [
                { ordnanceId: "M1", action: "skip", proposed: true },
            ],
        });
        expect(statusOrders.segment).toBe("Missile allocation");
        expect(statusOrders.hints.some((h) => h.includes("proposed automatically"))).toBe(true);

        const statusResolve = buildModeratorStatus({
            meta: { ...meta, segment: "resolve" },
            position,
            playerIds: ["P1", "P2"],
            packageMeta,
            initialPosition: position,
            commands: [],
        });
        expect(statusResolve.segment).toBe("Fighter allocation");
        expect(statusResolve.hints.some((h) => h.includes("6 MU"))).toBe(true);
    });

    it("phase 8 hints use fighter callsigns when available", () => {
        const packageMeta = DEFAULT_META();
        const position: FullThrustGamePosition = {
            map: { mode: "fixed", width: 72, height: 48 },
            players: [
                { id: "P1", colour: "#f00" },
                { id: "P2", colour: "#00f" },
            ],
            objects: [
                {
                    objType: "fighters",
                    id: "FG1",
                    owner: "P1",
                    callsign: "Red Wing",
                    type: "standard",
                    number: 6,
                    endurance: 6,
                    skill: "standard",
                    position: { x: 0, y: 0 },
                    facing: 12,
                    attackAllocation: {
                        turn: 1,
                        targetType: "fighters",
                        targetId: "FG2",
                    },
                },
                {
                    objType: "fighters",
                    id: "FG2",
                    owner: "P2",
                    callsign: "Blue Wing",
                    type: "standard",
                    number: 6,
                    endurance: 6,
                    skill: "standard",
                    position: { x: 1, y: 0 },
                    facing: 12,
                },
            ],
        };
        const status = buildModeratorStatus({
            meta: {
                ...packageMeta,
                turn: 1,
                phase: 8,
                segment: "orders",
                activation: { queue: [], index: 0 },
            },
            position,
            playerIds: ["P1", "P2"],
            packageMeta,
            initialPosition: position,
            commands: [],
            phase8FurballDeclarations: [],
        });
        expect(
            status.hints.some((h) => h.includes("Red Wing") && h.includes("Blue Wing"))
        ).toBe(true);
        expect(status.hints.some((h) => h.includes("FG1") || h.includes("FG2"))).toBe(false);
    });

    it("phase 9 moderator hints tolerate PD declarations without crashing threat board", () => {
        const packageMeta = DEFAULT_META();
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            players: [
                { id: "Player 1", colour: "#e41a1c" },
                { id: "Player 2", colour: "#377eb8" },
            ],
            objects: [
                {
                    objType: "ship" as const,
                    id: "A1",
                    owner: "Player 1",
                    position: { x: 0, y: 0 },
                    object: { weapons: [{ name: "pds", id: "p1" }] },
                },
                {
                    objType: "fighters" as const,
                    id: "B1_I4LWH",
                    owner: "Player 2",
                    type: "standard" as const,
                    number: 4,
                    endurance: 6,
                    skill: "standard" as const,
                    position: { x: 2, y: 0 },
                    facing: 9,
                    attackAllocation: {
                        turn: 1,
                        targetType: "ship" as const,
                        targetId: "A1",
                    },
                },
            ],
        };
        const status = buildModeratorStatus({
            meta: {
                ...packageMeta,
                turn: 1,
                phase: 9,
                segment: "orders",
                activation: { queue: [], index: 0 },
            },
            position,
            playerIds: ["Player 1", "Player 2"],
            packageMeta,
            initialPosition: position,
            commands: [
                {
                    name: "declareFurball",
                    engagement: {
                        attackers: [{ id: "B1_I4LWH", targetIds: ["A1"] }],
                        defenders: [],
                    },
                },
            ] as never[],
            phase8FurballDeclarations: [],
            phase9PdDeclarations: [
                {
                    defenderShip: "A1",
                    weapon: "p1",
                    supportedShip: "A1",
                    threatId: "B1_I4LWH",
                    profile: "pds",
                },
            ],
        });
        expect(status.hints.some((h) => h.includes("Point defense"))).toBe(true);
    });

    it("phase 10 hints describe auto-resolve instead of collecting orders", () => {
        const packageMeta = DEFAULT_META();
        const position = {
            map: { mode: "fixed" as const, width: 72, height: 48 },
            players: [
                { id: "Player 1", colour: "#e41a1c" },
                { id: "Player 2", colour: "#377eb8" },
            ],
            objects: [
                {
                    objType: "ship" as const,
                    id: "S1",
                    owner: "Player 1",
                    position: { x: 0, y: 0 },
                    object: {},
                },
            ],
        };
        const base = {
            meta: {
                ...packageMeta,
                turn: 1,
                phase: 10 as const,
                activation: { queue: [], index: 0 },
            },
            position,
            playerIds: ["Player 1", "Player 2"],
            packageMeta,
            initialPosition: position,
        };
        const pending = buildModeratorStatus({
            ...base,
            commands: [] as never[],
        });
        expect(pending.hints.some((h) => h.includes("automatically"))).toBe(true);
        expect(pending.hints.some((h) => h.includes("collect"))).toBe(false);

        const resolved = buildModeratorStatus({
            ...base,
            commands: [
                { name: "advancePhase", phase: 10, turn: 1 },
                { name: "resolvePhase10Complete", count: 0 },
            ] as never[],
        });
        expect(resolved.hints.some((h) => h.includes("strikes resolved"))).toBe(true);
        expect(resolved.hints.some((h) => h.includes("collect"))).toBe(false);
    });
});
