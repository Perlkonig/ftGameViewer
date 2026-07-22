/** Phase 9 point defense orchestration — orders, validation, batch resolve. */

import type { FullThrustGameCommand } from "@/schemas/commands";
import type { FullThrustGamePosition } from "@/schemas/position";
import type { RollSource } from "./dice";
import { arrayRollSource } from "./dice";
import {
    incomingThreatsForPhase9,
    isHostileThreatToProtectedShip,
    threatWithinRangeMu,
    type FighterThreat,
    type OrdnanceThreat,
} from "./incomingThreats";
import {
    inferProfileFromWeaponName,
    pointDefenseProfileLabel,
    resolveFighterPdSelfDestruct,
    resolvePointDefenseProfile,
    threatKindForTarget,
    type PointDefenseProfile,
} from "./pointDefenseProfiles";
import {
    adfcSupportSlotCount,
    findWeaponEntry,
    operationalPointDefenseMounts,
    shipHasAadfc,
    type ShipGameState,
    type ShipSystemEntry,
} from "./shipSystems";
import { fighterGroupLabel } from "./fighterLabel";
import { gunboatGroupLabel } from "./gunboatLabel";
import { isDeployedFighter } from "./fighterMove";
import { clearFighterAttachment } from "./fighterAttachment";
import type { FurballEngagement } from "./fighterDogfight";
import type { ValidationIssue } from "./commandValidation";
import { distance } from "./movement";
import {
    findGunboatSquadron,
    gunboatPointDefenseSupportIssues,
    isGunboatPointDefenseDefender,
    operationalGunboatPdMounts,
    remainingGunboatPdMounts,
} from "./gunboatPointDefense";
import { applyGunboatKills } from "./gunboatHull";
import { gunboatProtectionDrm } from "./gunboatProfiles";
import { fighterProfileFor } from "./fighterProfiles";
import { fighterWingFromObj } from "./fighterTypeCommand";

export interface PointDefenseValidationOptions {
    adsMode?: "long" | "split";
    furballDeclarations?: FurballEngagement[];
    weaponUsedThisTurn?: Record<string, "pds" | "shipFire">;
}

export interface PointDefenseDeclaration {
    defenderShip: string;
    weapon: string;
    supportedShip: string;
    threatId: string;
    profile: PointDefenseProfile;
    adsMode?: "long" | "split";
    splitTargetId?: string;
}

export interface PointDefenseAllocationResult {
    declaration: PointDefenseDeclaration;
    kills: number;
    rolls: number[];
    summary: string;
    ordnanceDestroyed?: boolean;
    fighterAfter?: number;
    /** Fighter-PD self-destruct losses on the defending wing (separate adjustFighters in log). */
    fighterSelfDestruct?: { wingId: string; losses: number; numberAfter: number };
}

export interface PdMountProfileGroup {
    profile: PointDefenseProfile;
    label: string;
    mounts: ShipSystemEntry[];
}

export interface ThreatProfileAllocation {
    threatId: string;
    byProfile: Partial<Record<PointDefenseProfile, number>>;
}

/** PD mounts on a ship not yet declared this phase. */
export function remainingPdMounts(
    ship: ShipGameState,
    existing: PointDefenseDeclaration[],
    defenderShipId: string
): ShipSystemEntry[] {
    const used = new Set(
        existing.filter((d) => d.defenderShip === defenderShipId).map((d) => d.weapon)
    );
    return operationalPointDefenseMounts(ship)
        .filter((m) => m.id && !used.has(m.id))
        .sort((a, b) => {
            const pa = inferProfileFromWeaponName(a.name);
            const pb = inferProfileFromWeaponName(b.name);
            if (pa !== pb) return pa.localeCompare(pb);
            return (a.id ?? "").localeCompare(b.id ?? "");
        });
}

/** PD mounts for a defending ship or PDS/ADS gunboat squadron. */
export function remainingPdMountsForDefender(
    position: FullThrustGamePosition,
    defenderId: string,
    existing: PointDefenseDeclaration[]
): ShipSystemEntry[] {
    const gunboat = findGunboatSquadron(position, defenderId);
    if (gunboat && isGunboatPointDefenseDefender(position, defenderId)) {
        return remainingGunboatPdMounts(gunboat, existing, defenderId);
    }
    const ship = findShip(position, defenderId);
    if (!ship) return [];
    return remainingPdMounts(ship, existing, defenderId);
}

