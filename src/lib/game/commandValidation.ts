/** Soft validation of commands against game state (helpers, not hard enforcement). */

import type { FullThrustGameCommand } from "@/schemas/commands";
import type { FullThrustGamePosition } from "@/schemas/position";
import type { FoldState } from "./applyCommand";
import {
    turnBudget,
    validateCinematicOrders,
    cinematicFinalSpeed,
    type ClockFacing,
    type CinematicAllocation,
} from "./movement";
import {
    isVectorShip,
    maneuverPoints,
    validateVectorOrders,
    facingToCourse,
    type VectorManeuver,
} from "./vectorMovement";
import { canFighterMove, FIGHTER_SECONDARY_MU, FIGHTER_MOVE_MU } from "./fighters";
import {
    FIGHTER_CALLSIGN_MAX_LENGTH,
    normalizeCallsign,
} from "./fighterLabel";
import {
    validateMoveFightersCommand,
    validatePursueFighters,
    validateScreenFighters,
} from "./fighterMove";
import {
    validateAllocateOrdnanceTarget,
    validateDeclareFighterAttack,
} from "./fighterAttack";
import { validateDeclareGunboatAttack } from "./gunboatAttack";
import { validateLaunchGunboatOrdnance } from "./gunboatOrdnanceLaunch";
import { validateLaunchFighterOrdnance } from "./fighterOrdnanceLaunch";
import { validateSetFighterType } from "./fighterTypeCommand";
import { gunboatAttackAllocations } from "./gunboatEngagement";
import { validateGunboatInterceptOrdnance } from "./gunboatIntercept";
import { validateMoveGunboatsCommand, validateScreenGunboats, validatePursueGunboats } from "./gunboatMove";
import { fighterAttackAllocations } from "./fighterEngagement";
import { validateDeclareFurball, validateResolvePhase8Furballs } from "./fighterPhase8";
import {
    validateDeclarePointDefense,
    validateResolvePhase9PointDefense,
    validateResolvePointDefenseMount,
} from "./pointDefensePhase9";
import {
    screeningEngagementPlan,
    validateFurballAgainstScreening,
} from "./fighterScreening";
import type { FurballEngagement } from "./fighterDogfight";
import { validateInterceptOrdnance } from "./fighterIntercept";
import {
    ammoUses,
    findShipSystem,
    hangarCapacity,
    isPdsWeapon,
    isSystemDestroyed,
    isSystemDamaged,
    isSystemDamagedOrDestroyed,
    operationalHangars,
    operationalMinelayers,
    operationalMineSweepers,
    operationalFireControls,
    installedFireControls,
    functionalFireControls,
    shipRequiresFireControl,
    ordnanceSystemIds,
    ordnanceTypeMatchesSystem,
    findWeaponEntry,
    shipThrust,
    systemShotCapacity,
    type ShipGameState,
    type ShipSystemEntry,
} from "./shipSystems";
import {
    shipsCompletedActivation,
    shipsWithPendingFireOrders,
    pendingFireForShip,
    attackerOrdersCompleteForShip,
    phase12UndeclaredAttackerShips,
    phase12UndeclaredDefenderShips,
    repairOrdersDeclaredForShip,
} from "./segmentApply";
import { decodeFireDeclarationNotes } from "./resolveCombat";
import { shipFireProfile, type ShipFireProfileKey } from "./shipFireProfiles";
import { beamDicePool } from "./combat";
import {
    inferProjectileRangeProfile,
    projectileHitThreshold,
    targetStealthLevel,
} from "./projectileHit";
import {
    needleSensorRequirementMessage,
    needleSensorRequirementMet,
} from "./needleFire";
import {
    commandoValidTargets,
    transporterFirerCapacity,
    type TransporterDeliveryChoice,
} from "./transporterFire";
import { pendingForFirer } from "./weaponFireState";
import {
    empContributorKey,
    empValidTargets,
    declaredEmpContributorKeys,
    type EmpAllocation,
} from "./empFire";
import {
    boarderUnitsOnShip,
    totalBoardersOnShip,
    type ShipWithBoarders,
} from "./boardingState";
import {
    BOARDING_STEP_LABELS,
    decodeAttackerBoardingNotes,
    decodeDefenderBoardingNotes,
    type DefenderBoardingNotes,
} from "./boardingOrders";
import { shipBoardingCrewCapacity } from "./shipSystems";
import {
    availableMarineIds,
    availableHiredDcpIds,
    availableBuiltinDcp,
    dcpAvailabilityForShip,
    type ShipWithCrewDeployment,
} from "./crewDeployment";
import { isSegmentActivationPhase } from "./phase";
import type { GameMeta } from "./types";
import { decodeRepairOrdersNotes, totalDcpAllocated } from "./repairOrders";
import { repairTargetsForShip, shipNeedsRepairOrders, type ShipWithRepairState } from "./repairSystems";
import { canConsumeAmmunition, systemDesignCapacity } from "@/lib/ammunition";
import {
    declaredMineLayersFromPending,
    pathWithinMu,
    mineLaysComplete,
    shipsNeedingMinePlacements,
    minePhaseDiceCount,
    resolvePhase5MovementSequence,
    PATH_SNAP_TOLERANCE_MU,
} from "./mineMovement";
import { previewPathForShip } from "./movementResolve";
import {
    validateLaunchFightersDeclaration,
    validateMoveShipLaunchFighters,
} from "./fighterLaunchDeclare";
import { coerceGamePhase, SHIP_MOVEMENT_RESOLVE_PHASE } from "./phase";
import { validateShipObject } from "@/lib/shipValidation";

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
    message: string;
    severity: ValidationSeverity;
}

export interface CommandAudit {
    location: number;
    command: string;
    description: string;
    severity: ValidationSeverity;
}

function shipById(
    position: FullThrustGamePosition,
    id: string
): ShipGameState | undefined {
    const obj = position.objects?.find((o) => o.objType === "ship" && o.id === id);
    return obj as ShipGameState | undefined;
}

export function validateMoveShipMineOptions(
    ship: ShipGameState,
    cmd: { sweepForMines?: boolean; deployMineLayers?: string[] }
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (cmd.sweepForMines) {
        if (operationalMineSweepers(ship).length === 0) {
            issues.push({
                message: "This ship has no operational mine sweeper.",
                severity: "error",
            });
        }
    }
    const layers = cmd.deployMineLayers ?? [];
    const seen = new Set<string>();
    for (const systemId of layers) {
        if (seen.has(systemId)) {
            issues.push({
                message: `Duplicate minelayer declaration for ${systemId}.`,
                severity: "error",
            });
            continue;
        }
        seen.add(systemId);
        const sys = findShipSystem(ship, systemId);
        const isLayer = operationalMinelayers(ship).some((m) => m.id === systemId);
        if (!sys || !isLayer) {
            issues.push({
                message: `Minelayer system "${systemId}" is not operational on this ship.`,
                severity: "error",
            });
            continue;
        }
        if (!canConsumeAmmunition(ship, systemId)) {
            const cap = systemDesignCapacity(ship, systemId) ?? 0;
            issues.push({
                message: `No mine loads remaining for layer ${systemId} (0/${cap}).`,
                severity: "error",
            });
        }
    }
    return issues;
}

export function validateMoveShip(
    ship: ShipGameState,
    cmd: {
        speed?: number;
        facing?: number;
        vectorManeuvers?: VectorManeuver[];
        course?: number;
        sweepForMines?: boolean;
        deployMineLayers?: string[];
    },
    opts: { advancedDrives?: boolean } = {}
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const thrust = shipThrust(ship);
    const speed = Number(ship.speed ?? 0) || 0;
    const facing = (ship.facing ?? 12) as ClockFacing;
    const vector = isVectorShip(ship);

    if (vector && cmd.vectorManeuvers?.length) {
        const course =
            ship.course ??
            cmd.course ??
            facingToCourse(facing);
        issues.push(
            ...validateVectorOrders(
                {
                    position: { x: 0, y: 0 },
                    facing,
                    course,
                    speed,
                    thrust,
                },
                { maneuvers: cmd.vectorManeuvers }
            ).map((message) => ({ message, severity: "error" as const }))
        );
        issues.push(
            ...validateMoveShipMineOptions(ship, {
                sweepForMines: cmd.sweepForMines,
                deployMineLayers: cmd.deployMineLayers,
            })
        );
        return issues;
    }

    if (!vector && cmd.speed !== undefined) {
        for (const message of validateCinematicOrders(
            {
                position: { x: 0, y: 0 },
                facing,
                speed,
                thrust,
                advancedDrives: opts.advancedDrives,
            },
            { newSpeed: cmd.speed, turns: 0 }
        )) {
            issues.push({ message, severity: "error" });
        }
        const delta = Math.abs(cmd.speed - speed);
        if (delta > thrust) {
            issues.push({
                message: `Speed change ${delta} exceeds thrust rating ${thrust}.`,
                severity: "error",
            });
        }
    }

    issues.push(
        ...validateMoveShipMineOptions(ship, {
            sweepForMines: cmd.sweepForMines,
            deployMineLayers: cmd.deployMineLayers,
        })
    );

    return issues;
}

export function validateLaunchFighters(
    ship: ShipGameState,
    opts: { fighterCount?: number } = {}
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const hangars = operationalHangars(ship);
    if (hangars.length === 0) {
        issues.push({
            message: "This ship has no operational fighter hangar.",
            severity: "error",
        });
        return issues;
    }
    const capacity = hangarCapacity(ship);
    const count = opts.fighterCount ?? 6;
    if (count > capacity) {
        issues.push({
            message: `Launching ${count} fighters exceeds hangar capacity (${capacity}).`,
            severity: "error",
        });
    }
    return issues;
}

export function validateFighterCallsignField(
    callsign: string | undefined,
    opts: { required?: boolean } = {}
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (callsign === undefined || callsign === "") {
        if (opts.required) {
            issues.push({ message: "Callsign is required.", severity: "error" });
        }
        return issues;
    }
    const trimmed = callsign.trim();
    if (!trimmed && opts.required) {
        issues.push({ message: "Callsign is required.", severity: "error" });
        return issues;
    }
    if (trimmed.length > FIGHTER_CALLSIGN_MAX_LENGTH) {
        issues.push({
            message: `Callsign must be at most ${FIGHTER_CALLSIGN_MAX_LENGTH} characters.`,
            severity: "error",
        });
    }
    return issues;
}

