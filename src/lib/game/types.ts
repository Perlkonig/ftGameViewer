/** Shared game-engine types (package meta + fold result). */

export type DicePolicy = "client" | "moderatorSequence" | "hybrid";

/** Continuum turn sequence phases 1–15. */
export type GamePhase =
    | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;

export const PHASE_NAMES: Record<GamePhase, string> = {
    1: "Write Orders",
    2: "Initiative",
    3: "Launch Ordnance & Fighters",
    4: "Fighter & Gunboat Movement",
    5: "Ship Movement",
    6: "Secondary Fighter Movement",
    7: "Allocate Missile/Fighter Attacks",
    8: "Fighters vs Fighters",
    9: "Point Defense",
    10: "Missile & Fighter Attacks",
    11: "Ship Fire",
    12: "Boarding",
    13: "Threshold Checks",
    14: "Damage Control",
    15: "Reactor Explosion",
};

export type PhaseSegment = "orders" | "resolve";

export type BoardingStep = "attacker" | "defender";

export interface ActivationCursor {
    /** Ship or fighter-group ids to activate this phase, in order. */
    queue: string[];
    /** Index of the object currently taking its activation. */
    index: number;
}

export interface FleetLimit {
    playerId: string;
    maxPoints?: number;
    maxShips?: number;
    notes?: string;
}

export interface InitiativeState {
    rolls: { player: string; roll: number }[];
    winner: string;
}

export interface GameMeta {
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
    /** When not false, threshold checks include bridge/life/power cores. Legacy: undefined → true. */
    includeCoreSystemsInThreshold?: boolean;
    /** When not false and core systems enabled, reactor explosions deal SAP area damage. Legacy: undefined → true. */
    reactorBreachesEnabled?: boolean;
    /** orders = collect declarations; resolve = roll dice / apply effects. */
    segment?: PhaseSegment;
    /** Per-ship/group activation cursor for segmented phases. */
    activation?: ActivationCursor;
    /** Phase 12 orders sub-step: Step 1a attacker allocation, then Step 1b defender allocation. */
    boardingStep?: BoardingStep;
}

export const DEFAULT_META = (): GameMeta => ({
    version: "1.0.0",
    name: "Untitled Game",
    createdAt: new Date().toISOString(),
    turn: 1,
    phase: 1,
    dicePolicy: "hybrid",
    allowVectorMovement: false,
    includeCoreSystemsInThreshold: true,
    reactorBreachesEnabled: true,
});

/**
 * Starting meta for folding a command log. Package headers store the *current*
 * turn/phase for export convenience; replay must begin at turn 1 / phase 1 so
 * deferred orders and phase gates apply correctly as commands are re-applied.
 */
export function metaForCommandReplay(header: GameMeta): GameMeta {
    return {
        version: header.version,
        name: header.name,
        createdAt: header.createdAt,
        turn: 1,
        phase: 1,
        dicePolicy: header.dicePolicy,
        diceSeed: header.diceSeed,
        fleetLimits: header.fleetLimits,
        allowVectorMovement: header.allowVectorMovement,
        includeCoreSystemsInThreshold: header.includeCoreSystemsInThreshold,
        reactorBreachesEnabled: header.reactorBreachesEnabled,
    };
}

/** Legacy packages without the flag treat core systems as active in threshold checks. */
export function coreSystemsInThresholdEnabled(meta: GameMeta): boolean {
    return meta.includeCoreSystemsInThreshold !== false;
}

/** Reactor breach SAP blast is on when core systems are enabled unless explicitly disabled. */
export function reactorBreachesEnabled(meta: GameMeta): boolean {
    if (!coreSystemsInThresholdEnabled(meta)) return false;
    return meta.reactorBreachesEnabled !== false;
}

/** Legacy packages used phase 0–14; bump to 1–15. */
export function migrateLegacyPhase(phase: number): GamePhase {
    if (phase >= 1 && phase <= 15) return phase as GamePhase;
    if (phase >= 0 && phase <= 14) return (phase + 1) as GamePhase;
    return 1;
}