export function groupPdMountsByProfile(mounts: ShipSystemEntry[]): PdMountProfileGroup[] {
    const byProfile = new Map<PointDefenseProfile, ShipSystemEntry[]>();
    for (const mount of mounts) {
        const profile = inferProfileFromWeaponName(mount.name);
        const list = byProfile.get(profile) ?? [];
        list.push(mount);
        byProfile.set(profile, list);
    }
    return [...byProfile.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([profile, list]) => ({
            profile,
            label: pointDefenseProfileLabel(profile),
            mounts: [...list].sort((a, b) => (a.id ?? "").localeCompare(b.id ?? "")),
        }));
}

function countByProfile(
    allocations: ThreatProfileAllocation[]
): Partial<Record<PointDefenseProfile, number>> {
    const totals: Partial<Record<PointDefenseProfile, number>> = {};
    for (const alloc of allocations) {
        for (const [profile, count] of Object.entries(alloc.byProfile)) {
            const p = profile as PointDefenseProfile;
            const n = count ?? 0;
            if (n <= 0) continue;
            totals[p] = (totals[p] ?? 0) + n;
        }
    }
    return totals;
}

/** Expand per-threat weapon counts into one declaration per mount. */
export function expandPointDefenseAllocations(
    defenderShip: string,
    supportedShip: string,
    mounts: ShipSystemEntry[],
    allocations: ThreatProfileAllocation[],
    options?: { adsMode?: "long" | "split" }
): PointDefenseDeclaration[] {
    const pools = new Map<PointDefenseProfile, ShipSystemEntry[]>();
    for (const mount of mounts) {
        const profile = inferProfileFromWeaponName(mount.name);
        const list = pools.get(profile) ?? [];
        list.push(mount);
        pools.set(profile, list);
    }
    for (const list of pools.values()) {
        list.sort((a, b) => (a.id ?? "").localeCompare(b.id ?? ""));
    }

    const declarations: PointDefenseDeclaration[] = [];
    for (const alloc of allocations) {
        for (const [profileKey, count] of Object.entries(alloc.byProfile)) {
            const profile = profileKey as PointDefenseProfile;
            const n = count ?? 0;
            if (n <= 0) continue;
            const pool = pools.get(profile) ?? [];
            for (let i = 0; i < n; i++) {
                const mount = pool.shift();
                if (!mount?.id) break;
                declarations.push({
                    defenderShip,
                    weapon: mount.id,
                    supportedShip,
                    threatId: alloc.threatId,
                    profile,
                    adsMode: profile === "ads" ? options?.adsMode : undefined,
                });
            }
        }
    }
    return declarations;
}

export function phase9ThreatBoard(
    position: FullThrustGamePosition,
    commands: FullThrustGameCommand[],
    turn: number,
    options?: Pick<PointDefenseValidationOptions, "furballDeclarations">
) {
    return incomingThreatsForPhase9(
        position,
        commands,
        turn,
        options?.furballDeclarations
    );
}

/** Warnings for ineligible fighter targets in a draft allocation batch. */
export function pointDefenseAllocationTargetWarnings(
    position: FullThrustGamePosition,
    allocations: ThreatProfileAllocation[],
    commands: FullThrustGameCommand[],
    turn: number,
    options?: PointDefenseValidationOptions
): ValidationIssue[] {
    const board = phase9ThreatBoard(position, commands, turn, options);
    const seen = new Set<string>();
    const issues: ValidationIssue[] = [];
    for (const alloc of allocations) {
        if (seen.has(alloc.threatId)) continue;
        seen.add(alloc.threatId);
        issues.push(...pointDefenseFighterTargetWarnings(position, board, alloc.threatId));
    }
    return issues;
}

export function validatePointDefenseAllocationBatch(
    position: FullThrustGamePosition,
    defenderShip: string,
    supportedShip: string,
    mounts: ShipSystemEntry[],
    allocations: ThreatProfileAllocation[],
    existing: PointDefenseDeclaration[],
    commands: FullThrustGameCommand[],
    turn: number,
    options?: PointDefenseValidationOptions
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const expanded = expandPointDefenseAllocations(
        defenderShip,
        supportedShip,
        mounts,
        allocations,
        options
    );
    if (expanded.length === 0) {
        issues.push({ message: "Allocate at least one weapon to a threat.", severity: "error" });
        return issues;
    }

    issues.push(
        ...pointDefenseSupportIssues(position, defenderShip, supportedShip, existing, {
            commands,
            turn,
        })
    );

    issues.push(
        ...pointDefenseAllocationTargetWarnings(position, allocations, commands, turn, options)
    );

    const available = groupPdMountsByProfile(mounts);
    const requested = countByProfile(allocations);
    for (const group of available) {
        const want = requested[group.profile] ?? 0;
        if (want > group.mounts.length) {
            issues.push({
                message: `Only ${group.mounts.length} ${group.label} mount(s) available; ${want} requested.`,
                severity: "error",
            });
        }
    }

    const cumulative = [...existing];
    for (const decl of expanded) {
        const declIssues = validateDeclarePointDefense(
            position,
            decl,
            cumulative,
            commands,
            turn,
            options
        );
        issues.push(
            ...declIssues.filter(
                (i) => !isFighterTargetEligibilityWarning(i) && !isPointDefenseSupportIssue(i)
            )
        );
        cumulative.push(decl);
    }
    return issues;
}