export function validateSetFighterCallsign(
    position: FullThrustGamePosition,
    cmd: { id?: string; callsign?: string }
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const id = cmd.id ?? "";
    if (!id) {
        issues.push({ message: "setFighterCallsign: missing fighter id.", severity: "error" });
        return issues;
    }
    const fighter = position.objects?.find((o) => o.objType === "fighters" && o.id === id);
    if (!fighter) {
        issues.push({ message: `Fighter group not found: ${id}`, severity: "error" });
        return issues;
    }
    issues.push(...validateFighterCallsignField(cmd.callsign));
    return issues;
}

export function validateSetFighterTypeCommand(
    position: FullThrustGamePosition,
    cmd: { id?: string; type?: string }
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const id = cmd.id ?? "";
    if (!id) {
        issues.push({ message: "setFighterType: missing fighter id.", severity: "error" });
        return issues;
    }
    if (!cmd.type) {
        issues.push({ message: "setFighterType: missing type.", severity: "error" });
        return issues;
    }
    const err = validateSetFighterType(cmd.type);
    if (err) issues.push({ message: err, severity: "error" });
    const fighter = position.objects?.find((o) => o.objType === "fighters" && o.id === id);
    if (!fighter) {
        issues.push({ message: `Fighter group not found: ${id}`, severity: "error" });
    }
    return issues;
}

export function validateLaunchOrdnance(
    ship: ShipGameState,
    systemId: string,
    ordnanceType: string
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (!systemId) {
        issues.push({ message: "Select a launching system id.", severity: "error" });
        return issues;
    }
    const sys = findShipSystem(ship, systemId);
    if (!sys) {
        const known = ordnanceSystemIds(ship);
        issues.push({
            message:
                known.length > 0
                    ? `System "${systemId}" is not on this ship (ordnance/weapons: ${known.join(", ")}).`
                    : `System "${systemId}" is not on this ship (no ordnance systems on SSD).`,
            severity: "error",
        });
        return issues;
    }
    if (isSystemDestroyed(ship, systemId)) {
        issues.push({
            message: `Launch system "${systemId}" is destroyed.`,
            severity: "error",
        });
    }
    const cap = systemShotCapacity(sys);
    const used = ammoUses(ship, systemId);
    if (cap !== undefined && used >= cap) {
        issues.push({
            message: `No ammunition left for "${systemId}" (${used}/${cap} used).`,
            severity: "error",
        });
    }
    if (!ordnanceTypeMatchesSystem(ordnanceType, sys)) {
        issues.push({
            message: `System "${systemId}" (${sys.name ?? "?"}) may not launch type "${ordnanceType}".`,
            severity: "warning",
        });
    }
    return issues;
}

export function validateLayMine(
    fold: FoldState,
    cmd: {
        ship?: string;
        systemId?: string;
        position?: { x: number; y: number };
    }
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const shipId = cmd.ship ?? "";
    const systemId = cmd.systemId ?? "";
    const ship = shipById(fold.position, shipId);
    if (!ship) {
        return [{ message: `Ship not found: ${shipId}`, severity: "error" }];
    }
    if (!systemId) {
        issues.push({ message: "Select a minelayer system.", severity: "error" });
        return issues;
    }
    const layers = operationalMinelayers(ship);
    if (!layers.some((m) => m.id === systemId)) {
        issues.push({
            message: `Minelayer system "${systemId}" is not operational on this ship.`,
            severity: "error",
        });
        return issues;
    }
    const declared = declaredMineLayersFromPending(fold.pendingMoves, shipId);
    if (!declared.includes(systemId)) {
        issues.push({
            message: `Ship ${shipId} did not declare laying from layer ${systemId} in phase 1.`,
            severity: "error",
        });
    }
    const alreadyQueued = (fold.pendingLayMines ?? []).some(
        (l) =>
            l.name === "layMine" &&
            (l as { ship?: string }).ship === shipId &&
            (l as { systemId?: string }).systemId === systemId
    );
    if (alreadyQueued) {
        issues.push({
            message: `Placement for ${shipId} layer ${systemId} is already recorded.`,
            severity: "error",
        });
    }
    if (!canConsumeAmmunition(ship, systemId)) {
        const cap = systemDesignCapacity(ship, systemId) ?? 0;
        issues.push({
            message: `No mine loads remaining for layer ${systemId} (0/${cap}).`,
            severity: "error",
        });
    }
    const pos = cmd.position;
    if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number") {
        issues.push({ message: "Select a position along the movement path.", severity: "error" });
        return issues;
    }
    const path = previewPathForShip(ship, fold.pendingMoves);
    if (!pathWithinMu(path, pos, PATH_SNAP_TOLERANCE_MU)) {
        issues.push({
            message: `Mine position must lie on ${shipId}'s movement path (within ${PATH_SNAP_TOLERANCE_MU} MU).`,
            severity: "error",
        });
    }
    return issues;
}

export function validatePlaceShip(cmd: FullThrustGameCommand): ValidationIssue[] {
    if (cmd.name !== "placeShip") return [];
    const obj = (cmd as { object?: unknown }).object;
    if (!obj) {
        return [{ message: "placeShip: missing ship object", severity: "error" }];
    }
    const check = validateShipObject(obj);
    const issues: ValidationIssue[] = [];
    for (const message of check.blockingMessages) {
        issues.push({ message: `placeShip: ${message}`, severity: "error" });
    }
    for (const message of check.warnings) {
        issues.push({
            message: `placeShip: ${message}`,
            severity: "warning",
        });
    }
    const ship = obj as {
        weapons?: { name?: string; range?: string; mode?: string }[];
        mass?: number;
    };
    for (const w of ship.weapons ?? []) {
        const name = (w.name ?? "").toLowerCase();
        if (name === "pulser" && (!w.range || w.range === "undefined")) {
            issues.push({
                message: "placeShip: pulser weapon missing range (short/medium/long)",
                severity: "warning",
            });
        }
        if (name === "fusion" && (!w.mode || w.mode === "undefined")) {
            issues.push({
                message: "placeShip: fusion array missing mode (flare/torpedo)",
                severity: "warning",
            });
        }
    }
    const mass = Number(ship.mass ?? 0);
    if (mass > 0) {
        const spinalCap = 16 * Math.floor(mass / 50);
        let spinalMass = 0;
        for (const w of ship.weapons ?? []) {
            const n = (w.name ?? "").toLowerCase();
            if (n.startsWith("spinal")) {
                const r = String(w.range ?? "medium").toLowerCase();
                spinalMass += r === "short" ? 8 : r === "long" ? 32 : 16;
            }
        }
        if (spinalMass > spinalCap) {
            issues.push({
                message: `placeShip: spinal mount mass ${spinalMass} exceeds cap ${spinalCap} for mass ${mass}`,
                severity: "warning",
            });
        }
    }
    return issues;
}

export function validateResolvePhase5Movement(fold: FoldState): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const phase = coerceGamePhase(fold.meta.phase);
    if (phase !== SHIP_MOVEMENT_RESOLVE_PHASE) {
        issues.push({
            message: "resolvePhase5Movement is only legal in phase 5.",
            severity: "error",
        });
    }
    if (fold.phase5ResolvedMoves?.length || fold.phase5MovementResolved) {
        issues.push({
            message: "Movement already resolved this phase.",
            severity: "error",
        });
    }
    const shipCount =
        fold.position.objects?.filter((o) => o.objType === "ship" && o.position != null).length ??
        0;
    if (
        shipCount === 0 &&
        (fold.pendingMoves?.length ?? 0) === 0 &&
        (fold.pendingLayMines?.length ?? 0) === 0
    ) {
        issues.push({
            message: "No ships or movement orders to resolve.",
            severity: "error",
        });
    }
    if (!mineLaysComplete(fold.pendingMoves, fold.pendingLayMines)) {
        const needs = shipsNeedingMinePlacements(fold.pendingMoves, fold.pendingLayMines);
        for (const n of needs) {
            issues.push({
                message: `Minelayer placement still needed: ${n.shipId} / ${n.systemId}.`,
                severity: "error",
            });
        }
    }
    return issues;
}

export function validateResolveMinePhase(fold: FoldState): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (!fold.phase5ResolvedMoves?.length) {
        issues.push({
            message: "Resolve phase 5 movement before entering mine sweep/detonation dice.",
            severity: "error",
        });
    }
    return issues;
}

export function validateAdvancePhase(
    fold: FoldState,
    cmd: { phase?: number }
): ValidationIssue[] {
    const prevPhase = coerceGamePhase(fold.meta.phase);
    const nextPhase = coerceGamePhase(cmd.phase ?? 1);
    if (prevPhase !== SHIP_MOVEMENT_RESOLVE_PHASE || nextPhase <= SHIP_MOVEMENT_RESOLVE_PHASE) {
        return [];
    }

    if (fold.phase5MovementResolved && !fold.phase5ResolvedMoves?.length) {
        return [];
    }

    let moves = fold.phase5ResolvedMoves;
    let position = fold.position;
    if (!moves?.length && !fold.phase5MovementResolved) {
        const preview = resolvePhase5MovementSequence(
            position,
            fold.meta,
            fold.pendingMoves,
            fold.pendingLayMines
        );
        moves = preview.moves;
        position = preview.position;
    }

    if (!moves?.length) return [];

    const dice = minePhaseDiceCount(moves, position, fold.meta);
    if (dice.total > 0) {
        return [
            {
                message: `Resolve mine sweep/detonation (${dice.sweeps} sweep, ${dice.detonations} detonation dice) before leaving phase 5.`,
                severity: "error",
            },
        ];
    }
    return [];
}

function shipUsedMinesweeperThisTurn(ship: ShipGameState | undefined): boolean {
    return !!(ship as { movementFlags?: { sweepForMines?: boolean } })?.movementFlags
        ?.sweepForMines;
}

