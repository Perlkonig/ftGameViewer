import type { FullThrustGamePosition } from "@/schemas/position";
import type { GameMeta, GamePhase, InitiativeState } from "./types";
import { PHASE_NAMES, migrateLegacyPhase } from "./types";
import { BOARDING_STEP_LABELS } from "./boardingOrders";
import { thresholdDiceCount } from "./thresholdSystems";
import { reactorDiceCount } from "./coreSystems";

/** Coerce stored phase values (including legacy 0–14) to Continuum 1–15. */
export function coerceGamePhase(phase: number): GamePhase {
    return migrateLegacyPhase(phase);
}

/** Phase when deferred movement orders resolve. */
export const SHIP_MOVEMENT_RESOLVE_PHASE: GamePhase = 5;

/** Phases where initiative loser acts first. */
export const LOSER_FIRST_PHASES: GamePhase[] = [3, 4];

/** Phases where initiative winner acts first. */
export const WINNER_FIRST_PHASES: GamePhase[] = [11, 12];

/** Phases with orders/resolve segments and per-ship activation. */
export const SEGMENT_ACTIVATION_PHASES: GamePhase[] = [3, 7, 8, 9, 11, 12, 14];

export function phaseName(phase: GamePhase | number): string {
    const p = coerceGamePhase(phase);
    return PHASE_NAMES[p] ?? `Phase ${p}`;
}

export function nextPhase(meta: GameMeta): { turn: number; phase: GamePhase } {
    if (meta.phase >= 15) {
        return { turn: meta.turn + 1, phase: 1 };
    }
    return { turn: meta.turn, phase: (meta.phase + 1) as GamePhase };
}

export function isSegmentActivationPhase(phase: GamePhase): boolean {
    return SEGMENT_ACTIVATION_PHASES.includes(phase);
}

/**
 * Ordered player activation list for the current phase.
 * Returns player ids in the order they should act.
 */
export function activationOrder(
    playerIds: string[],
    initiative: InitiativeState | undefined,
    phase: GamePhase
): string[] {
    if (playerIds.length === 0) return [];
    if (!initiative?.winner || !playerIds.includes(initiative.winner)) {
        return [...playerIds];
    }

    const winner = initiative.winner;
    const rest = playerIds.filter((p) => p !== winner);

    if (LOSER_FIRST_PHASES.includes(phase)) {
        return [...rest, winner];
    }
    if (WINNER_FIRST_PHASES.includes(phase)) {
        return [winner, ...rest];
    }
    return [...playerIds];
}

export function isAlternatingActivationPhase(phase: GamePhase): boolean {
    return LOSER_FIRST_PHASES.includes(phase) || WINNER_FIRST_PHASES.includes(phase);
}

export type CommandKind =
    | "placeShip"
    | "moveShip"
    | "layMine"
    | "launchOrdnance"
    | "declareLaunchOrdnance"
    | "resolveLaunchOrdnance"
    | "moveOrdnance"
    | "proposeOrdnanceAllocations"
    | "allocateOrdnanceTarget"
    | "clearOrdnanceAllocation"
    | "applyOrdnanceAllocations"
    | "declareFighterAttack"
    | "declareFurball"
    | "resolveFurball"
    | "resolvePhase8Furballs"
    | "declarePointDefense"
    | "resolvePhase9PointDefense"
    | "resolvePointDefenseMount"
    | "resolvePhase9Complete"
    | "detonateOrdnance"
    | "strikeOrdnance"
    | "attackRunIntercept"
    | "fighterShipStrike"
    | "gunboatShipStrike"
    | "resolvePhase10Complete"
    | "resolvePhase11HullDestruction"
    | "setShipCaptured"
    | "setShipOwner"
    | "interceptOrdnance"
    | "useAmmo"
    | "launchFighters"
    | "moveFighters"
    | "screenFighters"
    | "pursueFighters"
    | "adjustFighters"
    | "setFighterCallsign"
    | "setFighterType"
    | "launchFighterOrdnance"
    | "launchGunboats"
    | "launchGunboatOrdnance"
    | "moveGunboats"
    | "screenGunboats"
    | "pursueGunboats"
    | "adjustGunboats"
    | "declareGunboatAttack"
    | "setGunboatCallsign"
    | "fireWeapon"
    | "declareShipFire"
    | "resolveShipFire"
    | "setBoarders"
    | "adjustBoarders"
    | "declareBoardingAttackerOrders"
    | "declareBoardingDefenderOrders"
    | "resolveBoardingCombat"
    | "resolveThresholdCheck"
    | "resolveReactorBreaches"
    | "bankEmpHits"
    | "queueTransporterDelivery"
    | "declareTransporterDelivery"
    | "declareEmpAllocation"
    | "resolveEmpAllocation"
    | "spinalWeaponFired"
    | "consumeAmmo"
    | "declareRepairOrders"
    | "resolveRepairOrders"
    | "adjustRegenArmour"
    | "dmgShip"
    | "regenArmour"
    | "sysDisable"
    | "sysEnable"
    | "objDestroy"
    | "objHide"
    | "awardVP"
    | "_custom"
    | "advancePhase"
    | "advanceSegment"
    | "setInitiative"
    | "logDice"
    | "setMeta"
    | "setCoreState"
    | "resolvePhase5Movement"
    | "resolveMinePhase";