export interface Phase9PointDefenseBatchResult {
    rolls: number[];
    notes: string;
    allocations: PointDefenseAllocationResult[];
    pdKillsByOrdnance: Record<string, number>;
    survivingFighterAttackers: Array<{ groupId: string; targetShipId: string; number: number }>;
}

type FighterObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "fighters" }
>;

function findShip(position: FullThrustGamePosition, id: string): ShipGameState | undefined {
    const obj = position.objects?.find((o) => o.id === id);
    return obj?.objType === "ship" ? (obj as ShipGameState) : undefined;
}

function findFighter(position: FullThrustGamePosition, id: string): FighterObj | undefined {
    const obj = position.objects?.find((o) => o.id === id);
    return obj?.objType === "fighters" ? (obj as FighterObj) : undefined;
}

function findThreatObj(position: FullThrustGamePosition, id: string) {
    return position.objects?.find((o) => o.id === id);
}

export function declaredPointDefenseFromCommands(
    commands: FullThrustGameCommand[],
    turn: number,
    phase = 9
): PointDefenseDeclaration[] {
    const out: PointDefenseDeclaration[] = [];
    let cmdTurn = 1;
    let cmdPhase = 1;
    for (const cmd of commands) {
        if (cmd.name === "advancePhase") {
            const p = (cmd as { phase?: number }).phase;
            if (typeof p === "number") {
                cmdPhase = p;
                if (cmdPhase === 1) cmdTurn += 1;
            }
        }
        if (cmd.name !== "declarePointDefense") continue;
        if (cmdTurn !== turn || cmdPhase !== phase) continue;
        const c = cmd as PointDefenseDeclaration;
        if (!c.defenderShip || !c.weapon || !c.threatId) continue;
        out.push({
            defenderShip: c.defenderShip,
            weapon: c.weapon,
            supportedShip: c.supportedShip ?? c.defenderShip,
            threatId: c.threatId,
            profile: c.profile ?? "pds",
            adsMode: c.adsMode,
            splitTargetId: c.splitTargetId,
        });
    }
    return out;
}

export function phase9PointDefenseResolvedInLog(
    commands: FullThrustGameCommand[],
    turn: number
): boolean {
    let cmdTurn = 1;
    let cmdPhase = 1;
    for (const cmd of commands) {
        if (cmd.name === "advancePhase") {
            const p = (cmd as { phase?: number }).phase;
            if (typeof p === "number") {
                cmdPhase = p;
                if (cmdPhase === 1) cmdTurn += 1;
            }
        }
        if (
            (cmd.name === "resolvePhase9PointDefense" || cmd.name === "resolvePhase9Complete") &&
            cmdTurn === turn &&
            cmdPhase === 9
        ) {
            return true;
        }
    }
    return false;
}

export function effectivePhase9PdDeclarations(
    foldDeclarations: PointDefenseDeclaration[] | undefined,
    commands: FullThrustGameCommand[],
    turn: number
): PointDefenseDeclaration[] {
    if (foldDeclarations && foldDeclarations.length > 0) return foldDeclarations;
    if (phase9PointDefenseResolvedInLog(commands, turn)) return [];
    return declaredPointDefenseFromCommands(commands, turn);
}

function isValidThreat(
    decl: PointDefenseDeclaration,
    board: ReturnType<typeof incomingThreatsForPhase9>,
    position: FullThrustGamePosition
): boolean {
    if (!isHostileThreatToProtectedShip(position, decl.threatId, decl.supportedShip)) {
        return false;
    }
    const fighter = board.fighters.find((f) => f.groupId === decl.threatId);
    if (fighter) {
        if (fighter.kind === "shipAttack") {
            return fighter.targetShipId === decl.supportedShip || decl.supportedShip === fighter.targetShipId;
        }
        return fighter.kind === "unengaged";
    }
    const gunboat = board.gunboats.find((g) => g.groupId === decl.threatId);
    if (gunboat) {
        return gunboat.targetShipId === decl.supportedShip;
    }
    const ord = board.ordnance.find((o) => o.ordnanceId === decl.threatId);
    if (ord) return ord.targetShipId === decl.supportedShip;
    return false;
}