function isDefensiveFireOrder(ship: ShipGameState, order: FireOrderSummary): boolean {
    if (order.profile === "pds") return true;
    const weapon = findShipSystem(ship, order.weaponId);
    if (weapon && (weapon.name === "screen" || isPdsWeapon(weapon))) return true;
    return false;
}

export function validateMoveFighters(
    from: { x: number; y: number },
    to: { x: number; y: number },
    secondary: boolean,
    endurance?: number
): ValidationIssue[] {
    const allowance = secondary ? FIGHTER_SECONDARY_MU : FIGHTER_MOVE_MU;
    const issues: ValidationIssue[] = [];
    if (!canFighterMove(from, to, allowance)) {
        issues.push({
            message: `Move exceeds ${secondary ? "secondary (12 MU)" : "fighter (24 MU)"} allowance.`,
            severity: "warning",
        });
    }
    if (secondary && (endurance ?? 0) <= 0) {
        issues.push({
            message: "No endurance remaining for a secondary move.",
            severity: "warning",
        });
    }
    return issues;
}

export function validateCinematicAllocation(
    ship: ShipGameState,
    allocation: CinematicAllocation,
    advancedDrives: boolean
): ValidationIssue[] {
    const thrust = shipThrust(ship);
    const speed = Number(ship.speed ?? 0) || 0;
    const issues: ValidationIssue[] = [];
    const speedThrust = Math.max(0, Number(allocation.speedChangeThrust) || 0);

    if (allocation.speedChange !== "hold" && speedThrust > thrust) {
        issues.push({
            message: `Speed change thrust ${speedThrust} exceeds thrust rating ${thrust}.`,
            severity: "error",
        });
    }
    if (allocation.speedChange === "hold" && speedThrust > 0) {
        issues.push({
            message: "Clear speed-change thrust when holding speed.",
            severity: "warning",
        });
    }

    const newSpeed = cinematicFinalSpeed(speed, thrust, allocation);
    issues.push(
        ...validateCinematicMoveOrders(ship, newSpeed, allocation.turns, advancedDrives)
    );
    return issues;
}

export function validateCinematicMoveOrders(
    ship: ShipGameState,
    newSpeed: number,
    turns: number,
    advancedDrives: boolean
): ValidationIssue[] {
    const thrust = shipThrust(ship);
    const speed = Number(ship.speed ?? 0) || 0;
    const facing = (ship.facing ?? 12) as ClockFacing;
    const issues: ValidationIssue[] = [];
    for (const message of validateCinematicOrders(
        {
            position: { x: 0, y: 0 },
            facing,
            speed,
            thrust,
            advancedDrives,
        },
        { newSpeed, turns }
    )) {
        issues.push({ message, severity: "error" });
    }
    const maxTurns = turnBudget(thrust, advancedDrives);
    if (Math.abs(turns) > maxTurns) {
        issues.push({
            message: `Turns ${Math.abs(turns)} exceed turn budget ${maxTurns}.`,
            severity: "error",
        });
    }
    return issues;
}

export function validateVectorManeuverQueue(
    ship: ShipGameState,
    maneuvers: VectorManeuver[]
): ValidationIssue[] {
    const thrust = shipThrust(ship);
    const speed = Number(ship.speed ?? 0) || 0;
    const facing = (ship.facing ?? 12) as ClockFacing;
    const course = Number(ship.course ?? facingToCourse(facing));
    const pos = ship.position;
    const position =
        pos && typeof pos === "object" && "x" in pos
            ? { x: Number(pos.x), y: Number(pos.y) }
            : { x: 0, y: 0 };
    return validateVectorOrders(
        { position, facing, course, speed, thrust },
        { maneuvers }
    ).map((message) => ({ message, severity: "error" as const }));
}

export interface FireOrderSummary {
    weaponId: string;
    targetId: string;
    profile: string;
    fireControlId?: string;
}

export function summarizeFireDeclaration(
    cmd: FullThrustGameCommand
): FireOrderSummary | null {
    if (cmd.name !== "declareShipFire") return null;
    const c = cmd as { weapon?: string; target?: string; notes?: string };
    if (!c.weapon || !c.target) return null;
    const meta = decodeFireDeclarationNotes(c.notes);
    return {
        weaponId: c.weapon,
        targetId: c.target,
        profile: meta.profile ?? "beam",
        fireControlId: meta.fireControlId,
    };
}

/** Distinct enemy targets with non-PDS weapon fire. */
export function distinctShipFireTargets(orders: FireOrderSummary[]): string[] {
    const targets = new Set<string>();
    for (const o of orders) {
        if (o.profile === "pds") continue;
        targets.add(o.targetId);
    }
    return [...targets];
}

export function validateFireControlAssignments(
    ship: ShipGameState,
    fcTargets: Record<string, string>,
    orders: FireOrderSummary[]
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const shipFire = orders.filter((o) => o.profile !== "pds");
    if (shipFire.length === 0) return issues;

    const fcCount = operationalFireControls(ship).length;
    if (fcCount === 0) return issues;

    const targetsWithWeapons = distinctShipFireTargets(orders);
    if (targetsWithWeapons.length > fcCount) {
        issues.push({
            message: `Ship ${ship.id} would fire at ${targetsWithWeapons.length} distinct target(s) but only has ${fcCount} fire-control module(s).`,
            severity: "warning",
        });
    }

    const fcAssignedTargets = new Set(
        Object.values(fcTargets).filter((t) => t && t.length > 0)
    );
    for (const targetId of targetsWithWeapons) {
        if (!fcAssignedTargets.has(targetId)) {
            issues.push({
                message: `No fire control assigned to target ${targetId}.`,
                severity: "warning",
            });
        }
    }

    for (const order of shipFire) {
        if (!order.fireControlId) {
            issues.push({
                message: `Weapon ${order.weaponId} has no fire-control assignment.`,
                severity: "warning",
            });
            continue;
        }
        const fcTarget = fcTargets[order.fireControlId];
        if (!fcTarget) {
            issues.push({
                message: `Fire control ${order.fireControlId} is not assigned to a target.`,
                severity: "warning",
            });
        } else if (fcTarget !== order.targetId) {
            issues.push({
                message: `Weapon ${order.weaponId} targets ${order.targetId} but fire control ${order.fireControlId} is assigned to ${fcTarget}.`,
                severity: "warning",
            });
        }
    }

    const weaponIds = shipFire.map((o) => o.weaponId);
    const dupes = weaponIds.filter((w, i) => weaponIds.indexOf(w) !== i);
    if (dupes.length) {
        issues.push({
            message: `Duplicate weapon orders: ${[...new Set(dupes)].join(", ")}.`,
            severity: "warning",
        });
    }

    return issues;
}

export interface FireOrderRangeCheckInput {
    weaponId: string;
    weaponName?: string;
    profileKey: ShipFireProfileKey;
    beamClass: number;
    rangeMu: number;
    weapon?: ShipSystemEntry;
    targetShip?: ShipGameState | { object?: unknown };
}

/** Warning when range leaves no dice / no hit chance (order still allowed). */
export function fireOrderIneffectiveAtRangeIssue(
    input: FireOrderRangeCheckInput
): ValidationIssue | undefined {
    const { weaponId, weaponName, profileKey, beamClass, rangeMu, weapon, targetShip } = input;
    const profile = shipFireProfile(profileKey);
    const name = weaponName ?? weaponId;

    if (profile.attackKind === "fixedBd" && profile.maxRangeMu !== undefined && rangeMu > profile.maxRangeMu) {
        return {
            message: `${profile.label} (${weaponId}) at ${rangeMu.toFixed(1)} MU exceeds max range ${profile.maxRangeMu} MU — no damage possible.`,
            severity: "warning",
        };
    }

    if (
        (profile.attackKind === "beamPool" || profile.attackKind === "transporter") &&
        profile.bandWidthMu &&
        beamDicePool(beamClass, rangeMu, profile.bandWidthMu) === 0
    ) {
        return {
            message: `${profile.label} ${beamClass} (${weaponId}) at ${rangeMu.toFixed(1)} MU rolls 0 dice — no damage possible.`,
            severity: "warning",
        };
    }

    if (profile.attackKind === "projectile") {
        if (profile.maxRangeMu !== undefined && rangeMu > profile.maxRangeMu) {
            return {
                message: `${profile.label} (${weaponId}) at ${rangeMu.toFixed(1)} MU exceeds max range ${profile.maxRangeMu} MU — cannot hit.`,
                severity: "warning",
            };
        }
        if (weapon && targetShip) {
            const stealth = targetStealthLevel(
                (targetShip.object as { hull?: { stealth?: unknown } } | undefined)?.hull?.stealth
            );
            const rangeProfile = inferProjectileRangeProfile(weapon);
            if (projectileHitThreshold(rangeMu, rangeProfile, stealth) === null) {
                return {
                    message: `${name} at ${rangeMu.toFixed(1)} MU is beyond effective range — cannot hit.`,
                    severity: "warning",
                };
            }
        }
    }

    return undefined;
}

