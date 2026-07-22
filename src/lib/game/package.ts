import type { FullThrustGameCommand } from "@/schemas/commands";
import type { FullThrustGamePosition } from "@/schemas/position";
import type { DicePolicy, FleetLimit, GameMeta, GamePhase, InitiativeState, ActivationCursor, PhaseSegment } from "./types";
import { DEFAULT_META, migrateLegacyPhase } from "./types";
import {
    FLUID_DEFAULT_BUFFER,
    FLUID_DEFAULT_HEIGHT,
    FLUID_DEFAULT_WIDTH,
} from "./fluidMapBounds";

export type GamePlayer = {
    id: string;
    colour: string;
    vp?: number;
};

export type GameMap = NonNullable<FullThrustGamePosition["map"]>;

export interface GamePackage {
    version: string;
    name: string;
    createdAt: string;
    turn: number;
    phase: GamePhase;
    initiative?: InitiativeState;
    dicePolicy: DicePolicy;
    diceSeed?: string;
    fleetLimits?: FleetLimit[];
    allowVectorMovement?: boolean;
    includeCoreSystemsInThreshold?: boolean;
    reactorBreachesEnabled?: boolean;
    segment?: PhaseSegment;
    activation?: ActivationCursor;
    map: GameMap;
    players: GamePlayer[];
    initialState: FullThrustGamePosition;
    commands: FullThrustGameCommand[];
}

export interface NewGameSetup {
    name: string;
    dicePolicy: DicePolicy;
    map: GameMap;
    players: GamePlayer[];
    fleetLimits?: FleetLimit[];
    allowVectorMovement?: boolean;
    includeCoreSystemsInThreshold?: boolean;
    reactorBreachesEnabled?: boolean;
}

export interface CommandBundle {
    version: string;
    gameName?: string;
    playerId?: string;
    createdAt: string;
    commands: FullThrustGameCommand[];
    notes?: string;
}

/** Build initialState from package-level setup fields. */
export function initialStateFromSetup(
    map: GameMap,
    players: GamePlayer[]
): FullThrustGamePosition {
    return {
        map,
        players: players.map((p) => ({ ...p, vp: p.vp ?? 0 })) as FullThrustGamePosition["players"],
        objects: [],
    };
}

export function createNewPackage(setup: NewGameSetup): GamePackage {
    const meta = DEFAULT_META();
    const players = setup.players.map((p) => ({ ...p, vp: p.vp ?? 0 }));
    return {
        ...meta,
        name: setup.name.trim() || "Untitled Game",
        dicePolicy: setup.dicePolicy,
        fleetLimits: setup.fleetLimits,
        allowVectorMovement: setup.allowVectorMovement ?? false,
        includeCoreSystemsInThreshold: setup.includeCoreSystemsInThreshold ?? true,
        reactorBreachesEnabled: setup.reactorBreachesEnabled ?? true,
        map: setup.map,
        players,
        initialState: initialStateFromSetup(setup.map, players),
        commands: [],
    };
}

/** @deprecated Use createNewPackage with full setup. */
export function createEmptyPackage(name = "Untitled Game"): GamePackage {
    return createNewPackage({
        name,
        dicePolicy: "hybrid",
        map: { mode: "fixed", width: 72, height: 48 },
        players: [{ id: "Player 1", colour: "#e41a1c", vp: 0 }],
    });
}

export function packageFromParts(
    meta: GameMeta,
    initialState: FullThrustGamePosition,
    commands: FullThrustGameCommand[]
): GamePackage {
    const map = initialState.map ?? { mode: "fixed" as const, width: 72, height: 48 };
    const players =
        initialState.players?.map((p) => ({
            id: p.id,
            colour: p.colour,
            vp: p.vp ?? 0,
        })) ?? [{ id: "Player 1", colour: "#e41a1c", vp: 0 }];

    return {
        version: meta.version,
        name: meta.name,
        createdAt: meta.createdAt,
        turn: meta.turn,
        phase: meta.phase,
        initiative: meta.initiative,
        dicePolicy: meta.dicePolicy,
        diceSeed: meta.diceSeed,
        fleetLimits: meta.fleetLimits,
        allowVectorMovement: meta.allowVectorMovement ?? false,
        includeCoreSystemsInThreshold: meta.includeCoreSystemsInThreshold ?? true,
        reactorBreachesEnabled: meta.reactorBreachesEnabled ?? true,
        segment: meta.segment,
        activation: meta.activation,
        map,
        players,
        initialState,
        commands,
    };
}