/** Warnings when PD is allocated against fighters that cannot be shot down. */
export function pointDefenseFighterTargetWarnings(
    position: FullThrustGamePosition,
    board: ReturnType<typeof incomingThreatsForPhase9>,
    threatId: string
): ValidationIssue[] {
    const obj = findThreatObj(position, threatId);
    if (obj?.objType !== "fighters") return [];

    const label = fighterGroupLabel(obj as FighterObj);
    if (board.forfeitedShipAttackers.includes(threatId)) {
        return [
            {
                message: `${label} fought screeners without bypass — point defense cannot engage this wing.`,
                severity: "warning",
            },
        ];
    }
    if (board.mutuallyEngaged.includes(threatId)) {
        return [
            {
                message: `${label} is in mutual fighter engagement — point defense cannot engage this wing.`,
                severity: "warning",
            },
        ];
    }
    const fighter = board.fighters.find((f) => f.groupId === threatId);
    if (fighter?.kind === "unengaged") {
        return [
            {
                message: `${label} is unengaged — point defense has no effect against unengaged fighters.`,
                severity: "warning",
            },
        ];
    }
    return [];
}

function pdRangeMu(profile: PointDefenseProfile, adsMode?: string): number {
    if (profile === "ads" && adsMode === "long") return 12;
    return 6;
}

export interface PointDefenseSupportOptions {
    commands?: FullThrustGameCommand[];
    turn?: number;
}

/** True when the ship launched or recovered fighters during the given turn (blocks ADFC area defense). */
export function shipLaunchedOrRecoveredFightersThisTurn(
    commands: FullThrustGameCommand[],
    turn: number,
    shipId: string
): boolean {
    let cmdTurn = 1;
    for (const cmd of commands) {
        if (cmd.name === "advancePhase") {
            const p = (cmd as { phase?: number }).phase;
            if (typeof p === "number" && p === 1) cmdTurn += 1;
        }
        if (cmdTurn !== turn) continue;

        if (cmd.name === "launchFighters" && (cmd as { ship?: string }).ship === shipId) {
            return true;
        }
        if (cmd.name === "launchGunboats" && (cmd as { ship?: string }).ship === shipId) {
            return true;
        }
        if (cmd.name === "moveFighters") {
            const newPos = (cmd as { position?: unknown }).position;
            if (
                newPos &&
                typeof newPos === "object" &&
                "ship" in newPos &&
                "hangar" in newPos &&
                (newPos as { ship: string }).ship === shipId
            ) {
                return true;
            }
        }
    }
    return false;
}

/** ADFC / area-defense support checks for the supported-ship selection. */
export function pointDefenseSupportIssues(
    position: FullThrustGamePosition,
    defenderShipId: string,
    supportedShipId: string,
    existing: PointDefenseDeclaration[] = [],
    options?: PointDefenseSupportOptions
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (!defenderShipId || !supportedShipId) {
        return issues;
    }

    if (isGunboatPointDefenseDefender(position, defenderShipId)) {
        return gunboatPointDefenseSupportIssues(
            position,
            defenderShipId,
            supportedShipId,
            existing
        );
    }

    const defender = findShip(position, defenderShipId);
    if (!defender) {
        issues.push({
            message: `Defending ship ${defenderShipId} not found.`,
            severity: "error",
        });
        return issues;
    }

    // Direct defense: ships under attack always use their own PD — no ADFC required.
    if (supportedShipId === defenderShipId) {
        return issues;
    }

    const supported = findShip(position, supportedShipId);
    if (!supported) {
        issues.push({
            message: `Supported ship ${supportedShipId} not found.`,
            severity: "error",
        });
        return issues;
    }

    if (defender.owner && supported.owner && defender.owner !== supported.owner) {
        issues.push({
            message: `${defenderShipId} may only provide ADFC area defense for allied ships (${supportedShipId} is ${supported.owner}).`,
            severity: "warning",
        });
    }

    if (adfcSupportSlotCount(defender) <= 0) {
        issues.push({
            message: `${defenderShipId} has no operational ADFC/AADFC — cannot provide area defense for ${supportedShipId}.`,
            severity: "warning",
        });
    }

    const commands = options?.commands;
    const cmdTurn = options?.turn;
    if (
        commands &&
        typeof cmdTurn === "number" &&
        adfcSupportSlotCount(defender) > 0 &&
        shipLaunchedOrRecoveredFightersThisTurn(commands, cmdTurn, defenderShipId)
    ) {
        issues.push({
            message: `${defenderShipId} launched or recovered fighters this turn — ADFC area defense is not available.`,
            severity: "warning",
        });
    }

    if (defender.position && supported.position) {
        const sep = distance(defender.position, supported.position);
        if (sep > 6) {
            issues.push({
                message: `${supportedShipId} must be within 6 MU of ${defenderShipId} for ADFC area defense (currently ${Math.round(sep)} MU).`,
                severity: "warning",
            });
        }
    } else {
        issues.push({
            message: `Cannot verify range between ${defenderShipId} and ${supportedShipId} for ADFC area defense.`,
            severity: "warning",
        });
    }

    if (!shipHasAadfc(defender)) {
        const adfcUsed = existing.filter(
            (d) => d.defenderShip === defenderShipId && d.supportedShip !== defenderShipId
        );
        const otherAlly = adfcUsed.find((d) => d.supportedShip !== supportedShipId);
        if (otherAlly) {
            issues.push({
                message: `Standard ADFC on ${defenderShipId} may only cover one allied ship per turn (already supporting ${otherAlly.supportedShip}).`,
                severity: "warning",
            });
        }
    }

    return issues;
}