export function validateDeclareShipFireBatch(
    fold: FoldState,
    shipId: string,
    newDecls: FullThrustGameCommand[],
    fcTargets: Record<string, string> = {}
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const completed = new Set(shipsCompletedActivation(fold.meta));
    const pending = pendingFireForShip(fold, shipId);

    if (completed.has(shipId)) {
        issues.push({
            message: `Ship ${shipId} already completed its fire activation this phase — additional orders are typically not allowed.`,
            severity: "warning",
        });
    }

    const pendingOrders = pending
        .map(summarizeFireDeclaration)
        .filter((o): o is FireOrderSummary => o !== null);
    const newOrders = newDecls
        .map(summarizeFireDeclaration)
        .filter((o): o is FireOrderSummary => o !== null);
    const allOrders = [...pendingOrders, ...newOrders];

    for (const order of newOrders) {
        if (pendingOrders.some((p) => p.weaponId === order.weaponId)) {
            issues.push({
                message: `Weapon ${order.weaponId} already has a fire declaration this phase for ${shipId}.`,
                severity: "warning",
            });
        }
    }

    const ship = shipById(fold.position, shipId);
    if (ship) {
        for (const order of newOrders) {
            if (isSystemDamagedOrDestroyed(ship, order.weaponId)) {
                const wState = ship.systems?.find((s) => s.id === order.weaponId)?.state;
                issues.push({
                    message:
                        wState === "damaged"
                            ? `Weapon ${order.weaponId} is damaged — fire order may be invalid.`
                            : `Weapon ${order.weaponId} is destroyed — fire order may be invalid.`,
                    severity: "warning",
                });
            }
            if (
                order.fireControlId &&
                isSystemDamagedOrDestroyed(ship, order.fireControlId)
            ) {
                const fcState = ship.systems?.find((s) => s.id === order.fireControlId)?.state;
                issues.push({
                    message:
                        fcState === "damaged"
                            ? `Fire control ${order.fireControlId} is damaged — it cannot assign targets.`
                            : `Fire control ${order.fireControlId} is destroyed — fire order may be invalid.`,
                    severity: "warning",
                });
            }
            if (fold.weaponUsedThisTurn?.[order.weaponId] === "pds") {
                issues.push({
                    message: `Weapon ${order.weaponId} already used for point defense this turn.`,
                    severity: "error",
                });
            }
            const decl = newDecls.find(
                (d) => (d as { weapon?: string }).weapon === order.weaponId
            );
            const meta = decodeFireDeclarationNotes((decl as { notes?: string } | undefined)?.notes);
            const profileKey = (order.profile ?? meta.profile ?? "beam") as ShipFireProfileKey;
            const rangeMu = meta.range ?? 0;
            const weapon = findWeaponEntry(ship, order.weaponId);
            const target = shipById(fold.position, order.targetId);
            const rangeIssue = fireOrderIneffectiveAtRangeIssue({
                weaponId: order.weaponId,
                weaponName: meta.weaponName ?? weapon?.name,
                profileKey,
                beamClass: meta.beamClass ?? weapon?.class ?? 2,
                rangeMu,
                weapon,
                targetShip: target,
            });
            if (rangeIssue) issues.push(rangeIssue);
            if (order.profile === "needle" && ship) {
                if (!needleSensorRequirementMet(ship, rangeMu)) {
                    issues.push({
                        message: needleSensorRequirementMessage(rangeMu),
                        severity: "error",
                    });
                }
            }
            if (order.profile === "transporter" && ship) {
                const cap = transporterFirerCapacity(ship as ShipWithCrewDeployment);
                if (cap.marinesAvailable === 0 && cap.dcpAvailable === 0) {
                    issues.push({
                        message: `${shipId} has no marines or DCP available — transporter hits cannot be delivered.`,
                        severity: "warning",
                    });
                }
            }
            if (shipUsedMinesweeperThisTurn(ship) && !isDefensiveFireOrder(ship, order)) {
                issues.push({
                    message: `${shipId} used minesweeper in active mode this turn — offensive weapons are not permitted by rules.`,
                    severity: "warning",
                });
            }
        }
    }

    if (ship) {
        const mergedFcTargets = { ...fcTargets };
        for (const order of allOrders) {
            if (order.fireControlId && order.profile !== "pds") {
                mergedFcTargets[order.fireControlId] = order.targetId;
            }
        }
        issues.push(...validateFireControlAssignments(ship, mergedFcTargets, allOrders));
    }

    return issues;
}

/** Narrative moderator log lines for invalid fire-control / weapon state on declarations. */
export function fireDeclarationModeratorLogMessages(
    shipId: string,
    ship: ShipGameState,
    decls: FullThrustGameCommand[],
    fcTargets: Record<string, string> = {}
): string[] {
    const msgs: string[] = [];

    if (shipRequiresFireControl(ship) && functionalFireControls(ship).length === 0) {
        msgs.push(
            `Moderator: ${shipId} declared fire with no functional fire control (all damaged or destroyed).`
        );
    }

    for (const [fcId, targetId] of Object.entries(fcTargets)) {
        if (!targetId) continue;
        if (isSystemDamaged(ship, fcId)) {
            msgs.push(
                `Moderator: ${shipId} assigned target ${targetId} to damaged fire control ${fcId}.`
            );
        } else if (isSystemDestroyed(ship, fcId)) {
            msgs.push(
                `Moderator: ${shipId} assigned target ${targetId} to destroyed fire control ${fcId}.`
            );
        }
    }

    for (const cmd of decls) {
        const c = cmd as { weapon?: string; target?: string };
        if (!c.weapon || !isSystemDamagedOrDestroyed(ship, c.weapon)) continue;
        const state = ship.systems?.find((s) => s.id === c.weapon)?.state ?? "damaged";
        msgs.push(
            `Moderator: ${shipId} declared fire for ${state} weapon ${c.weapon} → ${c.target ?? "?"}.`
        );
    }

    return msgs;
}

function pendingTransporterSlot(
    fold: FoldState,
    firerShip: string,
    targetShip: string,
    weapon: string
) {
    return (fold.pendingTransporterDeliveries ?? []).find(
        (p) =>
            p.firerShipId === firerShip &&
            p.targetShipId === targetShip &&
            p.weaponId === weapon &&
            p.remaining > 0
    );
}

export function validateDeclareTransporterDelivery(
    fold: FoldState,
    cmd: FullThrustGameCommand
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const c = cmd as {
        firerShip?: string;
        targetShip?: string;
        weapon?: string;
        choice?: TransporterDeliveryChoice;
    };
    if (fold.meta.phase !== 11) {
        issues.push({
            message: "declareTransporterDelivery: phase 11 only.",
            severity: "error",
        });
    }
    if (!c.firerShip || !c.targetShip || !c.weapon || !c.choice) {
        issues.push({
            message: "declareTransporterDelivery: incomplete.",
            severity: "error",
        });
        return issues;
    }
    if (!pendingTransporterSlot(fold, c.firerShip, c.targetShip, c.weapon)) {
        issues.push({
            message: `No pending transporter delivery slot for ${c.firerShip} → ${c.targetShip} (${c.weapon}).`,
            severity: "error",
        });
    }
    const firer = shipById(fold.position, c.firerShip) as ShipWithCrewDeployment | undefined;
    if (!firer) {
        issues.push({ message: `Firer ship not found: ${c.firerShip}`, severity: "error" });
        return issues;
    }
    const target = shipById(fold.position, c.targetShip);
    if (!target) {
        issues.push({ message: `Target ship not found: ${c.targetShip}`, severity: "error" });
        return issues;
    }
    const cap = transporterFirerCapacity(firer);
    const choice = c.choice;
    if (choice.mode === "boarding") {
        if (choice.payload === "marine") {
            if (cap.marinesAvailable < 1) {
                issues.push({
                    message: `Deploying 1 marine from ${c.firerShip} exceeds ${cap.marinesAvailable} available.`,
                    severity: "error",
                });
            }
        } else if (choice.payload === "dcp") {
            if (cap.dcpAvailable < 1) {
                issues.push({
                    message: `Deploying 1 DCP from ${c.firerShip} exceeds ${cap.dcpAvailable} available.`,
                    severity: "error",
                });
            }
        }
    } else if (choice.mode === "commando") {
        if (choice.payload === "dcp") {
            issues.push({
                message: "Commando raids use marines only, not DCP.",
                severity: "error",
            });
        }
        if (cap.marinesAvailable < 1) {
            issues.push({
                message: `Commando raid requires 1 marine on ${c.firerShip}; ${cap.marinesAvailable} available.`,
                severity: "error",
            });
        }
        if (!choice.commandoSystemId) {
            issues.push({
                message: "Commando raid requires a target system on the defender SSD.",
                severity: "error",
            });
        } else {
            const valid = commandoValidTargets(target);
            if (!valid.some((t) => t.id === choice.commandoSystemId)) {
                issues.push({
                    message: `System ${choice.commandoSystemId} is not a valid commando target.`,
                    severity: "error",
                });
            }
        }
    }
    return issues;
}

export function validateDeclareEmpAllocation(
    fold: FoldState,
    cmd: FullThrustGameCommand,
    phase13Commands: FullThrustGameCommand[] = []
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const c = cmd as {
        targetShip?: string;
        firerShip?: string;
        weapon?: string;
        allocations?: EmpAllocation[];
    };
    if (fold.meta.phase !== 13) {
        issues.push({ message: "declareEmpAllocation: phase 13 only.", severity: "error" });
    }
    if (!c.targetShip || !c.firerShip || !c.weapon || !c.allocations?.length) {
        issues.push({ message: "declareEmpAllocation: incomplete.", severity: "error" });
        return issues;
    }
    const banked = fold.bankedEmpHits?.[c.targetShip];
    if (!banked) {
        issues.push({
            message: `No banked EMP hits on ${c.targetShip}.`,
            severity: "error",
        });
        return issues;
    }
    const contrib = banked.contributors.find(
        (x) => x.shipId === c.firerShip && x.weaponId === c.weapon
    );
    if (!contrib) {
        issues.push({
            message: `No EMP contribution from ${c.firerShip}/${c.weapon} on ${c.targetShip}.`,
            severity: "error",
        });
        return issues;
    }
    const key = empContributorKey(c.firerShip, c.weapon);
    if (declaredEmpContributorKeys(c.targetShip, phase13Commands).has(key)) {
        issues.push({
            message: `EMP allocation already declared for ${c.firerShip}/${c.weapon}.`,
            severity: "warning",
        });
    }
    const allocated = c.allocations.reduce((s, a) => s + (a.hitCount ?? 0), 0);
    if (allocated !== contrib.hits) {
        issues.push({
            message: `Must allocate exactly ${contrib.hits} hit(s); got ${allocated}.`,
            severity: "error",
        });
    }
    const target = shipById(fold.position, c.targetShip);
    if (!target) {
        issues.push({ message: `Target ship not found: ${c.targetShip}`, severity: "error" });
        return issues;
    }
    const validIds = new Set(empValidTargets(target).map((t) => t.id));
    for (const a of c.allocations) {
        if (!validIds.has(a.systemId)) {
            issues.push({
                message: `System ${a.systemId} is not a valid EMP target.`,
                severity: "error",
            });
        }
        if ((a.hitCount ?? 0) < 1) {
            issues.push({
                message: `Invalid hit count for ${a.systemId}.`,
                severity: "error",
            });
        }
    }
    return issues;
}