/** Which command names are typically legal in each phase (soft guidance). */
export const PHASE_COMMANDS: Record<GamePhase, CommandKind[]> = {
    1: ["placeShip", "moveShip", "_custom", "setMeta", "logDice"],
    2: ["setInitiative", "advancePhase", "logDice", "_custom"],
    3: [
        "declareLaunchOrdnance",
        "resolveLaunchOrdnance",
        "launchOrdnance",
        "launchFighters",
        "launchFighterOrdnance",
        "launchGunboats",
        "launchGunboatOrdnance",
        "moveOrdnance",
        "useAmmo",
        "advanceSegment",
        "advancePhase",
        "logDice",
        "_custom",
    ],
    4: [
        "moveFighters",
        "moveGunboats",
        "screenFighters",
        "screenGunboats",
        "pursueFighters",
        "pursueGunboats",
        "advancePhase",
        "logDice",
        "_custom",
    ],
    5: [
        "moveShip",
        "layMine",
        "resolvePhase5Movement",
        "resolveMinePhase",
        "advancePhase",
        "logDice",
        "_custom",
    ],
    6: [
        "moveFighters",
        "moveGunboats",
        "screenFighters",
        "screenGunboats",
        "pursueFighters",
        "pursueGunboats",
        "adjustFighters",
        "adjustGunboats",
        "advancePhase",
        "logDice",
        "_custom",
    ],
    7: [
        "proposeOrdnanceAllocations",
        "allocateOrdnanceTarget",
        "clearOrdnanceAllocation",
        "applyOrdnanceAllocations",
        "declareFighterAttack",
        "declareGunboatAttack",
        "advanceSegment",
        "advancePhase",
        "logDice",
        "_custom",
    ],
    8: [
        "declareFurball",
        "resolvePhase8Furballs",
        "resolveFurball",
        "interceptOrdnance",
        "adjustFighters",
        "adjustGunboats",
        "advanceSegment",
        "objDestroy",
        "logDice",
        "advancePhase",
        "_custom",
    ],
    9: [
        "declarePointDefense",
        "resolvePhase9PointDefense",
        "resolvePointDefenseMount",
        "resolvePhase9Complete",
        "declareShipFire",
        "resolveShipFire",
        "adjustFighters",
        "adjustGunboats",
        "objDestroy",
        "logDice",
        "advanceSegment",
        "advancePhase",
        "_custom",
    ],
    10: [
        "detonateOrdnance",
        "strikeOrdnance",
        "attackRunIntercept",
        "fighterShipStrike",
        "gunboatShipStrike",
        "resolvePhase10Complete",
        "fireWeapon",
        "dmgShip",
        "sysDisable",
        "adjustFighters",
        "adjustGunboats",
        "objDestroy",
        "logDice",
        "advancePhase",
        "_custom",
    ],
    11: [
        "declareShipFire",
        "resolveShipFire",
        "declareTransporterDelivery",
        "bankEmpHits",
        "queueTransporterDelivery",
        "spinalWeaponFired",
        "useAmmo",
        "consumeAmmo",
        "fireWeapon",
        "dmgShip",
        "sysDisable",
        "adjustBoarders",
        "advanceSegment",
        "advancePhase",
        "logDice",
        "_custom",
    ],
    12: [
        "declareBoardingAttackerOrders",
        "declareBoardingDefenderOrders",
        "resolveBoardingCombat",
        "setBoarders",
        "adjustBoarders",
        "dmgShip",
        "sysDisable",
        "advanceSegment",
        "advancePhase",
        "logDice",
        "_custom",
        "awardVP",
    ],
    13: ["sysDisable", "logDice", "advancePhase", "_custom", "setCoreState", "resolveThresholdCheck", "declareEmpAllocation", "resolveEmpAllocation"],
    14: [
        "declareRepairOrders",
        "resolveRepairOrders",
        "adjustRegenArmour",
        "sysEnable",
        "regenArmour",
        "logDice",
        "advanceSegment",
        "advancePhase",
        "_custom",
        "setCoreState",
    ],
    15: ["objDestroy", "dmgShip", "logDice", "advancePhase", "_custom", "setCoreState", "resolveReactorBreaches", "adjustFighters"],
};