export function validateDeclarePointDefense(
    position: FullThrustGamePosition,
    declaration: PointDefenseDeclaration,
    existing: PointDefenseDeclaration[],
    commands: FullThrustGameCommand[],
    turn: number,
    options?: PointDefenseValidationOptions
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const gunboatDefender = isGunboatPointDefenseDefender(position, declaration.defenderShip)
        ? findGunboatSquadron(position, declaration.defenderShip)
        : undefined;
    const ship = gunboatDefender ? undefined : findShip(position, declaration.defenderShip);
    if (!ship && !gunboatDefender) {
        issues.push({ message: `Defender ${declaration.defenderShip} not found.`, severity: "error" });
        return issues;
    }
    const mount = gunboatDefender
        ? operationalGunboatPdMounts(gunboatDefender).find((m) => m.id === declaration.weapon)
        : ship
          ? findWeaponEntry(ship, declaration.weapon)
          : undefined;
    if (!mount) {
        issues.push({ message: `Weapon ${declaration.weapon} not found.`, severity: "error" });
        return issues;
    }
    if (ship) {
        const mounts = operationalPointDefenseMounts(ship);
        if (!mounts.some((m) => m.id === declaration.weapon)) {
            issues.push({
                message: `Weapon ${declaration.weapon} cannot fire point defense.`,
                severity: "error",
            });
        }
    }
    if (existing.some((d) => d.defenderShip === declaration.defenderShip && d.weapon === declaration.weapon)) {
        issues.push({
            message: `Weapon ${declaration.weapon} already allocated this turn.`,
            severity: "error",
        });
    }
    if (options?.weaponUsedThisTurn?.[declaration.weapon] === "shipFire") {
        issues.push({
            message: `Weapon ${declaration.weapon} already used for ship fire this turn.`,
            severity: "error",
        });
    }
    const board = phase9ThreatBoard(position, commands, turn, options);
    if (!isHostileThreatToProtectedShip(position, declaration.threatId, declaration.supportedShip)) {
        issues.push({
            message: `Target ${declaration.threatId} is friendly to ${declaration.supportedShip} and cannot be engaged.`,
            severity: "error",
        });
    }
    if (!isValidThreat(declaration, board, position)) {
        issues.push({
            message: `Target ${declaration.threatId} is not a valid incoming threat for ${declaration.supportedShip}.`,
            severity: "error",
        });
    }
    issues.push(...pointDefenseFighterTargetWarnings(position, board, declaration.threatId));
    issues.push(
        ...pointDefenseSupportIssues(
            position,
            declaration.defenderShip,
            declaration.supportedShip,
            existing,
            { commands, turn }
        )
    );
    const profile = declaration.profile ?? inferProfileFromWeaponName(mount.name);
    const range = pdRangeMu(profile, declaration.adsMode);
    if (!threatWithinRangeMu(position, declaration.defenderShip, declaration.threatId, range)) {
        issues.push({
            message: `Target ${declaration.threatId} out of range (${range} MU) for ${declaration.weapon}.`,
            severity: "warning",
        });
    }
    if (profile === "beam1") {
        issues.push({
            message: `Beam-1 used for PD cannot fire in the Ship Fire phase.`,
            severity: "warning",
        });
    }
    return issues;
}

function isFighterTargetEligibilityWarning(issue: ValidationIssue): boolean {
    if (issue.severity !== "warning") return false;
    return (
        issue.message.includes("unengaged") ||
        issue.message.includes("mutual fighter engagement") ||
        issue.message.includes("fought screeners without bypass")
    );
}

function isPointDefenseSupportIssue(issue: ValidationIssue): boolean {
    return (
        issue.message.includes("area defense") ||
        issue.message.includes("ADFC") ||
        issue.message.includes("gunboat area defense") ||
        issue.message.includes("PDS or ADS gunboat") ||
        issue.message.includes("same-owner ships") ||
        issue.message.includes("Cannot verify range between")
    );
}