/** Validate cumulative draft deliveries for one firer (UI batch). */
export function validateTransporterDeliveryBatch(
    fold: FoldState,
    firerShipId: string,
    draftDecls: FullThrustGameCommand[]
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const firer = shipById(fold.position, firerShipId) as ShipWithCrewDeployment | undefined;
    if (!firer) return issues;
    const cap = transporterFirerCapacity(firer);
    let marineUses = 0;
    let dcpUses = 0;
    for (const cmd of draftDecls) {
        if (cmd.name !== "declareTransporterDelivery") continue;
        const c = cmd as { choice?: TransporterDeliveryChoice };
        const ch = c.choice;
        if (!ch) continue;
        if (ch.mode === "commando" || (ch.mode === "boarding" && ch.payload === "marine")) {
            marineUses += 1;
        }
        if (ch.mode === "boarding" && ch.payload === "dcp") {
            dcpUses += 1;
        }
    }
    if (marineUses > cap.marinesAvailable) {
        issues.push({
            message: `Deploying ${marineUses} marine(s) from ${firerShipId} exceeds ${cap.marinesAvailable} available.`,
            severity: "error",
        });
    }
    if (dcpUses > cap.dcpAvailable) {
        issues.push({
            message: `Deploying ${dcpUses} DCP from ${firerShipId} exceeds ${cap.dcpAvailable} available.`,
            severity: "error",
        });
    }
    const pendingSlots = pendingForFirer(fold.pendingTransporterDeliveries, firerShipId).reduce(
        (s, p) => s + p.remaining,
        0
    );
    if (draftDecls.length > pendingSlots) {
        issues.push({
            message: `Only ${pendingSlots} transporter delivery slot(s) pending for ${firerShipId}.`,
            severity: "error",
        });
    }
    return issues;
}

/** Validate one declareShipFire command being appended to the current fold. */
export function validateDeclareShipFireCommand(
    fold: FoldState,
    cmd: FullThrustGameCommand
): ValidationIssue[] {
    const shipId = (cmd as { ship?: string }).ship ?? "";
    if (!shipId) {
        return [{ message: "declareShipFire: missing ship", severity: "error" }];
    }
    return validateDeclareShipFireBatch(fold, shipId, [cmd]);
}

export function validateDeclareShipFire(
    fold: FoldState,
    shipId: string,
    weaponId?: string,
    fcTargets: Record<string, string> = {},
    draftTargetId?: string,
    draftProfile?: string,
    draftFireControlId?: string
): ValidationIssue[] {
    const pending = pendingFireForShip(fold, shipId);
    if (weaponId && draftTargetId) {
        const draft = {
            name: "declareShipFire",
            ship: shipId,
            weapon: weaponId,
            target: draftTargetId,
            notes: JSON.stringify({
                profile: draftProfile ?? "beam",
                fireControlId: draftFireControlId,
            }),
        } as FullThrustGameCommand;
        return validateDeclareShipFireBatch(fold, shipId, [draft], fcTargets);
    }
    if (weaponId) {
        const issues = validateDeclareShipFireBatch(fold, shipId, [], fcTargets);
        if (pending.some((c) => (c as { weapon?: string }).weapon === weaponId)) {
            issues.push({
                message: `Weapon ${weaponId} already has a fire declaration this phase for ${shipId} — duplicate weapon orders are typically not allowed.`,
                severity: "warning",
            });
        }
        return issues;
    }
    return validateDeclareShipFireBatch(fold, shipId, [], fcTargets);
}

function validateBoarderDeployCommand(
    position: FullThrustGamePosition,
    cmd: FullThrustGameCommand,
    defender?: ShipWithBoarders
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const c = cmd as {
        fromShip?: string;
        owner?: string;
        marines?: number;
        dcp?: number;
        deployBuiltinDcp?: number;
    };
    const fromShipId = c.fromShip;
    if (!fromShipId) return issues;

    const source = shipById(position, fromShipId) as ShipWithCrewDeployment | undefined;
    if (!source) {
        issues.push({
            message: `Deployment source ship not found: ${fromShipId}`,
            severity: "warning",
        });
        return issues;
    }

    let marineDelta = 0;
    let dcpDelta = 0;
    const builtinDelta = Math.max(0, Math.floor(c.deployBuiltinDcp ?? 0));

    if (cmd.name === "adjustBoarders") {
        marineDelta = Math.max(0, Math.floor(c.marines ?? 0));
        dcpDelta = Math.max(0, Math.floor(c.dcp ?? 0));
    } else if (cmd.name === "setBoarders" && defender && c.owner) {
        const prev = totalBoardersOnShip(defender, c.owner);
        marineDelta = Math.max(0, (c.marines ?? 0) - prev.marines);
        dcpDelta = Math.max(0, (c.dcp ?? 0) - prev.dcp);
    }

    if (marineDelta > availableMarineIds(source).length) {
        issues.push({
            message: `Deploying ${marineDelta} marine(s) from ${fromShipId} exceeds ${availableMarineIds(source).length} available.`,
            severity: "warning",
        });
    }
    if (dcpDelta > availableHiredDcpIds(source).length) {
        issues.push({
            message: `Deploying ${dcpDelta} hired DCP from ${fromShipId} exceeds ${availableHiredDcpIds(source).length} available.`,
            severity: "warning",
        });
    }
    if (builtinDelta > availableBuiltinDcp(source)) {
        issues.push({
            message: `Deploying ${builtinDelta} built-in DCP from ${fromShipId} exceeds ${availableBuiltinDcp(source)} available.`,
            severity: "warning",
        });
    }
    return issues;
}

export function validateDeclareBoardingAttackerOrdersCommand(
    fold: FoldState,
    position: FullThrustGamePosition,
    cmd: FullThrustGameCommand,
    phaseCommands: FullThrustGameCommand[] = []
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const shipId = (cmd as { ship?: string }).ship ?? "";
    const meta = fold.meta;
    if (meta.phase !== 12) {
        issues.push({ message: "Attacker boarding orders are only in phase 12.", severity: "error" });
        return issues;
    }
    if ((meta.segment ?? "orders") !== "orders") {
        issues.push({
            message: "Boarding orders are declared in the orders segment only.",
            severity: "error",
        });
        return issues;
    }
    if ((meta.boardingStep ?? "attacker") !== "attacker") {
        issues.push({
            message: `Attacker boarding orders are declared in ${BOARDING_STEP_LABELS.attackerAllocation} only.`,
            severity: "error",
        });
        return issues;
    }
    const ship = shipById(position, shipId) as ShipWithBoarders | undefined;
    if (!ship) {
        issues.push({ message: `Ship not found: ${shipId}`, severity: "error" });
        return issues;
    }
    const notes = decodeAttackerBoardingNotes((cmd as { notes?: string }).notes);
    if (!notes) {
        issues.push({ message: "Invalid attacker boarding orders JSON.", severity: "error" });
        return issues;
    }
    const units = boarderUnitsOnShip(ship);
    const owner = notes.attackerOwner ?? "";
    const ownerUnits = units.filter((u) => u.owner === owner);
    const allocIds = new Set((notes.unitAllocations ?? []).map((a) => a.unitId));
    if (ownerUnits.length === 0) {
        issues.push({
            message: `No boarders aboard for attacker ${owner}.`,
            severity: "warning",
        });
    }
    for (const u of ownerUnits) {
        if (!allocIds.has(u.id)) {
            issues.push({
                message: `Boarder ${u.id} missing kill/raze allocation.`,
                severity: "warning",
            });
        }
    }
    for (const alloc of notes.unitAllocations ?? []) {
        const unit = units.find((u) => u.id === alloc.unitId);
        if (!unit || unit.owner !== owner) {
            issues.push({
                message: `Invalid unit allocation ${alloc.unitId} for attacker ${owner}.`,
                severity: "warning",
            });
        }
    }
    if (units.length === 0) {
        issues.push({ message: `No enemy boarders on ${shipId}.`, severity: "warning" });
    }
    void phaseCommands;
    return issues;
}

/** Allocation checks for defender boarding (DCP pool, marine reuse, unknown targets). */
export function validateDefenderBoardingAllocations(
    ship: ShipWithBoarders,
    notes: Pick<DefenderBoardingNotes, "dcpRepel" | "marineFight">
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const crew = shipBoardingCrewCapacity(ship);
    const units = boarderUnitsOnShip(ship);
    const unitIds = new Set(units.map((u) => u.id));
    const defenderMarineIds = new Set(availableMarineIds(ship));

    const dcpTotal = (notes.dcpRepel ?? []).reduce(
        (s, a) => s + Math.max(0, Math.floor(a.dcp)),
        0
    );
    if (dcpTotal > crew.dcpPool) {
        issues.push({
            message: `DCP allocation ${dcpTotal} exceeds pool ${crew.dcpPool}.`,
            severity: "warning",
        });
    }
    for (const repel of notes.dcpRepel ?? []) {
        if (!unitIds.has(repel.boarderId)) {
            issues.push({
                message: `DCP repel target unknown boarder ${repel.boarderId}.`,
                severity: "warning",
            });
        }
        if (repel.dcp < 1) {
            issues.push({
                message: `DCP repel on ${repel.boarderId} must assign at least 1 DCP.`,
                severity: "warning",
            });
        }
    }
    const usedMarines = new Set<string>();
    for (const fight of notes.marineFight ?? []) {
        if (!unitIds.has(fight.boarderId)) {
            issues.push({
                message: `Marine fight target unknown boarder ${fight.boarderId}.`,
                severity: "warning",
            });
        }
        if (!defenderMarineIds.has(fight.marineId)) {
            issues.push({
                message: `Marine ${fight.marineId} is not available on defender.`,
                severity: "warning",
            });
        }
        if (usedMarines.has(fight.marineId)) {
            issues.push({
                message: `Marine ${fight.marineId} assigned more than once.`,
                severity: "warning",
            });
        }
        usedMarines.add(fight.marineId);
    }
    const marineAssignments = (notes.marineFight ?? []).length;
    if (marineAssignments > crew.marines) {
        issues.push({
            message: `Marine assignments ${marineAssignments} exceed available ${crew.marines}.`,
            severity: "warning",
        });
    }
    return issues;
}