/** Legal commands for a phase; empty array if phase is unrecognized. */
export function commandsForPhase(phase: number): CommandKind[] {
    return PHASE_COMMANDS[coerceGamePhase(phase)] ?? [];
}

/** Always-allowed moderator overrides. */
const ALWAYS: CommandKind[] = [
    "advancePhase",
    "advanceSegment",
    "setInitiative",
    "setMeta",
    "logDice",
    "_custom",
    "awardVP",
    "dmgShip",
    "sysDisable",
    "sysEnable",
    "objDestroy",
    "objHide",
    "moveShip",
    "placeShip",
    "setCoreState",
    "launchOrdnance",
    "launchFighters",
    "setFighterCallsign",
    "setFighterType",
    "launchFighterOrdnance",
    "fireWeapon",
    "setBoarders",
    "adjustBoarders",
    "setShipCaptured",
    "setShipOwner",
    "resolveThresholdCheck",
    "resolveReactorBreaches",
];

export function isCommandLegalInPhase(
    command: CommandKind,
    phase: GamePhase | number,
    opts: { moderator?: boolean } = {}
): boolean {
    const p = coerceGamePhase(phase);
    if (opts.moderator && ALWAYS.includes(command)) return true;
    return commandsForPhase(p).includes(command);
}

export function legalCommandsForPhase(
    phase: GamePhase | number,
    opts: { moderator?: boolean } = {}
): CommandKind[] {
    const base = [...commandsForPhase(phase)];
    if (opts.moderator) {
        for (const c of ALWAYS) {
            if (!base.includes(c)) base.push(c);
        }
    }
    return base;
}

/** Act-tab UI actions (subset of helpers), ordered by earliest typical phase. */
export type ActActionKey =
    | "placeShip"
    | "moveShip"
    | "launchOrdnance"
    | "launchFighters"
    | "launchGunboats"
    | "launchGunboatOrdnance"
    | "moveFighters"
    | "moveGunboats"
    | "adjustFighters"
    | "adjustGunboats"
    | "layMine"
    | "cloak"
    | "moveOrdnance"
    | "declareOrdnanceTarget"
    | "declareFighterAttack"
    | "declareGunboatAttack"
    | "dogfight"
    | "resolveFurballs"
    | "resolvePointDefense"
    | "pointDefense"
    | "fireWeapon"
    | "resolveFireAdHoc"
    | "ordnanceStrike"
    | "boardingAttacker"
    | "boardingDefender"
    | "damageControl"
    | "transporterDelivery"
    | "empAllocation";

export interface ActActionOption {
    key: ActActionKey;
    label: string;
    phases: GamePhase[];
    subOrder: number;
}