export function metaFromPackage(pkg: GamePackage): GameMeta {
    return {
        version: pkg.version,
        name: pkg.name,
        createdAt: pkg.createdAt,
        turn: pkg.turn,
        phase: migrateLegacyPhase(pkg.phase),
        initiative: pkg.initiative,
        dicePolicy: pkg.dicePolicy,
        diceSeed: pkg.diceSeed,
        fleetLimits: pkg.fleetLimits,
        allowVectorMovement: pkg.allowVectorMovement,
        includeCoreSystemsInThreshold: pkg.includeCoreSystemsInThreshold,
        reactorBreachesEnabled: pkg.reactorBreachesEnabled,
        segment: pkg.segment,
        activation: pkg.activation,
    };
}

function migrateCommandsPhase(cmds: FullThrustGameCommand[]): FullThrustGameCommand[] {
    return cmds.map((cmd) => {
        if (cmd.name !== "advancePhase") return cmd;
        const c = cmd as { phase?: number; turn?: number };
        if (typeof c.phase === "number" && c.phase <= 14 && c.phase >= 0) {
            return { ...cmd, phase: migrateLegacyPhase(c.phase) } as FullThrustGameCommand;
        }
        return cmd;
    });
}

function normalizeFluidMap(map: Record<string, unknown>): GameMap {
    return {
        mode: "fluid",
        width:
            typeof map.width === "number" && map.width >= 1
                ? map.width
                : FLUID_DEFAULT_WIDTH,
        height:
            typeof map.height === "number" && map.height >= 1
                ? map.height
                : FLUID_DEFAULT_HEIGHT,
        buffer:
            typeof map.buffer === "number" && map.buffer >= 0 && map.buffer <= 48
                ? map.buffer
                : FLUID_DEFAULT_BUFFER,
    };
}

function normalizeMap(raw: unknown, initialState: FullThrustGamePosition): GameMap {
    if (raw !== null && typeof raw === "object" && "mode" in (raw as object)) {
        const map = raw as Record<string, unknown>;
        if (map.mode === "fluid") return normalizeFluidMap(map);
        return raw as GameMap;
    }
    if (initialState.map) {
        if (initialState.map.mode === "fluid") {
            return normalizeFluidMap(initialState.map as Record<string, unknown>);
        }
        return initialState.map;
    }
    return { mode: "fixed", width: 72, height: 48 };
}

function normalizePlayers(raw: unknown, initialState: FullThrustGamePosition): GamePlayer[] {
    if (Array.isArray(raw) && raw.length > 0) {
        return raw as GamePlayer[];
    }
    if (initialState.players?.length) {
        return initialState.players.map((p) => ({
            id: p.id,
            colour: p.colour,
            vp: p.vp ?? 0,
        }));
    }
    throw new Error("Game must define players");
}

export function parseGamePackage(raw: unknown): GamePackage {
    if (raw === null || typeof raw !== "object") {
        throw new Error("Game file must be an object");
    }
    const o = raw as Record<string, unknown>;
    if (typeof o.version !== "string") throw new Error("Missing game version");
    if (typeof o.name !== "string") throw new Error("Missing game name");
    if (typeof o.createdAt !== "string") throw new Error("Missing createdAt");
    if (typeof o.turn !== "number") throw new Error("Missing turn");
    if (typeof o.phase !== "number") throw new Error("Invalid phase");
    const rawPhase = o.phase as number;
    const phase =
        rawPhase >= 1 && rawPhase <= 15
            ? (rawPhase as GamePhase)
            : migrateLegacyPhase(rawPhase);
    if (o.dicePolicy !== "client" && o.dicePolicy !== "moderatorSequence" && o.dicePolicy !== "hybrid") {
        throw new Error("Invalid dicePolicy");
    }
    if (o.initialState === null || typeof o.initialState !== "object") {
        throw new Error("Missing initialState");
    }
    if (!Array.isArray(o.commands)) throw new Error("Missing commands array");

    const initialState = o.initialState as FullThrustGamePosition;
    const map = normalizeMap(o.map, initialState);
    const players = normalizePlayers(o.players, initialState);

    // Keep initialState aligned with package-level setup when loading older saves.
    if (!initialState.map) initialState.map = map;
    if (!initialState.players?.length) {
        initialState.players = players as FullThrustGamePosition["players"];
    }

    return {
        version: o.version,
        name: o.name,
        createdAt: o.createdAt,
        turn: o.turn,
        phase,
        initiative: o.initiative as InitiativeState | undefined,
        dicePolicy: o.dicePolicy,
        diceSeed: typeof o.diceSeed === "string" ? o.diceSeed : undefined,
        fleetLimits: o.fleetLimits as FleetLimit[] | undefined,
        allowVectorMovement:
            typeof o.allowVectorMovement === "boolean" ? o.allowVectorMovement : false,
        includeCoreSystemsInThreshold:
            typeof o.includeCoreSystemsInThreshold === "boolean"
                ? o.includeCoreSystemsInThreshold
                : true,
        reactorBreachesEnabled:
            typeof o.reactorBreachesEnabled === "boolean" ? o.reactorBreachesEnabled : true,
        segment:
            o.segment === "orders" || o.segment === "resolve"
                ? o.segment
                : undefined,
        activation:
            o.activation !== null &&
            typeof o.activation === "object" &&
            Array.isArray((o.activation as ActivationCursor).queue)
                ? (o.activation as ActivationCursor)
                : undefined,
        map,
        players,
        initialState,
        commands: migrateCommandsPhase(o.commands as FullThrustGameCommand[]),
    };
}