export function validateDeclareBoardingDefenderOrdersCommand(
    fold: FoldState,
    position: FullThrustGamePosition,
    cmd: FullThrustGameCommand,
    phaseCommands: FullThrustGameCommand[] = []
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const shipId = (cmd as { ship?: string }).ship ?? "";
    const meta = fold.meta;
    if (meta.phase !== 12) {
        issues.push({ message: "Defender boarding orders are only in phase 12.", severity: "error" });
        return issues;
    }
    if ((meta.segment ?? "orders") !== "orders") {
        issues.push({
            message: "Boarding orders are declared in the orders segment only.",
            severity: "error",
        });
        return issues;
    }
    if ((meta.boardingStep ?? "attacker") !== "defender") {
        issues.push({
            message: `Defender boarding orders are declared in ${BOARDING_STEP_LABELS.defenderAllocation} only.`,
            severity: "error",
        });
        return issues;
    }
    const ship = shipById(position, shipId) as ShipWithBoarders | undefined;
    if (!ship) {
        issues.push({ message: `Ship not found: ${shipId}`, severity: "error" });
        return issues;
    }
    if (
        !attackerOrdersCompleteForShip(
            position,
            shipId,
            phaseCommands,
            fold.pendingBoardingOrders
        )
    ) {
        issues.push({
            message: `Attacker boarding orders incomplete for ${shipId}.`,
            severity: "error",
        });
    }
    const notes = decodeDefenderBoardingNotes((cmd as { notes?: string }).notes);
    if (!notes) {
        issues.push({ message: "Invalid defender boarding orders JSON.", severity: "error" });
        return issues;
    }
    issues.push(...validateDefenderBoardingAllocations(ship, notes));
    const units = boarderUnitsOnShip(ship);
    if (units.length === 0) {
        issues.push({ message: `No enemy boarders on ${shipId}.`, severity: "warning" });
    }
    return issues;
}

/** @deprecated Use validateDeclareBoardingAttackerOrdersCommand / validateDeclareBoardingDefenderOrdersCommand */
export function validateDeclareBoardingOrdersCommand(
    fold: FoldState,
    position: FullThrustGamePosition,
    cmd: FullThrustGameCommand,
    phaseCommands: FullThrustGameCommand[] = []
): ValidationIssue[] {
    if (cmd.name === "declareBoardingAttackerOrders") {
        return validateDeclareBoardingAttackerOrdersCommand(fold, position, cmd, phaseCommands);
    }
    if (cmd.name === "declareBoardingDefenderOrders") {
        return validateDeclareBoardingDefenderOrdersCommand(fold, position, cmd, phaseCommands);
    }
    return [{ message: "Unknown boarding declare command.", severity: "error" }];
}

export function validateAdvanceSegment(
    fold: FoldState,
    phaseCommands: FullThrustGameCommand[] = []
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const meta = fold.meta;
    if (meta.phase !== 12 || (meta.segment ?? "orders") !== "orders") {
        return issues;
    }
    const step = meta.boardingStep ?? "attacker";
    const pending = fold.pendingBoardingOrders;
    if (step === "attacker") {
        const undeclared = phase12UndeclaredAttackerShips(
            meta,
            fold.position,
            phaseCommands,
            pending
        );
        if (undeclared.length > 0) {
            issues.push({
                message: `Attacker boarding orders incomplete for: ${undeclared.join(", ")}.`,
                severity: "error",
            });
        }
    } else if (step === "defender") {
        const undeclared = phase12UndeclaredDefenderShips(
            meta,
            fold.position,
            phaseCommands,
            pending
        );
        if (undeclared.length > 0) {
            issues.push({
                message: `Defender boarding orders incomplete for: ${undeclared.join(", ")}.`,
                severity: "error",
            });
        }
    }
    return issues;
}

export function validateDeclareRepairOrdersCommand(
    fold: FoldState,
    position: FullThrustGamePosition,
    cmd: FullThrustGameCommand,
    phaseCommands: FullThrustGameCommand[] = [],
    opts: { actingPlayer?: string; moderator?: boolean } = {}
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const shipId = (cmd as { ship?: string }).ship ?? "";
    const meta = fold.meta;
    if (meta.phase !== 14) {
        issues.push({ message: "Repair orders are only declared in phase 14.", severity: "error" });
        return issues;
    }
    if (isSegmentActivationPhase(meta.phase) && meta.segment === "resolve") {
        issues.push({
            message: "Repair orders are declared in the orders segment only.",
            severity: "error",
        });
    }
    const ship = shipById(position, shipId) as ShipWithRepairState | undefined;
    if (!ship) {
        issues.push({ message: `Ship not found: ${shipId}`, severity: "error" });
        return issues;
    }
    if (opts.moderator === false && opts.actingPlayer) {
        const owner = (ship as { owner?: string }).owner;
        if (owner && owner !== opts.actingPlayer) {
            issues.push({
                message: `Only ${owner} may declare repair orders for ${shipId}.`,
                severity: "error",
            });
        }
    }
    if (!shipNeedsRepairOrders(ship)) {
        issues.push({
            message: `${shipId} has no repair work (no DCP-eligible damage and no regen armour to repair).`,
            severity: "error",
        });
    }
    const notes = decodeRepairOrdersNotes((cmd as { notes?: string }).notes);
    if (!notes) {
        issues.push({ message: "Invalid repair orders JSON.", severity: "error" });
        return issues;
    }
    const validTargets = new Set(repairTargetsForShip(ship).map((t) => t.id));
    for (const alloc of notes.allocations) {
        const dcp = Math.floor(alloc.dcp);
        if (dcp < 0 || dcp > 3) {
            issues.push({
                message: `DCP for ${alloc.targetId} must be 0–3 (got ${alloc.dcp}).`,
                severity: "error",
            });
        }
        if (dcp > 0 && !validTargets.has(alloc.targetId)) {
            issues.push({
                message: `${alloc.targetId} is not a current repair target for ${shipId}.`,
                severity: "error",
            });
        }
    }
    const totalDcp = totalDcpAllocated(notes);
    const available = dcpAvailabilityForShip(ship).available;
    if (totalDcp > available) {
        issues.push({
            message: `Allocated ${totalDcp} DCP but only ${available} available for ${shipId}.`,
            severity: "warning",
        });
    }
    const hasSystemRepair = notes.allocations.some((a) => Math.floor(a.dcp) >= 1);
    if (!hasSystemRepair && !notes.repairRegenArmour) {
        issues.push({
            message: "No DCP allocated and regenerative armour repair not selected.",
            severity: "warning",
        });
    }
    const pending = fold.pendingRepairOrders;
    if (
        repairOrdersDeclaredForShip(shipId, phaseCommands, pending) &&
        !(pending ?? []).some(
            (c) => c.name === "declareRepairOrders" && (c as { ship?: string }).ship === shipId
        )
    ) {
        issues.push({
            message: `${shipId} already has repair orders this turn — a second declare will add another entry (resolve uses latest).`,
            severity: "warning",
        });
    }
    return issues;
}

export function repairDeclarationModeratorHints(
    position: FullThrustGamePosition,
    phaseCommands: FullThrustGameCommand[] | undefined,
    pending: FullThrustGameCommand[] | undefined
): string[] {
    const hints: string[] = [];
    const seen = new Set<string>();
    for (const cmd of [...(phaseCommands ?? []), ...(pending ?? [])]) {
        if (cmd.name !== "declareRepairOrders") continue;
        const shipId = (cmd as { ship?: string }).ship ?? "";
        if (!shipId || seen.has(shipId)) continue;
        seen.add(shipId);
        const ship = shipById(position, shipId) as ShipWithRepairState | undefined;
        if (!ship) continue;
        const notes = decodeRepairOrdersNotes((cmd as { notes?: string }).notes);
        if (!notes) continue;
        const totalDcp = totalDcpAllocated(notes);
        const available = dcpAvailabilityForShip(ship).available;
        if (totalDcp > available) {
            hints.push(
                `Warning: ${shipId} repair order allocates ${totalDcp} DCP but only ${available} available.`
            );
        }
    }
    return hints;
}