export function validateResolvePhase9PointDefense(
    position: FullThrustGamePosition,
    declarations: PointDefenseDeclaration[],
    commands: FullThrustGameCommand[],
    turn: number,
    options?: Pick<PointDefenseValidationOptions, "furballDeclarations">
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (declarations.length === 0) {
        issues.push({ message: "No point defense declarations to resolve.", severity: "error" });
    }
    if (phase9PointDefenseResolvedInLog(commands, turn)) {
        issues.push({ message: "Point defense already resolved this phase.", severity: "error" });
    }
    const board = phase9ThreatBoard(position, commands, turn, options);
    const warnedThreats = new Set<string>();
    for (const decl of declarations) {
        if (warnedThreats.has(decl.threatId)) continue;
        warnedThreats.add(decl.threatId);
        issues.push(...pointDefenseFighterTargetWarnings(position, board, decl.threatId));
    }
    return issues;
}

function formatAllocationSummary(
    position: FullThrustGamePosition,
    decl: PointDefenseDeclaration,
    kills: number,
    mountName: string
): string {
    const threat = findThreatObj(position, decl.threatId);
    const threatLabel =
        threat?.objType === "fighters"
            ? fighterGroupLabel(threat as FighterObj)
            : threat?.objType === "gunboats"
              ? gunboatGroupLabel(threat as { id: string; callsign?: string })
              : decl.threatId;
    return `${decl.defenderShip}/${mountName} → ${threatLabel}: ${kills} kill(s)`;
}

export function sortPointDefenseDeclarations(
    declarations: PointDefenseDeclaration[]
): PointDefenseDeclaration[] {
    return [...declarations].sort((a, b) => {
        const k = a.supportedShip.localeCompare(b.supportedShip);
        if (k !== 0) return k;
        const d = a.defenderShip.localeCompare(b.defenderShip);
        if (d !== 0) return d;
        return a.weapon.localeCompare(b.weapon);
    });
}

function applyPdKills(
    position: FullThrustGamePosition,
    threatId: string,
    kills: number
): { ordnanceDestroyed: boolean; fighterAfter?: number } {
    const obj = findThreatObj(position, threatId);
    if (!obj) return { ordnanceDestroyed: false };
    if (obj.objType === "ordnance" && kills > 0) {
        position.objects = (position.objects ?? []).filter((o) => o.id !== threatId);
        return { ordnanceDestroyed: true };
    }
    if (obj.objType === "fighters") {
        const f = obj as FighterObj;
        const before = f.number ?? 6;
        const after = Math.max(0, before - kills);
        f.number = after;
        if (after === 0) {
            clearFighterAttachment(f);
            position.objects = (position.objects ?? []).filter((o) => o.id !== threatId);
        }
        return { ordnanceDestroyed: false, fighterAfter: after };
    }
    if (obj.objType === "gunboats" && kills > 0) {
        const g = obj as {
            number?: number;
            boats?: { type: string; id?: string }[];
            protection?: "heavy" | "screened";
        };
        applyGunboatKills(g, kills);
        const after = g.number ?? 0;
        if (after === 0) {
            position.objects = (position.objects ?? []).filter((o) => o.id !== threatId);
        }
        return { ordnanceDestroyed: false, fighterAfter: after };
    }
    return { ordnanceDestroyed: false };
}

export interface ApplyPointDefenseMountOptions {
    /** When false, fighter-PD self-destruct is computed but not applied (log uses adjustFighters). */
    applySelfDestruct?: boolean;
}