/** Accept full package or legacy `{ initialState, commands }` working save. */
export function parseLoadable(raw: unknown): GamePackage {
    if (raw === null || typeof raw !== "object") {
        throw new Error("Invalid save data");
    }
    const o = raw as Record<string, unknown>;
    if (typeof o.version === "string" && typeof o.name === "string") {
        return parseGamePackage(raw);
    }
    if (o.initialState !== undefined && Array.isArray(o.commands)) {
        const initialState = o.initialState as FullThrustGamePosition;
        const map = normalizeMap(o.map, initialState);
        const players = normalizePlayers(o.players, initialState);
        const pkg = createNewPackage({
            name: "Loaded Game",
            dicePolicy: "hybrid",
            map,
            players,
        });
        pkg.initialState = initialState;
        pkg.commands = migrateCommandsPhase(o.commands as FullThrustGameCommand[]);
        return pkg;
    }
    throw new Error("Unrecognized save format");
}

export function parseCommandBundle(raw: unknown): CommandBundle {
    if (raw === null || typeof raw !== "object") {
        throw new Error("Proposals file must be an object");
    }
    const o = raw as Record<string, unknown>;
    if (!Array.isArray(o.commands)) throw new Error("Proposals file missing commands");
    return {
        version: typeof o.version === "string" ? o.version : "1.0.0",
        gameName: typeof o.gameName === "string" ? o.gameName : undefined,
        playerId: typeof o.playerId === "string" ? o.playerId : undefined,
        createdAt: typeof o.createdAt === "string" ? o.createdAt : new Date().toISOString(),
        commands: o.commands as FullThrustGameCommand[],
        notes: typeof o.notes === "string" ? o.notes : undefined,
    };
}

export function createCommandBundle(
    commands: FullThrustGameCommand[],
    opts: { gameName?: string; playerId?: string; notes?: string } = {}
): CommandBundle {
    return {
        version: "1.0.0",
        gameName: opts.gameName,
        playerId: opts.playerId,
        createdAt: new Date().toISOString(),
        commands,
        notes: opts.notes,
    };
}

export function downloadJson(filename: string, data: unknown): void {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

export async function copyJsonToClipboard(data: unknown): Promise<void> {
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
}

export function readFileAsJson(file: File): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                resolve(JSON.parse(String(reader.result)));
            } catch (e) {
                reject(e);
            }
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
    });
}

export function sanitizeFilename(name: string): string {
    return name.replace(/[^a-zA-Z0-9_\-]+/g, "_").slice(0, 64) || "game";
}

export const PLAYER_COLOURS = [
    "#e41a1c",
    "#377eb8",
    "#4daf4a",
    "#ffff33",
    "#984ea3",
    "#ff7f00",
    "#a65628",
    "#f781bf",
    "#999999",
];

export const RE_PLAYER_COLOUR = /^#[A-Fa-f0-9]{6}$/;

export function validatePlayers(players: GamePlayer[]): string | null {
    if (players.length < 1) return "Define at least one player";
    const names = players.map((p) => p.id.trim());
    if (names.some((n) => !n)) return "Every player needs a name";
    if (new Set(names).size !== names.length) return "Player names must be unique";
    if (!players.every((p) => RE_PLAYER_COLOUR.test(p.colour))) {
        return "Each colour must be a valid #RRGGBB hex string";
    }
    if (new Set(players.map((p) => p.colour)).size !== players.length) {
        return "Each colour must be unique";
    }
    return null;
}