export function fireDeclarationModeratorHints(
    meta: GameMeta,
    position: FullThrustGamePosition,
    pending: FullThrustGameCommand[] | undefined
): string[] {
    const hints: string[] = [];
    const byShip = new Map<string, FullThrustGameCommand[]>();
    for (const cmd of pending ?? []) {
        if (cmd.name !== "declareShipFire") continue;
        const c = cmd as { ship?: string };
        if (!c.ship) continue;
        if (!byShip.has(c.ship)) byShip.set(c.ship, []);
        byShip.get(c.ship)!.push(cmd);
    }
    for (const [shipId, decls] of byShip) {
        const ship = shipById(position, shipId);
        if (!ship) continue;
        const orders = decls
            .map(summarizeFireDeclaration)
            .filter((o): o is FireOrderSummary => o !== null);
        const fcTargets: Record<string, string> = {};
        for (const o of orders) {
            if (o.fireControlId && o.profile !== "pds") {
                fcTargets[o.fireControlId] = o.targetId;
            }
        }
        for (const issue of validateFireControlAssignments(ship, fcTargets, orders)) {
            hints.push(`Warning: ${shipId} — ${issue.message}`);
        }
        if (shipRequiresFireControl(ship) && functionalFireControls(ship).length === 0) {
            hints.push(
                `Warning: ${shipId} has no functional fire control but fire was declared.`
            );
        }
        for (const [fcId, targetId] of Object.entries(fcTargets)) {
            if (!targetId) continue;
            if (isSystemDamaged(ship, fcId)) {
                hints.push(
                    `Warning: ${shipId} — damaged fire control ${fcId} assigned to ${targetId}.`
                );
            }
        }
        for (const o of orders) {
            if (isSystemDamagedOrDestroyed(ship, o.weaponId)) {
                const state = ship.systems?.find((s) => s.id === o.weaponId)?.state ?? "damaged";
                hints.push(
                    `Warning: ${shipId} — ${state} weapon ${o.weaponId} declared against ${o.targetId}.`
                );
            }
        }
        if (shipUsedMinesweeperThisTurn(ship)) {
            const offensive = orders.filter((o) => !isDefensiveFireOrder(ship, o));
            if (offensive.length > 0) {
                hints.push(
                    `Warning: ${shipId} used minesweeper this turn — offensive fire declared (${offensive.map((o) => o.weaponId).join(", ")}).`
                );
            }
        }
        for (const cmd of decls) {
            const c = cmd as { weapon?: string; target?: string; notes?: string };
            if (c.weapon && c.target) {
                const meta = decodeFireDeclarationNotes(c.notes);
                const weapon = findWeaponEntry(ship, c.weapon);
                const target = shipById(position, c.target);
                const profileKey = (meta.profile ?? "beam") as ShipFireProfileKey;
                const rangeIssue = fireOrderIneffectiveAtRangeIssue({
                    weaponId: c.weapon,
                    weaponName: meta.weaponName ?? weapon?.name,
                    profileKey,
                    beamClass: meta.beamClass ?? weapon?.class ?? 2,
                    rangeMu: meta.range ?? 0,
                    weapon,
                    targetShip: target,
                });
                if (rangeIssue) {
                    hints.push(`Warning: ${shipId} — ${rangeIssue.message}`);
                }
            }
            if (!c.notes) continue;
            try {
                const notes = JSON.parse(c.notes) as { alteredFromDefaults?: string[] };
                if (notes.alteredFromDefaults?.length) {
                    hints.push(
                        `Warning: ${shipId} fire order altered defaults: ${notes.alteredFromDefaults.join(", ")}.`
                    );
                    break;
                }
            } catch {
                /* ignore */
            }
        }
    }
    for (const shipId of illegalPendingFireDeclarations(meta, pending)) {
        hints.push(
            `Warning: ${shipId} has fire declarations but already completed its activation — typically illegal.`
        );
    }
    return hints;
}

export function illegalPendingFireDeclarations(
    meta: GameMeta,
    pending: FullThrustGameCommand[] | undefined
): string[] {
    const completed = new Set(shipsCompletedActivation(meta));
    return [...shipsWithPendingFireOrders(pending)].filter((id) => completed.has(id));
}

export function validateCommand(
    fold: FoldState,
    cmd: FullThrustGameCommand,
    replayCommands: FullThrustGameCommand[] = []
): ValidationIssue[] {
    const { position } = fold;

    switch (cmd.name) {
        case "moveShip": {
            const ship = shipById(position, cmd.id!);
            if (!ship) {
                return [{ message: `Ship not found: ${cmd.id}`, severity: "error" }];
            }
            const c = cmd as {
                vectorManeuvers?: VectorManeuver[];
                cinematicAllocation?: CinematicAllocation;
                advancedDrives?: boolean;
                speed?: number;
                sweepForMines?: boolean;
                deployMineLayers?: string[];
                launchFighters?: boolean;
            };
            if (c.vectorManeuvers) {
                return [
                    ...validateVectorManeuverQueue(ship, c.vectorManeuvers),
                    ...validateMoveShipMineOptions(ship, c),
                    ...validateMoveShipLaunchFighters(ship, cmd),
                ];
            }
            if (c.cinematicAllocation) {
                return [
                    ...validateCinematicAllocation(
                        ship,
                        c.cinematicAllocation,
                        c.advancedDrives ?? false
                    ),
                    ...validateMoveShipMineOptions(ship, c),
                    ...validateMoveShipLaunchFighters(ship, cmd),
                ];
            }
            if (c.speed !== undefined) {
                return [
                    ...validateMoveShip(ship, { speed: c.speed, ...c }),
                    ...validateMoveShipLaunchFighters(ship, cmd),
                ];
            }
            return [
                ...validateMoveShipMineOptions(ship, c),
                ...validateMoveShipLaunchFighters(ship, cmd),
            ];
        }
        case "launchFighters": {
            const ship = shipById(position, cmd.ship!);
            if (!ship) {
                return [{ message: `Ship not found: ${cmd.ship}`, severity: "error" }];
            }
            const lc = cmd as { callsign?: string };
            return [
                ...validateLaunchFighters(ship),
                ...validateLaunchFightersDeclaration(fold, cmd.ship!),
                ...validateFighterCallsignField(lc.callsign),
            ];
        }
        case "launchGunboats": {
            const lc = cmd as { id?: string; callsign?: string };
            const gunboat = position.objects?.find(
                (o) => o.objType === "gunboats" && o.id === lc.id
            ) as { callsign?: string } | undefined;
            const hasCallsign = !!normalizeCallsign(gunboat?.callsign);
            return validateFighterCallsignField(lc.callsign, { required: !hasCallsign });
        }
        case "launchOrdnance": {
            const ship = shipById(position, cmd.ship!);
            if (!ship) {
                return [{ message: `Ship not found: ${cmd.ship}`, severity: "error" }];
            }
            const c = cmd as { systemId?: string; type?: string };
            return validateLaunchOrdnance(ship, c.systemId ?? "", c.type ?? "missile");
        }
        case "layMine": {
            return validateLayMine(fold, cmd as {
                ship?: string;
                systemId?: string;
                position?: { x: number; y: number };
            });
        }
        case "moveFighters":
            return validateMoveFightersCommand(fold, cmd);
        case "screenFighters":
            return validateScreenFighters(fold, cmd);
        case "pursueFighters":
            return validatePursueFighters(fold, cmd);
        case "moveGunboats":
            return validateMoveGunboatsCommand(fold, cmd);
        case "screenGunboats":
            return validateScreenGunboats(fold, cmd, replayCommands);
        case "pursueGunboats":
            return validatePursueGunboats(fold, cmd, replayCommands);
        case "declareGunboatAttack":
            return validateDeclareGunboatAttack(fold, cmd, replayCommands);
        case "launchGunboatOrdnance": {
            const c = cmd as { id?: string; targetId?: string };
            if (!c.id || !c.targetId) {
                return [{ message: "launchGunboatOrdnance: incomplete", severity: "error" }];
            }
            return validateLaunchGunboatOrdnance(
                fold.position,
                c.id,
                c.targetId,
                fold.meta.phase
            );
        }
        case "declareShipFire": {
            const ship = shipById(position, (cmd as { ship?: string }).ship ?? "");
            if (!ship) {
                return [
                    {
                        message: `Ship not found: ${(cmd as { ship?: string }).ship}`,
                        severity: "error",
                    },
                ];
            }
            return validateDeclareShipFireCommand(fold, cmd);
        }
        case "declareTransporterDelivery":
            return validateDeclareTransporterDelivery(fold, cmd);
        case "declareEmpAllocation":
            return validateDeclareEmpAllocation(fold, cmd, replayCommands);
        case "declareBoardingAttackerOrders": {
            const ship = shipById(position, (cmd as { ship?: string }).ship ?? "");
            if (!ship) {
                return [
                    {
                        message: `Ship not found: ${(cmd as { ship?: string }).ship}`,
                        severity: "error",
                    },
                ];
            }
            return validateDeclareBoardingAttackerOrdersCommand(
                fold,
                position,
                cmd,
                replayCommands
            );
        }
        case "declareBoardingDefenderOrders": {
            const ship = shipById(position, (cmd as { ship?: string }).ship ?? "");
            if (!ship) {
                return [
                    {
                        message: `Ship not found: ${(cmd as { ship?: string }).ship}`,
                        severity: "error",
                    },
                ];
            }
            return validateDeclareBoardingDefenderOrdersCommand(
                fold,
                position,
                cmd,
                replayCommands
            );
        }
        case "advanceSegment":
            return validateAdvanceSegment(fold, replayCommands);
        case "declareRepairOrders": {
            const ship = shipById(position, (cmd as { ship?: string }).ship ?? "");
            if (!ship) {
                return [
                    {
                        message: `Ship not found: ${(cmd as { ship?: string }).ship}`,
                        severity: "error",
                    },
                ];
            }
            return validateDeclareRepairOrdersCommand(fold, position, cmd);
        }
        case "adjustBoarders":
        case "setBoarders": {
            const shipId = (cmd as { ship?: string }).ship ?? "";
            const ship = shipById(position, shipId) as ShipWithBoarders | undefined;
            if (!ship) {
                return [{ message: `Ship not found: ${shipId}`, severity: "error" }];
            }
            return validateBoarderDeployCommand(position, cmd, ship);
        }
        case "removeBoarders": {
            const shipId = (cmd as { ship?: string }).ship ?? "";
            const ship = shipById(position, shipId) as ShipWithBoarders | undefined;
            if (!ship) {
                return [{ message: `Ship not found: ${shipId}`, severity: "error" }];
            }
            return [];
        }
        case "resolvePhase5Movement":
            return validateResolvePhase5Movement(fold);
        case "resolveMinePhase":
            return validateResolveMinePhase(fold);
        case "advancePhase":
            return validateAdvancePhase(fold, cmd as { phase?: number });
        case "allocateOrdnanceTarget": {
            const c = cmd as {
                ordnanceId?: string;
                action?: "target" | "destroy" | "skip";
                targetShipId?: string;
            };
            if (!c.ordnanceId || !c.action) {
                return [{ message: "allocateOrdnanceTarget: incomplete", severity: "error" }];
            }
            return validateAllocateOrdnanceTarget(
                fold,
                c.ordnanceId,
                c.targetShipId,
                c.action
            );
        }
        case "declareFighterAttack":
            return validateDeclareFighterAttack(fold, cmd);
        case "declareFurball": {
            const c = cmd as { engagement?: FurballEngagement };
            if (!c.engagement) {
                return [{ message: "declareFurball: missing engagement", severity: "error" }];
            }
            const allocations = fighterAttackAllocations(fold.position, [], fold.meta.turn);
            const gunboatAllocations = gunboatAttackAllocations(fold.position, [], fold.meta.turn);
            const existing = fold.phase8FurballDeclarations ?? [];
            return validateDeclareFurball(
                fold.position,
                c.engagement,
                existing,
                allocations,
                gunboatAllocations
            );
        }
        case "resolvePhase8Furballs": {
            const declarations = fold.phase8FurballDeclarations ?? [];
            const allocations = fighterAttackAllocations(fold.position, [], fold.meta.turn);
            const gunboatAllocations = gunboatAttackAllocations(fold.position, [], fold.meta.turn);
            const issues = validateResolvePhase8Furballs(
                fold.position,
                allocations,
                declarations,
                gunboatAllocations
            );
            if (fold.meta.phase !== 8) {
                issues.push({
                    message: "Furball batch resolve is typically in phase 8.",
                    severity: "warning",
                });
            }
            if ((fold.meta.segment ?? "orders") !== "resolve") {
                issues.push({
                    message: "Resolve furballs in the resolve segment.",
                    severity: "error",
                });
            }
            return issues;
        }
        case "declarePointDefense": {
            const c = cmd as import("./pointDefensePhase9").PointDefenseDeclaration;
            if (!c.defenderShip || !c.weapon || !c.threatId) {
                return [{ message: "declarePointDefense: incomplete", severity: "error" }];
            }
            const existing = fold.phase9PdDeclarations ?? [];
            return validateDeclarePointDefense(
                fold.position,
                {
                    defenderShip: c.defenderShip,
                    weapon: c.weapon,
                    supportedShip: c.supportedShip ?? c.defenderShip,
                    threatId: c.threatId,
                    profile: c.profile ?? "pds",
                    adsMode: c.adsMode,
                    splitTargetId: c.splitTargetId,
                },
                existing,
                replayCommands,
                fold.meta.turn,
                { furballDeclarations: fold.phase8FurballDeclarations, weaponUsedThisTurn: fold.weaponUsedThisTurn }
            );
        }
        case "resolvePhase9PointDefense": {
            const declarations = fold.phase9PdDeclarations ?? [];
            const issues = validateResolvePhase9PointDefense(
                fold.position,
                declarations,
                replayCommands,
                fold.meta.turn,
                { furballDeclarations: fold.phase8FurballDeclarations, weaponUsedThisTurn: fold.weaponUsedThisTurn }
            );
            if (fold.meta.phase !== 9) {
                issues.push({
                    message: "Point defense batch resolve is typically in phase 9.",
                    severity: "warning",
                });
            }
            if ((fold.meta.segment ?? "orders") !== "resolve") {
                issues.push({
                    message: "Resolve point defense in the resolve segment.",
                    severity: "error",
                });
            }
            return issues;
        }
        case "resolvePointDefenseMount": {
            const c = cmd as import("./pointDefensePhase9").PointDefenseDeclaration;
            if (!c.defenderShip || !c.weapon || !c.threatId) {
                return [{ message: "resolvePointDefenseMount: incomplete", severity: "error" }];
            }
            if ((fold.meta.segment ?? "orders") !== "resolve") {
                return [
                    {
                        message: "Resolve point defense in the resolve segment.",
                        severity: "error",
                    },
                ];
            }
            const existing = fold.phase9PdDeclarations ?? [];
            return validateResolvePointDefenseMount(
                fold.position,
                {
                    defenderShip: c.defenderShip,
                    weapon: c.weapon,
                    supportedShip: c.supportedShip ?? c.defenderShip,
                    threatId: c.threatId,
                    profile: c.profile ?? "pds",
                    adsMode: c.adsMode,
                    splitTargetId: c.splitTargetId,
                },
                existing,
                replayCommands,
                fold.meta.turn,
                { furballDeclarations: fold.phase8FurballDeclarations, weaponUsedThisTurn: fold.weaponUsedThisTurn }
            );
        }
        case "resolvePhase9Complete": {
            const issues: ValidationIssue[] = [];
            if (fold.meta.phase !== 9) {
                issues.push({
                    message: "Point defense complete marker is typically in phase 9.",
                    severity: "warning",
                });
            }
            if ((fold.meta.segment ?? "orders") !== "resolve") {
                issues.push({
                    message: "Resolve point defense in the resolve segment.",
                    severity: "error",
                });
            }
            const remaining = fold.phase9PdDeclarations ?? [];
            if (remaining.length > 0) {
                issues.push({
                    message: `${remaining.length} point defense declaration(s) not yet resolved.`,
                    severity: "error",
                });
            }
            return issues;
        }
        case "detonateOrdnance":
        case "strikeOrdnance":
        case "attackRunIntercept":
        case "fighterShipStrike": {
            const c = cmd as { rolls?: number[] };
            if (!c.rolls?.length) {
                return [{ message: `${cmd.name}: rolls required`, severity: "error" }];
            }
            if (fold.meta.phase !== 10) {
                return [
                    {
                        message: `${cmd.name} is typically in phase 10.`,
                        severity: "warning",
                    },
                ];
            }
            return [];
        }
        case "resolvePhase10Complete": {
            if (fold.meta.phase !== 10) {
                return [
                    {
                        message: "Phase 10 complete marker is typically in phase 10.",
                        severity: "warning",
                    },
                ];
            }
            return [];
        }
        case "resolveFurball":
            return validateFurballCommand(fold, cmd);
        case "interceptOrdnance": {
            const c = cmd as { id?: string; ordnanceId?: string };
            if (!c.id || !c.ordnanceId) {
                return [{ message: "interceptOrdnance: incomplete", severity: "error" }];
            }
            const obj = position.objects?.find((o) => o.id === c.id);
            if (obj?.objType === "gunboats") {
                return validateGunboatInterceptOrdnance(
                    position,
                    c.id,
                    c.ordnanceId,
                    fold.meta.phase
                );
            }
            return validateInterceptOrdnance(position, c.id, c.ordnanceId, fold.meta.phase);
        }
        case "setFighterCallsign":
            return validateSetFighterCallsign(position, cmd as { id?: string; callsign?: string });
        case "setFighterType":
            return validateSetFighterTypeCommand(position, cmd as { id?: string; type?: string });
        case "launchFighterOrdnance": {
            const c = cmd as { id?: string; targetShipId?: string };
            if (!c.id || !c.targetShipId) {
                return [{ message: "launchFighterOrdnance: incomplete", severity: "error" }];
            }
            return validateLaunchFighterOrdnance(
                position,
                c.id,
                c.targetShipId,
                fold.meta.phase
            );
        }
        case "setShipCaptured":
            return validateSetShipCaptured(position, cmd as { ship?: string; capturedBy?: string });
        case "setShipOwner":
            return validateSetShipOwner(position, cmd as { ship?: string; owner?: string });
        case "resolvePhase11HullDestruction":
            return [];
        case "proposeOrdnanceAllocations":
        case "clearOrdnanceAllocation":
        case "applyOrdnanceAllocations":
            return [];
        case "placeShip":
            return validatePlaceShip(cmd);
        default:
            return [];
    }
}