export const ACT_ACTIONS: ActActionOption[] = [
    { key: "placeShip", label: "Place a ship", phases: [1], subOrder: 0 },
    { key: "moveShip", label: "Move ship", phases: [1, 5], subOrder: 1 },
    { key: "launchOrdnance", label: "Launch ordnance", phases: [3], subOrder: 0 },
    { key: "launchFighters", label: "Launch fighters", phases: [3], subOrder: 1 },
    { key: "launchGunboats", label: "Launch gunboats", phases: [3], subOrder: 2 },
    {
        key: "launchGunboatOrdnance",
        label: "Launch gunboat ordnance",
        phases: [3],
        subOrder: 3,
    },
    { key: "layMine", label: "Lay mine", phases: [5], subOrder: 1 },
    { key: "moveFighters", label: "Move fighters", phases: [4, 6], subOrder: 1 },
    { key: "moveGunboats", label: "Move gunboats", phases: [4, 6], subOrder: 1 },
    {
        key: "adjustFighters",
        label: "Adjust / recover fighters",
        phases: [4, 6, 8, 10],
        subOrder: 2,
    },
    {
        key: "adjustGunboats",
        label: "Adjust / recover gunboats",
        phases: [4, 6, 8, 10],
        subOrder: 2,
    },
    { key: "cloak", label: "Cloak / uncloak", phases: [5], subOrder: 2 },
    {
        key: "declareOrdnanceTarget",
        label: "Declare ordnance target",
        phases: [7],
        subOrder: 0,
    },
    {
        key: "declareFighterAttack",
        label: "Declare fighter attack",
        phases: [7],
        subOrder: 1,
    },
    {
        key: "declareGunboatAttack",
        label: "Declare gunboat attack",
        phases: [7],
        subOrder: 2,
    },
    { key: "dogfight", label: "Declare furball", phases: [8], subOrder: 0 },
    { key: "resolveFurballs", label: "Resolve furballs", phases: [8], subOrder: 1 },
    { key: "pointDefense", label: "Declare point defense", phases: [9], subOrder: 0 },
    { key: "resolvePointDefense", label: "Resolve point defense", phases: [9], subOrder: 1 },
    { key: "fireWeapon", label: "Declare ship fire", phases: [11], subOrder: 0 },
    {
        key: "transporterDelivery",
        label: "Transporter delivery",
        phases: [11],
        subOrder: 1,
    },
    {
        key: "empAllocation",
        label: "EMP allocation",
        phases: [13],
        subOrder: 0,
    },
    { key: "resolveFireAdHoc", label: "Resolve fire (ad-hoc)", phases: [9, 10, 11], subOrder: 9 },
    { key: "ordnanceStrike", label: "Missile / fighter strike", phases: [10], subOrder: 1 },
    { key: "boardingAttacker", label: BOARDING_STEP_LABELS.attackerAllocation, phases: [12], subOrder: 0 },
    { key: "boardingDefender", label: BOARDING_STEP_LABELS.defenderAllocation, phases: [12], subOrder: 1 },
    { key: "damageControl", label: "Damage control", phases: [14], subOrder: 0 },
];

export function actActionEarliestPhase(action: ActActionOption): GamePhase {
    return Math.min(...action.phases) as GamePhase;
}

export function sortedActActions(): ActActionOption[] {
    return [...ACT_ACTIONS].sort((a, b) => {
        const pa = actActionEarliestPhase(a);
        const pb = actActionEarliestPhase(b);
        if (pa !== pb) return pa - pb;
        return a.subOrder - b.subOrder;
    });
}

export function formatActActionPhases(phases: GamePhase[]): string {
    if (phases.length === 1) return `(phase ${phases[0]})`;
    return `(phases ${phases.join(", ")})`;
}

export function actActionLabel(action: ActActionOption): string {
    return `${action.label} ${formatActActionPhases(action.phases)}`;
}

const ACT_COMMAND_MAP: Record<ActActionKey, CommandKind[]> = {
    placeShip: ["placeShip"],
    moveShip: ["moveShip"],
    launchFighters: ["launchFighters"],
    launchGunboats: ["launchGunboats"],
    launchGunboatOrdnance: ["launchGunboatOrdnance"],
    launchOrdnance: ["launchOrdnance", "declareLaunchOrdnance"],
    moveFighters: ["moveFighters", "screenFighters", "pursueFighters"],
    moveGunboats: ["moveGunboats"],
    moveOrdnance: ["moveOrdnance"],
    declareOrdnanceTarget: [
        "allocateOrdnanceTarget",
        "proposeOrdnanceAllocations",
        "applyOrdnanceAllocations",
        "clearOrdnanceAllocation",
    ],
    declareFighterAttack: ["declareFighterAttack"],
    declareGunboatAttack: ["declareGunboatAttack"],
    pointDefense: ["declarePointDefense"],
    resolvePointDefense: [
        "resolvePointDefenseMount",
        "resolvePhase9Complete",
        "resolvePhase9PointDefense",
    ],
    fireWeapon: ["declareShipFire", "resolveShipFire"],
    transporterDelivery: ["declareTransporterDelivery"],
    empAllocation: ["declareEmpAllocation"],
    resolveFireAdHoc: ["fireWeapon", "logDice", "dmgShip", "sysDisable"],
    damageControl: [
        "declareRepairOrders",
        "resolveRepairOrders",
        "sysEnable",
        "regenArmour",
    ],
    ordnanceStrike: ["dmgShip", "fireWeapon", "objDestroy"],
    dogfight: ["declareFurball"],
    resolveFurballs: ["resolvePhase8Furballs"],
    boardingAttacker: [
        "declareBoardingAttackerOrders",
        "resolveBoardingCombat",
        "setBoarders",
        "adjustBoarders",
        "dmgShip",
    ],
    boardingDefender: [
        "declareBoardingDefenderOrders",
        "resolveBoardingCombat",
        "setBoarders",
        "adjustBoarders",
        "dmgShip",
    ],
    cloak: ["objHide", "moveShip"],
    layMine: ["layMine"],
    adjustFighters: ["adjustFighters", "moveFighters"],
    adjustGunboats: ["adjustGunboats", "moveGunboats"],
};

