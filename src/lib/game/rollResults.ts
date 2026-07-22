import type { FullThrustGameCommand } from "@/schemas/commands";
import type { DamageApplication } from "./combat";
import type { BoardingCombatResult } from "./boarding";
import type { SalvoStrikeResult, FighterStrikeResult } from "./ordnanceAttack";

export type LogDiceSource = "client" | "moderatorSequence" | "external";

export interface LogDiceInput {
    purpose: string;
    rolls: number[];
    source?: LogDiceSource;
    context?: string;
    result?: string;
}

/** Build a `logDice` command with optional resolved outcome text. */
export function makeLogDice(input: LogDiceInput): FullThrustGameCommand {
    const cmd: Record<string, unknown> = {
        name: "logDice",
        purpose: input.purpose,
        rolls: input.rolls,
        source: input.source ?? "client",
    };
    if (input.context) cmd.context = input.context;
    if (input.result) cmd.result = input.result;
    return cmd as FullThrustGameCommand;
}

/** Sweep roll outcome text (mine disabled, unaffected, or detonation on sweeper). */
export function formatMineSweepResultNotes(
    roll: number,
    mineId: string,
    shipId: string
): string {
    if (roll === 1) return `Sweep roll 1 — mine ${mineId} detonates on ${shipId}`;
    if (roll >= 3) return `Sweep roll ${roll} — mine ${mineId} disabled by ${shipId}`;
    return `Sweep roll 2 — mine ${mineId} unaffected`;
}

/** Hostile detonation or sweep detonation damage summary. */
export function formatMineDetonationResultNotes(
    mineId: string,
    shipId: string,
    totalDamage: number,
    applied: DamageApplication | null | undefined,
    destroyed = false
): string {
    const damage = formatAppliedDamage(totalDamage, applied, { destroyed });
    return `Mine ${mineId} → ${shipId}: ${damage}`;
}

/** Sweep roll 1 detonation including beam damage to the sweeper. */
export function formatMineSweepDetonationResultNotes(
    mineId: string,
    shipId: string,
    sweepRoll: number,
    totalDamage: number,
    applied: DamageApplication | null | undefined,
    destroyed = false
): string {
    const sweep = formatMineSweepResultNotes(sweepRoll, mineId, shipId);
    const damage = formatAppliedDamage(totalDamage, applied, { destroyed });
    return `${sweep}; ${damage}`;
}

/** Format armour/hull damage applied to a ship target. */
export function formatAppliedDamage(
    totalDamage: number,
    applied: DamageApplication | null | undefined,
    options?: { destroyed?: boolean }
): string {
    if (totalDamage <= 0) return "Miss";
    if (!applied) {
        return `Hit: ${totalDamage} damage (no target ship)`;
    }
    const armourTotal = applied.armourDamage.reduce((sum, n) => sum + n, 0);
    const hull = applied.hullDamage;
    const parts: string[] = [];
    if (armourTotal > 0) parts.push(`${armourTotal} armour`);
    if (hull > 0) parts.push(`${hull} hull`);
    if (parts.length === 0) {
        return `Hit: ${totalDamage} damage (no hull or armour damage applied)`;
    }
    const base = `Hit: ${totalDamage} damage (${parts.join(", ")})`;
    return options?.destroyed ? `${base}; ship destroyed` : base;
}

export function formatPdsResultNotes(
    kills: number,
    targetType?: string,
    before?: number,
    after?: number
): string {
    if (kills <= 0) return "Miss";
    if (targetType === "fighters" && before !== undefined && after !== undefined) {
        return `Hit: ${kills} kill(s) (${before} → ${after} fighters)`;
    }
    if (targetType === "ordnance" && kills > 0) {
        return "Hit: ordnance destroyed";
    }
    return `Hit: ${kills} kill(s)`;
}

export function formatNeedleResultNotes(roll: number, systemId: string | undefined): string {
    if (roll === 6 && systemId) {
        return `Hit: destroyed ${systemId}`;
    }
    return `Miss (rolled ${roll}; need 6${systemId ? ` to destroy ${systemId}` : ""})`;
}

export function formatDogfightResultNotes(
    aId: string,
    bId: string,
    nA: number,
    nB: number,
    killsA: number,
    killsB: number
): string {
    const afterA = Math.max(0, nA - killsB);
    const afterB = Math.max(0, nB - killsA);
    return `${aId} deals ${killsA} → ${bId} has ${afterB}; ${bId} deals ${killsB} → ${aId} has ${afterA}`;
}

export function formatSalvoResultNotes(
    salvo: SalvoStrikeResult,
    applied: DamageApplication | null | undefined
): string {
    const damage = formatAppliedDamage(salvo.totalSap, applied);
    return `${salvo.missilesOnTarget} on target, ${salvo.survivors} survivors — ${damage}`;
}

export function formatHeavyMissileResultNotes(
    damageDice: number[],
    totalAfterScreens: number,
    applied: DamageApplication | null | undefined
): string {
    const diceStr = damageDice.join("+");
    const damage = formatAppliedDamage(totalAfterScreens, applied);
    return `${diceStr} SAP — ${damage}`;
}

export function formatFighterStrikeResultNotes(
    strike: FighterStrikeResult,
    applied: DamageApplication | null | undefined
): string {
    const damage = formatAppliedDamage(strike.totalDamage, applied);
    return `×${strike.results.length} fighters — ${damage}`;
}

export function formatThresholdResultNotes(
    shipId: string,
    systems: string[],
    rolls: number[],
    failOn: number
): string {
    return systems
        .map((sys, i) => {
            const roll = rolls[i] ?? 1;
            const failed = roll >= failOn;
            return `${shipId}/${sys}: ${failed ? "fail" : "pass"} (${roll})`;
        })
        .join("; ");
}

export function formatBoardingCombatNotes(
    result: BoardingCombatResult,
    hullApplied: number
): string {
    const base = result.notes.join("; ");
    if (hullApplied > 0) {
        return `${base}; ${hullApplied} hull damage applied`;
    }
    return base;
}

export function formatReactorResultNotes(
    shipId: string,
    roll: number,
    exploded: boolean,
    skipped: boolean,
    threshold = 5
): string {
    if (skipped) return `Skipped for ${shipId} (not unstable, or dumped)`;
    if (exploded) {
        return `Reactor EXPLODED on ${shipId} (rolled ${roll}, needed ${threshold}+)`;
    }
    return `Reactor holds on ${shipId} (rolled ${roll}, needed ${threshold}+)`;
}

export function formatDcpRepairResultNotes(
    shipId: string,
    systemId: string,
    roll: number,
    dcp: number,
    success: boolean
): string {
    if (success) {
        return `Repaired ${shipId}/${systemId} (rolled ${roll} ≤ ${dcp})`;
    }
    return `Repair failed for ${shipId}/${systemId} (rolled ${roll}, needed ≤ ${dcp})`;
}

export function formatRegenArmourResultNotes(
    shipId: string,
    row: number,
    roll: number,
    outcome: "repaired" | "lost" | "noChange"
): string {
    if (outcome === "repaired") {
        return `Regen armour ${shipId} row ${row}: rolled ${roll} — regenerated`;
    }
    if (outcome === "lost") {
        return `Regen armour ${shipId} row ${row}: rolled ${roll} — permanently lost`;
    }
    return `Regen armour ${shipId} row ${row}: rolled ${roll} — no change`;
}