function validateSetShipCaptured(
    position: FullThrustGamePosition,
    cmd: { ship?: string; capturedBy?: string }
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (!cmd.ship) {
        issues.push({ message: "setShipCaptured: ship required", severity: "error" });
        return issues;
    }
    if (!cmd.capturedBy) {
        issues.push({ message: "setShipCaptured: capturedBy required", severity: "error" });
        return issues;
    }
    if (!shipById(position, cmd.ship)) {
        issues.push({
            message: `setShipCaptured: unknown ship ${cmd.ship}`,
            severity: "error",
        });
    }
    if (!position.players?.some((p) => p.id === cmd.capturedBy)) {
        issues.push({
            message: `setShipCaptured: unknown player ${cmd.capturedBy}`,
            severity: "error",
        });
    }
    return issues;
}

function validateSetShipOwner(
    position: FullThrustGamePosition,
    cmd: { ship?: string; owner?: string }
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (!cmd.ship) {
        issues.push({ message: "setShipOwner: ship required", severity: "error" });
        return issues;
    }
    if (!cmd.owner) {
        issues.push({ message: "setShipOwner: owner required", severity: "error" });
        return issues;
    }
    if (!shipById(position, cmd.ship)) {
        issues.push({
            message: `setShipOwner: unknown ship ${cmd.ship}`,
            severity: "error",
        });
    }
    if (!position.players?.some((p) => p.id === cmd.owner)) {
        issues.push({
            message: `setShipOwner: unknown player ${cmd.owner}`,
            severity: "error",
        });
    }
    return issues;
}

export { fighterLaunchModeratorHints } from "./fighterLaunchDeclare";

export function validateFurballCommand(
    fold: FoldState,
    cmd: FullThrustGameCommand
): ValidationIssue[] {
    const c = cmd as { engagement?: FurballEngagement };
    if (!c.engagement) {
        return [{ message: "resolveFurball: missing engagement", severity: "error" }];
    }
    const issues: ValidationIssue[] = [];
    if (fold.meta.phase !== 8) {
        issues.push({
            message: "Furball resolution is typically in phase 8.",
            severity: "warning",
        });
    }
    const allocations = fighterAttackAllocations(fold.position, [], fold.meta.turn);
    const plan = screeningEngagementPlan(fold.position, allocations);
    issues.push(...validateFurballAgainstScreening(plan, c.engagement));
    return issues;
}

export function issuesToAudits(
    location: number,
    command: string,
    issues: ValidationIssue[]
): CommandAudit[] {
    return issues.map((issue) => ({
        location,
        command,
        description: issue.message,
        severity: issue.severity,
    }));
}

export function vectorManeuverBudgetSpent(maneuvers: VectorManeuver[]): number {
    let spent = 0;
    for (const m of maneuvers) {
        if (m.type === "rotate") spent += 1;
        else if (m.type === "push") spent += Math.round(Math.max(0, m.distance));
    }
    return spent;
}

export function vectorManeuverBudgetRemaining(
    ship: ShipGameState,
    maneuvers: VectorManeuver[]
): number {
    return maneuverPoints(shipThrust(ship)) - vectorManeuverBudgetSpent(maneuvers);
}