/** Resolve one PD mount from a roll source (does not mutate position). */
export function resolvePointDefenseMount(
    position: FullThrustGamePosition,
    declaration: PointDefenseDeclaration,
    source: RollSource
): {
    kills: number;
    rolls: number[];
    mountName: string;
    fighterSelfDestruct?: { wingId: string; losses: number; numberAfter: number };
} {
    const mark = source.mark();
    const gunboatDefender = isGunboatPointDefenseDefender(position, declaration.defenderShip)
        ? findGunboatSquadron(position, declaration.defenderShip)
        : undefined;
    const ship = gunboatDefender ? undefined : findShip(position, declaration.defenderShip);
    const mount = gunboatDefender
        ? operationalGunboatPdMounts(gunboatDefender).find((m) => m.id === declaration.weapon)
        : ship
          ? findWeaponEntry(ship, declaration.weapon)
          : undefined;
    const profile = declaration.profile ?? inferProfileFromWeaponName(mount?.name);
    const threat = findThreatObj(position, declaration.threatId);
    const threatKind = threatKindForTarget(
        threat?.objType,
        threat?.objType === "ordnance" ? (threat as { type?: string }).type : undefined
    );
    const fighterCount =
        threat?.objType === "fighters" ? (threat as FighterObj).number ?? 6 : 1;

    const gunboatDrm =
        threat?.objType === "gunboats"
            ? gunboatProtectionDrm({
                  protection: (threat as { protection?: "heavy" | "screened" }).protection,
              })
            : 0;
    const fighterPdDrm =
        threat?.objType === "fighters"
            ? fighterProfileFor(fighterWingFromObj(threat as FighterObj)).pdTargetDrm
            : 0;

    const result = resolvePointDefenseProfile(
        profile,
        threatKind,
        source,
        profile === "fighterPd" ? fighterCount : 1,
        gunboatDrm + fighterPdDrm
    );
    let kills = result.kills;

    if (threat?.objType === "fighters") {
        const before = (threat as FighterObj).number ?? 6;
        kills = Math.min(kills, before);
    } else if (threat?.objType === "gunboats") {
        const before = (threat as { number?: number }).number ?? 6;
        kills = Math.min(kills, before);
    } else if (threat?.objType === "ordnance") {
        kills = Math.min(kills, 1);
    }

    let fighterSelfDestruct: { wingId: string; losses: number; numberAfter: number } | undefined;
    if (
        profile === "fighterPd" &&
        (threatKind === "salvo" || threatKind === "heavy") &&
        kills > 0
    ) {
        const selfDestruct = resolveFighterPdSelfDestruct(kills, source);
        const f = findFighter(position, declaration.defenderShip);
        if (f && isDeployedFighter(f) && selfDestruct.losses > 0) {
            const before = f.number ?? 6;
            fighterSelfDestruct = {
                wingId: declaration.defenderShip,
                losses: selfDestruct.losses,
                numberAfter: Math.max(0, before - selfDestruct.losses),
            };
        }
    }

    return {
        kills,
        rolls: source.consumedSince(mark),
        mountName: mount?.name ?? declaration.weapon,
        fighterSelfDestruct,
    };
}

/** Apply one PD mount from its roll slice (scrub-back replay unit). */
export function applyPointDefenseMountFromRolls(
    position: FullThrustGamePosition,
    declaration: PointDefenseDeclaration,
    rolls: number[],
    options?: ApplyPointDefenseMountOptions
): PointDefenseAllocationResult {
    const applySelfDestruct = options?.applySelfDestruct !== false;
    const resolved = resolvePointDefenseMount(position, declaration, arrayRollSource(rolls));

    if (resolved.fighterSelfDestruct && applySelfDestruct) {
        const f = findFighter(position, resolved.fighterSelfDestruct.wingId);
        if (f && isDeployedFighter(f)) {
            f.number = resolved.fighterSelfDestruct.numberAfter;
            if (resolved.fighterSelfDestruct.numberAfter === 0) {
                clearFighterAttachment(f);
                position.objects = (position.objects ?? []).filter(
                    (o) => o.id !== resolved.fighterSelfDestruct!.wingId
                );
            }
        }
    }

    const applyResult = applyPdKills(position, declaration.threatId, resolved.kills);
    return {
        declaration,
        kills: resolved.kills,
        rolls: [...rolls],
        summary: formatAllocationSummary(
            position,
            declaration,
            resolved.kills,
            resolved.mountName
        ),
        ordnanceDestroyed: applyResult.ordnanceDestroyed,
        fighterAfter: applyResult.fighterAfter,
        fighterSelfDestruct: resolved.fighterSelfDestruct,
    };
}

function survivingFighterAttackersFromBoard(
    position: FullThrustGamePosition,
    commands: FullThrustGameCommand[],
    turn: number
): Phase9PointDefenseBatchResult["survivingFighterAttackers"] {
    const board = incomingThreatsForPhase9(position, commands, turn);
    return board.fighters
        .filter((f: FighterThreat) => f.kind === "shipAttack")
        .map((f) => ({
            groupId: f.groupId,
            targetShipId: f.targetShipId,
            number: findFighter(position, f.groupId)?.number ?? 0,
        }))
        .filter((f) => f.number > 0);
}