export function isActActionTypicalInPhase(
    key: ActActionKey,
    phase: GamePhase,
    legal: CommandKind[]
): boolean {
    return (ACT_COMMAND_MAP[key] ?? []).some((c) => legal.includes(c));
}

export function defaultActActionForPhase(
    phase: GamePhase,
    ctx: {
        hasShips?: boolean;
        segment?: "orders" | "resolve";
        boardingStep?: "attacker" | "defender";
    } = {}
): ActActionKey | "" {
    switch (phase) {
        case 1:
            return ctx.hasShips ? "moveShip" : "placeShip";
        case 2:
            return "";
        case 3:
            return "launchOrdnance";
        case 4:
            return "moveFighters";
        case 5:
            return "layMine";
        case 6:
            return "moveFighters";
        case 7:
            return (ctx.segment ?? "orders") === "resolve"
                ? "declareFighterAttack"
                : "declareOrdnanceTarget";
        case 8:
            return (ctx.segment ?? "orders") === "resolve" ? "resolveFurballs" : "dogfight";
        case 9:
            return (ctx.segment ?? "orders") === "resolve"
                ? "resolvePointDefense"
                : "pointDefense";
        case 10:
            return "";
        case 11:
            return "fireWeapon";
        case 12:
            return (ctx.boardingStep ?? "attacker") === "defender"
                ? "boardingDefender"
                : "boardingAttacker";
        case 13:
            return "empAllocation";
        case 14:
            return "damageControl";
        case 15:
            return "";
        default:
            return "";
    }
}

export type PhaseAdvancePromptKind = "initiative" | "dice" | "threshold" | "reactor" | "emp";

const DICE_PROMPT_PHASES: GamePhase[] = [];

export interface PhaseAdvanceContext {
    meta: GameMeta;
    position: FullThrustGamePosition;
    bankedEmpHits?: import("./empFire").BankedEmpState;
}

export function phaseAdvancePrompt(
    phase: GamePhase,
    ctx?: PhaseAdvanceContext
): PhaseAdvancePromptKind | null {
    if (phase === 2) return "initiative";
    if (phase === 13) {
        if (ctx?.bankedEmpHits && Object.keys(ctx.bankedEmpHits).length > 0) return "emp";
        return "threshold";
    }
    if (phase === 15) {
        if (!ctx) return null;
        if (reactorDiceCount(ctx.position, ctx.meta) > 0) return "reactor";
        return null;
    }
    if (DICE_PROMPT_PHASES.includes(phase)) return "dice";
    return null;
}

export function suggestedDiceCount(phase: GamePhase): number {
    switch (phase) {
        case 8:
            return 8;
        case 9:
            return 16;
        case 10:
            return 20;
        case 11:
            return 24;
        case 12:
            return 12;
        case 14:
            return 8;
        case 15:
            return 6;
        default:
            return 12;
    }
}

export function suggestedThresholdDiceCount(
    position: FullThrustGamePosition,
    meta: GameMeta
): number {
    return thresholdDiceCount(position, meta).total;
}

/** Human-readable segment label for PhaseBar / moderator UI. */
export function segmentDisplayLabel(
    phase: GamePhase,
    segment: "orders" | "resolve" | undefined,
    boardingStep?: "attacker" | "defender"
): string | undefined {
    if (!segment) return undefined;
    if (phase === 7) {
        return segment === "orders" ? "Missile allocation" : "Fighter allocation";
    }
    if (phase === 8) {
        return segment === "orders" ? "Furball orders" : "Resolve furballs";
    }
    if (phase === 9) {
        return segment === "orders" ? "Point defense orders" : "Resolve point defense";
    }
    if (phase === 12) {
        if (segment === "resolve") return "Resolve boarding";
        return boardingStep === "defender"
            ? BOARDING_STEP_LABELS.defenderAllocation
            : BOARDING_STEP_LABELS.attackerAllocation;
    }
    return segment === "orders" ? "Orders" : "Resolve";
}

/** Id of the object currently activating in a segmented phase. */
export function currentActivationId(meta: GameMeta): string | undefined {
    const act = meta.activation;
    if (!act || act.index >= act.queue.length) return undefined;
    return act.queue[act.index];
}

/** Whether all activations in the current segmented phase are complete. */
export function activationsComplete(meta: GameMeta): boolean {
    const act = meta.activation;
    if (!act) return true;
    return act.index >= act.queue.length;
}