export function applyPhase9PointDefenseBatch(
    position: FullThrustGamePosition,
    declarations: PointDefenseDeclaration[],
    source: RollSource,
    commands: FullThrustGameCommand[],
    turn: number
): Phase9PointDefenseBatchResult {
    const sorted = sortPointDefenseDeclarations(declarations);

    const allRolls: number[] = [];
    const allocations: PointDefenseAllocationResult[] = [];
    const pdKillsByOrdnance: Record<string, number> = {};

    for (const decl of sorted) {
        const threatBefore = findThreatObj(position, decl.threatId);
        const resolved = resolvePointDefenseMount(position, decl, source);
        const allocation = applyPointDefenseMountFromRolls(position, decl, resolved.rolls, {
            applySelfDestruct: true,
        });
        allRolls.push(...resolved.rolls);

        if (threatBefore?.objType === "ordnance" && allocation.kills > 0) {
            pdKillsByOrdnance[decl.threatId] =
                (pdKillsByOrdnance[decl.threatId] ?? 0) + allocation.kills;
        }
        allocations.push(allocation);
    }

    return {
        rolls: allRolls,
        notes: allocations.map((a) => a.summary).join(" | "),
        allocations,
        pdKillsByOrdnance,
        survivingFighterAttackers: survivingFighterAttackersFromBoard(position, commands, turn),
    };
}

export function applyPhase9PointDefenseBatchFromRolls(
    position: FullThrustGamePosition,
    declarations: PointDefenseDeclaration[],
    rolls: number[],
    commands: FullThrustGameCommand[],
    turn: number
): Phase9PointDefenseBatchResult {
    return applyPhase9PointDefenseBatch(
        position,
        declarations,
        arrayRollSource(rolls),
        commands,
        turn
    );
}

export function validateResolvePointDefenseMount(
    position: FullThrustGamePosition,
    declaration: PointDefenseDeclaration,
    existing: PointDefenseDeclaration[],
    commands: FullThrustGameCommand[],
    turn: number,
    options?: Pick<PointDefenseValidationOptions, "furballDeclarations">
): ValidationIssue[] {
    if (phase9PointDefenseResolvedInLog(commands, turn)) {
        return [{ message: "Point defense already resolved this phase.", severity: "error" }];
    }
    const match = existing.find(
        (d) => d.defenderShip === declaration.defenderShip && d.weapon === declaration.weapon
    );
    if (!match) {
        return [
            {
                message: `No matching declaration for ${declaration.defenderShip}/${declaration.weapon}.`,
                severity: "error",
            },
        ];
    }
    return validateDeclarePointDefense(
        position,
        match,
        existing.filter(
            (d) => !(d.defenderShip === declaration.defenderShip && d.weapon === declaration.weapon)
        ),
        commands,
        turn,
        options
    );
}

export function buildPhase9PdResolveCommands(
    result: Phase9PointDefenseBatchResult,
    diceSource: "client" | "moderatorSequence" = "client"
): FullThrustGameCommand[] {
    const commands: FullThrustGameCommand[] = [];
    for (const a of result.allocations) {
        const decl = a.declaration;
        const purpose = `phase9: ${decl.defenderShip}/${decl.weapon} → ${decl.threatId}`;
        if (a.rolls.length > 0) {
            commands.push({
                name: "logDice",
                purpose,
                rolls: a.rolls,
                source: diceSource,
                result: a.summary,
            } as FullThrustGameCommand);
        }
        commands.push({
            name: "resolvePointDefenseMount",
            defenderShip: decl.defenderShip,
            weapon: decl.weapon,
            supportedShip: decl.supportedShip,
            threatId: decl.threatId,
            profile: decl.profile,
            adsMode: decl.adsMode,
            splitTargetId: decl.splitTargetId,
            rolls: a.rolls,
        } as FullThrustGameCommand);
        commands.push({
            name: "_custom",
            msg: `Point defense: ${a.summary}`,
        } as FullThrustGameCommand);
        if (a.fighterSelfDestruct && a.fighterSelfDestruct.losses > 0) {
            commands.push({
                name: "adjustFighters",
                id: a.fighterSelfDestruct.wingId,
                number: a.fighterSelfDestruct.numberAfter,
            } as FullThrustGameCommand);
        }
    }
    commands.push({
        name: "resolvePhase9Complete",
        count: result.allocations.length,
        pdKillsByOrdnance: result.pdKillsByOrdnance,
        survivingFighterAttackers: result.survivingFighterAttackers,
        notes: result.notes,
    } as FullThrustGameCommand);
    return commands;
}

export function fightersAttackingShip(
    position: FullThrustGamePosition,
    commands: FullThrustGameCommand[],
    turn: number,
    shipId: string
): Array<{ groupId: string; number: number }> {
    const board = incomingThreatsForPhase9(position, commands, turn);
    return board.fighters
        .filter((f) => f.kind === "shipAttack" && f.targetShipId === shipId)
        .map((f) => ({
            groupId: f.groupId,
            number: findFighter(position, f.groupId)?.number ?? f.number,
        }))
        .filter((f) => f.number > 0);
}
