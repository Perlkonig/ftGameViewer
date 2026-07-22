import type { FullThrustGamePosition } from "@/schemas/position";
import type { FullThrustGameCommand } from "@/schemas/commands";
import type { GameMeta, GamePhase } from "./types";
import { DEFAULT_META, metaForCommandReplay } from "./types";
import { nextPhase, SHIP_MOVEMENT_RESOLVE_PHASE, coerceGamePhase, currentActivationId } from "./phase";
import {
    applyAdvanceSegment,
    applyResolveLaunchOrdnance,
    applySegmentPhaseEntry,
    clearPendingForSegment,
    launchFromDeclare,
    queueDeclareBoarding,
    queueDeclareFire,
    queueDeclareLaunch,
    queueDeclareRepair,
    phase12UndeclaredAttackerShips,
    phase12UndeclaredDefenderShips,
} from "./segmentApply";
import { isBoardingDeclareCommand, BOARDING_STEP_LABELS } from "./boardingOrders";
import { normalizeCallsign } from "./fighterLabel";
import { buildFighterSymbol } from "@/lib/fighterMarker";
import {
    clampFighterWingStats,
    hangarIdFromFighterPosition,
    normalizeFighterFromDesign,
} from "./fighterWing";
import { validateSetFighterType } from "./fighterTypeCommand";
import { fighterProfileFor } from "./fighterProfiles";
import { nanoid } from "nanoid";
import { initialSalvoFields } from "./salvoOrdnance";
import {
    deployFighterFromHangar,
    dockFighterInHangar,
    initialHangarStateFromDesign,
    wingIdForHangar,
} from "@/lib/hangars";
import { consumeLauncherAmmunitionPatch } from "@/lib/ammunition";
import { buildOrdnanceSymbol } from "@/lib/ordnanceGlyph";
import { ordnanceLaunchFacing } from "@/lib/game/ordnanceLaunch";
import { inferPblBeamClassFromLauncher } from "./ordnanceBlast";
import { movementClockFacing, type Point } from "@/lib/game/movement";
import {
    applyFighterAttachment,
    clearFighterAttachment,
    findAttachmentTarget,
    recordFighterAttackOnTarget,
} from "./fighterAttachment";
import {
    validateMoveFightersCommand,
    validatePursueFighters,
    validateScreenFighters,
    decrementFighterEnduranceIfSecondary,
    parseScreenFightersTarget,
    type ScreenFightersTargetType,
} from "./fighterMove";
import {
    buildOrdnanceAllocationProposals,
    applyOrdnanceAllocationsToPosition,
    type PendingOrdnanceAllocation,
} from "./ordnanceAllocation";
import { fighterAttackAllocations } from "./fighterEngagement";
import {
    validateAllocateOrdnanceTarget,
    validateDeclareFighterAttack,
    type FighterAttackAllocation,
    type FighterAttackTargetType,
} from "./fighterAttack";
import {
    applyFurballToPosition,
    resolveFurballFromRolls,
    type FurballEngagement,
} from "./fighterDogfight";
import {
    applyInterceptToFighter,
    applyInterceptToOrdnance,
    resolveFighterIntercept,
    validateInterceptOrdnance,
} from "./fighterIntercept";
import {
    applyInterceptToGunboat,
    validateGunboatInterceptOrdnance,
} from "./gunboatIntercept";
import { clearGunboatAttachment } from "./gunboatAttachment";
import {
    applyPhase8FurballBatchFromRolls,
    phase8GunboatAllocations,
    validateDeclareFurball,
    validateResolvePhase8Furballs,
} from "./fighterPhase8";
import {
    applyPhase9PointDefenseBatchFromRolls,
    applyPointDefenseMountFromRolls,
    validateDeclarePointDefense,
    validateResolvePhase9PointDefense,
    validateResolvePointDefenseMount,
    type PointDefenseDeclaration,
} from "./pointDefensePhase9";
import type { FullThrustShip } from "ftlibship";
import { applyGunboatCommand } from "./gunboatApply";
import { placeGunboatSquadronsForShip } from "./gunboatPlace";
import { initialGunboatRackStateFromDesign } from "@/lib/gunboatRacks";
import {
    adjustBoarderUnits,
    setBoarderUnitsForOwner,
    removeBoarderUnits,
    boarderUnitsOnShip,
    resetBoarderIdCounter,
    type ShipWithBoarders,
} from "./boardingState";
import {
    applyBoarderDeploymentEffects,
    undeploySystem,
    type BoarderCommandDeploy,
} from "./crewDeployment";
import {
    applyResolvedMovePatch,
    resolveMoveFromOrder,
} from "./movementResolve";
import {
    resolvePhase5MovementSequence,
    buildMinePhaseResolveCommands,
    minePhaseDiceCount,
    type ResolvedShipMove,
} from "./mineMovement";
import { arrayRollSource, policyRollSource } from "./dice";
import { mergeCoreState, tickCoreState, type CoreState } from "./coreSystems";
import { applyHullDamageThreshold, clearPendingThreshold, thresholdsCrossed, hullLayout, shipsHavePendingThresholds } from "./thresholds";
import {
    applyBankEmpHitsCommand,
    assertNoPendingTransporterDeliveries,
    consumeTransporterDeliverySlot,
    markWeaponUsed,
    queueTransporterDelivery,
    weaponsFromFireDeclarations,
    type PendingTransporterDelivery,
} from "./weaponFireState";
import { resolveBankedEmp, empHullRowDrmForShip, empValidTargets, hasBankedEmp } from "./empFire";
import {
    applyTransporterDelivery,
    type TransporterDeliveryChoice,
} from "./transporterFire";
import {
    validateCommand,
    validateDeclareRepairOrdersCommand,
    validateDeclareShipFireCommand,
    validateDeclareTransporterDelivery,
    validateFurballCommand,
    issuesToAudits,
    type CommandAudit,
} from "./commandValidation";
import deepclone from "rfdc/default";
import { assertValidHtmlUid, assertGameUidAvailable } from "@/lib/htmlId";
import { validateShipJson } from "@/lib/shipValidation";
import { XMLValidator, XMLParser } from "fast-xml-parser";

export interface FoldState {
    meta: GameMeta;
    position: FullThrustGamePosition;
    /** Movement orders recorded before ship movement; applied on entering phase 5. */
    pendingMoves?: FullThrustGameCommand[];
    pendingLaunches?: FullThrustGameCommand[];
    pendingFireDeclarations?: FullThrustGameCommand[];
    pendingBoardingOrders?: FullThrustGameCommand[];
    pendingRepairOrders?: FullThrustGameCommand[];
    /** Mine placements queued in phase 5 before movement resolve. */
    pendingLayMines?: FullThrustGameCommand[];
    /** Ship paths from last resolvePhase5Movement (for mine dice step). */
    phase5ResolvedMoves?: ResolvedShipMove[];
    /** Movement applied this phase (paths may be cleared after mine resolve). */
    phase5MovementResolved?: boolean;
    /** Phase 7 homing ordnance allocation proposals (applied on segment advance). */
    pendingOrdnanceAllocations?: PendingOrdnanceAllocation[];
    /** Phase 8 furball declarations (orders segment). */
    phase8FurballDeclarations?: FurballEngagement[];
    /** Phase 9 point defense declarations (orders segment). */
    phase9PdDeclarations?: PointDefenseDeclaration[];
    /** Mount ids used for PDS or ship fire this turn (once per turn). */
    weaponUsedThisTurn?: Record<string, "pds" | "shipFire">;
    /** EMP hits banked for phase 13 resolution. */
    bankedEmpHits?: import("./empFire").BankedEmpState;
    /** Transporter beam hits awaiting delivery declaration. */
    pendingTransporterDeliveries?: PendingTransporterDelivery[];
}

export interface ApplyCommandOptions {
    /** Command log prefix for replay-dependent validation (furballs, attack allocations). */
    replayCommands?: FullThrustGameCommand[];
}

export interface ITransformedState {
    state: FoldState;
    warnings?: string[];
}

type ShipObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "ship" }
>;
type FighterObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "fighters" }
>;
type GunboatObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "gunboats" }
>;
type OrdnanceObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "ordnance" }
>;

function ensureObjects(state: FullThrustGamePosition): NonNullable<FullThrustGamePosition["objects"]> {
    if (!state.objects) state.objects = [];
    return state.objects;
}

function findShip(state: FullThrustGamePosition, id: string): ShipObj {
    const obj = state.objects?.find((o) => o.id === id);
    if (!obj || obj.objType !== "ship") throw new Error(`Ship not found: ${id}`);
    return obj;
}

function findObj(state: FullThrustGamePosition, id: string) {
    const obj = state.objects?.find((o) => o.id === id);
    if (!obj) throw new Error(`Object not found: ${id}`);
    return obj;
}

function foldSnapshot(
    meta: GameMeta,
    position: FullThrustGamePosition,
    fold: FoldState,
    overrides: Partial<
        Pick<
            FoldState,
            | "pendingMoves"
            | "pendingLaunches"
            | "pendingFireDeclarations"
            | "pendingBoardingOrders"
            | "pendingRepairOrders"
            | "pendingLayMines"
            | "phase5ResolvedMoves"
            | "phase5MovementResolved"
            | "pendingOrdnanceAllocations"
            | "phase8FurballDeclarations"
            | "phase9PdDeclarations"
            | "weaponUsedThisTurn"
            | "bankedEmpHits"
            | "pendingTransporterDeliveries"
        >
    > = {}
): FoldState {
    return {
        meta,
        position,
        pendingMoves:
            overrides.pendingMoves !== undefined
                ? overrides.pendingMoves
                : fold.pendingMoves,
        pendingLaunches:
            overrides.pendingLaunches !== undefined
                ? overrides.pendingLaunches
                : fold.pendingLaunches,
        pendingFireDeclarations:
            overrides.pendingFireDeclarations !== undefined
                ? overrides.pendingFireDeclarations
                : fold.pendingFireDeclarations,
        pendingBoardingOrders:
            overrides.pendingBoardingOrders !== undefined
                ? overrides.pendingBoardingOrders
                : fold.pendingBoardingOrders,
        pendingRepairOrders:
            overrides.pendingRepairOrders !== undefined
                ? overrides.pendingRepairOrders
                : fold.pendingRepairOrders,
        pendingLayMines:
            overrides.pendingLayMines !== undefined
                ? overrides.pendingLayMines
                : fold.pendingLayMines,
        phase5ResolvedMoves:
            "phase5ResolvedMoves" in overrides
                ? overrides.phase5ResolvedMoves
                : fold.phase5ResolvedMoves,
        phase5MovementResolved:
            "phase5MovementResolved" in overrides
                ? overrides.phase5MovementResolved
                : fold.phase5MovementResolved,
        pendingOrdnanceAllocations:
            overrides.pendingOrdnanceAllocations !== undefined
                ? overrides.pendingOrdnanceAllocations
                : fold.pendingOrdnanceAllocations,
        phase8FurballDeclarations:
            overrides.phase8FurballDeclarations !== undefined
                ? overrides.phase8FurballDeclarations
                : fold.phase8FurballDeclarations,
        phase9PdDeclarations:
            overrides.phase9PdDeclarations !== undefined
                ? overrides.phase9PdDeclarations
                : fold.phase9PdDeclarations,
        weaponUsedThisTurn:
            overrides.weaponUsedThisTurn !== undefined
                ? overrides.weaponUsedThisTurn
                : fold.weaponUsedThisTurn,
        bankedEmpHits:
            overrides.bankedEmpHits !== undefined
                ? overrides.bankedEmpHits
                : fold.bankedEmpHits,
        pendingTransporterDeliveries:
            overrides.pendingTransporterDeliveries !== undefined
                ? overrides.pendingTransporterDeliveries
                : fold.pendingTransporterDeliveries,
    };
}

function moveShipId(cmd: FullThrustGameCommand): string | undefined {
    if (cmd.name !== "moveShip") return undefined;
    const id = (cmd as { id?: string }).id;
    return typeof id === "string" ? id : undefined;
}

/** Apply a moveShip command to position (mutates ship in place). */
function applyMoveShipMutation(
    position: FullThrustGamePosition,
    cmd: FullThrustGameCommand
): string[] {
    if (cmd.name !== "moveShip") {
        throw new Error("applyMoveShipMutation: expected moveShip");
    }
    const ship = findShip(position, (cmd as { id?: string }).id!);
    const patch = resolveMoveFromOrder(ship, cmd);
    applyResolvedMovePatch(ship, patch);
    return patch.warnings;
}

function shouldDeferMoveShip(phase: GamePhase): boolean {
    return phase < SHIP_MOVEMENT_RESOLVE_PHASE;
}

export const applyCommand = (
    fold: FoldState,
    cmd: FullThrustGameCommand,
    options?: ApplyCommandOptions
): ITransformedState => {
    const warnings: string[] = [];
    const replayCommands = options?.replayCommands ?? [];
    let meta = deepclone(fold.meta) as GameMeta;
    let position = deepclone(fold.position) as FullThrustGamePosition;

    switch (cmd.name) {
        case "placeShip": {
            const [pos, w] = placeShip(position, cmd, meta);
            if (w) warnings.push(...w);
            return {
                state: foldSnapshot(meta, pos, fold),
                warnings: warnings.length ? warnings : undefined,
            };
        }
        case "moveShip": {
            if (shouldDeferMoveShip(meta.phase as GamePhase)) {
                const shipId = cmd.id!;
                const pending = [...(fold.pendingMoves ?? [])];
                if (pending.some((c) => moveShipId(c) === shipId)) {
                    throw new Error(
                        `moveShip: duplicate movement order for ship ${shipId}`
                    );
                }
                pending.push(deepclone(cmd));
                return { state: foldSnapshot(meta, position, fold, { pendingMoves: pending }) };
            }
            const moveWarnings = applyMoveShipMutation(position, cmd);
            if (moveWarnings.length) warnings.push(...moveWarnings);
            return {
                state: foldSnapshot(meta, position, fold),
                warnings: warnings.length ? warnings : undefined,
            };
        }
        case "layMine": {
            const phase = coerceGamePhase(meta.phase);
            if (phase < SHIP_MOVEMENT_RESOLVE_PHASE) {
                throw new Error("layMine: only legal in phase 5");
            }
            findShip(position, cmd.ship!);
            const pending = [...(fold.pendingLayMines ?? [])];
            pending.push(deepclone(cmd));
            return {
                state: foldSnapshot(meta, position, fold, { pendingLayMines: pending }),
            };
        }
        case "resolvePhase5Movement": {
            const result = resolvePhase5MovementSequence(
                position,
                meta,
                fold.pendingMoves,
                fold.pendingLayMines
            );
            if (result.warnings.length) warnings.push(...result.warnings);
            return {
                state: foldSnapshot(meta, result.position, fold, {
                    pendingMoves: [],
                    pendingLayMines: [],
                    phase5ResolvedMoves: result.moves,
                    phase5MovementResolved: true,
                }),
                warnings: warnings.length ? warnings : undefined,
            };
        }
        case "resolveMinePhase": {
            const preExpanded = (cmd as { preExpanded?: boolean }).preExpanded === true;
            const moves = fold.phase5ResolvedMoves ?? [];
            const rolls = (cmd as { rolls?: number[] }).rolls ?? [];
            if (!preExpanded && moves.length > 0) {
                const source =
                    rolls.length > 0
                        ? arrayRollSource(rolls)
                        : policyRollSource(meta.dicePolicy, { seed: meta.diceSeed });
                const { cmds, warnings: mineWarnings } = buildMinePhaseResolveCommands(
                    position,
                    meta,
                    moves,
                    source
                );
                warnings.push(...mineWarnings);
                for (const sub of cmds) {
                    const applied = applyCommand(
                        { meta, position, ...fold, phase5ResolvedMoves: undefined },
                        sub
                    );
                    position = applied.state.position;
                    meta = applied.state.meta;
                    if (applied.warnings) warnings.push(...applied.warnings);
                }
            }
            return {
                state: foldSnapshot(meta, position, fold, {
                    phase5ResolvedMoves: undefined,
                    phase5MovementResolved: true,
                }),
                warnings: warnings.length ? warnings : undefined,
            };
        }
        case "launchOrdnance": {
            const ship = findShip(position, cmd.ship!);
            const c = cmd as {
                id?: string;
                systemId?: string;
                type?: OrdnanceObj["type"];
                position?: { x: number; y: number };
                range?: number;
                facing?: OrdnanceObj["facing"];
                stage?: 1 | 2;
                aimPosition?: { x: number; y: number };
                targetShip?: string;
                deployedTurn?: number;
            };
            if (c.type === "rocket") {
                throw new Error("launchOrdnance: use declareLaunchOrdnance for rocket pods");
            }
            const id = c.id;
            if (!id) throw new Error("launchOrdnance: missing id");
            assertValidHtmlUid(id, "launchOrdnance");
            assertGameUidAvailable(position, id, "launchOrdnance");
            const glyph = c.systemId
                ? buildOrdnanceSymbol(ship as import("./shipSystems").ShipGameState, c.systemId, id)
                : undefined;
            const ordType = c.type ?? "missile";
            const blastRange = ordType === "plasmaBolt" ? 6 : c.range;
            const launchPos = cmd.position!;
            const facing = ordnanceLaunchFacing(ship, launchPos);
            ensureObjects(position).push({
                objType: "ordnance",
                id,
                owner: ship.owner,
                type: ordType,
                position: launchPos,
                range: blastRange,
                facing,
                stage: c.stage,
                aimPosition: c.aimPosition,
                launcherShip: cmd.ship,
                systemId: c.systemId,
                targetShip: c.targetShip,
                deployedTurn: c.deployedTurn ?? meta.turn,
                detonateOpenSpace: (c as { detonateOpenSpace?: boolean }).detonateOpenSpace,
                svg: glyph?.svg,
                ...initialSalvoFields(ordType),
            } as OrdnanceObj);
            if (!ship.ammo) ship.ammo = [];
            if (c.systemId) {
                ship.ammo = consumeLauncherAmmunitionPatch(
                    ship as import("./shipSystems").ShipGameState,
                    c.systemId
                );
            }
            if (ordType === "plasmaBolt" && c.systemId) {
                const pbl = (ship as { pblFiredTurn?: Record<string, number> }).pblFiredTurn ?? {};
                pbl[c.systemId] = meta.turn;
                (ship as { pblFiredTurn?: Record<string, number> }).pblFiredTurn = pbl;
            }
            const launched = ensureObjects(position).find((o) => o.id === id) as OrdnanceObj;
            if (launched && ordType === "plasmaBolt") {
                (launched as { beamClass?: number }).beamClass = inferPblBeamClassFromLauncher(
                    ship as import("./shipSystems").ShipGameState,
                    c.systemId
                );
            }
            return { state: foldSnapshot(meta, position, fold) };
        }
        case "moveOrdnance": {
            const obj = findObj(position, cmd.id!);
            if (obj.objType !== "ordnance") throw new Error("moveOrdnance: not ordnance");
            const oldPos = obj.position as Point | undefined;
            const newPos = cmd.position!;
            obj.position = newPos;
            const mc = cmd as { stage?: 2; facing?: OrdnanceObj["facing"] };
            if (mc.stage !== undefined) obj.stage = mc.stage;
            if (
                oldPos &&
                typeof oldPos === "object" &&
                "x" in oldPos &&
                newPos &&
                typeof newPos === "object" &&
                "x" in newPos
            ) {
                obj.facing = movementClockFacing(oldPos, newPos);
            } else if (mc.facing !== undefined) {
                obj.facing = mc.facing;
            }
            return { state: foldSnapshot(meta, position, fold) };
        }
        case "useAmmo":
        case "consumeAmmo": {
            const ship = findShip(position, cmd.ship!);
            const systemId = (cmd as { systemId?: string }).systemId!;
            ship.ammo = consumeLauncherAmmunitionPatch(ship, systemId);
            return { state: foldSnapshot(meta, position, fold) };
        }
        case "launchFighters": {
            const ship = findShip(position, cmd.ship!);
            const lc = cmd as {
                id?: string;
                hangarId?: string;
                position?: { x: number; y: number };
                facing?: FighterObj["facing"];
                callsign?: string;
            };
            if (!lc.hangarId) throw new Error("launchFighters: missing hangarId");
            const wingId = lc.id ?? wingIdForHangar(cmd.ship!, lc.hangarId);
            assertValidHtmlUid(wingId, "launchFighters");
            const existing = position.objects?.find(
                (o) => o.objType === "fighters" && o.id === wingId
            ) as FighterObj | undefined;
            const hangars = (ship as { hangars?: import("ftlibship").HangarState }).hangars ?? {};
            (ship as { hangars?: import("ftlibship").HangarState }).hangars =
                deployFighterFromHangar(hangars, lc.hangarId);
            const wingType = existing?.type ?? "standard";
            const wingNumber = existing?.number ?? 6;
            const wingSkill = existing?.skill ?? "standard";
            const wingEndurance = existing?.endurance ?? existing?.enduranceMax ?? 6;
            const wingMods = (existing as { mods?: string[] } | undefined)?.mods;
            const wingEnduranceMax = (existing as { enduranceMax?: number } | undefined)?.enduranceMax;
            const sym = buildFighterSymbol(wingId, {
                type: wingType,
                number: wingNumber,
                skill: wingSkill,
            });
            const applyCallsign = (fighter: FighterObj) => {
                const next = normalizeCallsign(lc.callsign);
                if (!next) return;
                const current = normalizeCallsign(
                    (fighter as { callsign?: string }).callsign
                );
                if (!current) {
                    (fighter as { callsign?: string }).callsign = next;
                }
            };
            if (existing) {
                existing.position = lc.position!;
                existing.facing = ship.facing;
                existing.svg = sym.svg;
                applyCallsign(existing);
            } else {
                assertGameUidAvailable(position, wingId, "launchFighters");
                const created = {
                    objType: "fighters",
                    id: wingId,
                    owner: ship.owner,
                    type: wingType,
                    position: lc.position!,
                    facing: ship.facing,
                    number: wingNumber,
                    endurance: wingEndurance,
                    enduranceMax: wingEnduranceMax,
                    mods: wingMods,
                    skill: wingSkill,
                    svg: sym.svg,
                } as FighterObj;
                applyCallsign(created);
                ensureObjects(position).push(created);
            }
            return { state: foldSnapshot(meta, position, fold) };
        }
        case "setFighterCallsign": {
            const fighter = findObj(position, (cmd as { id: string }).id) as FighterObj;
            if (fighter.objType !== "fighters") {
                throw new Error("setFighterCallsign: not a fighter group");
            }
            const next = normalizeCallsign((cmd as { callsign?: string }).callsign);
            if (next) {
                (fighter as { callsign?: string }).callsign = next;
            } else {
                delete (fighter as { callsign?: string }).callsign;
            }
            return { state: foldSnapshot(meta, position, fold) };
        }
        case "setFighterType": {
            const c = cmd as { id?: string; type?: string };
            if (!c.id || !c.type) throw new Error("setFighterType: incomplete");
            const err = validateSetFighterType(c.type);
            if (err) throw new Error(`setFighterType: ${err}`);
            const fighter = findObj(position, c.id) as FighterObj;
            if (fighter.objType !== "fighters") {
                throw new Error("setFighterType: not a fighter group");
            }
            fighter.type = c.type;
            const wing = {
                type: fighter.type,
                mods: (fighter as { mods?: string[] }).mods,
                number: fighter.number,
                endurance: fighter.endurance,
            };
            clampFighterWingStats(wing);
            fighter.number = wing.number;
            fighter.endurance = wing.endurance;
            (fighter as { enduranceMax?: number }).enduranceMax = wing.enduranceMax;
            const sym = buildFighterSymbol(fighter.id, {
                type: fighter.type,
                number: fighter.number ?? 6,
                skill: fighter.skill,
            });
            fighter.svg = sym.svg;
            const docked = hangarIdFromFighterPosition(fighter.position);
            if (docked) {
                const ship = findShip(position, docked.ship) as ShipObj & {
                    hangars?: import("ftlibship").HangarState;
                };
                const hangars = ship.hangars ?? {};
                hangars[docked.hangar] = {
                    type: fighter.type,
                    number: fighter.number,
                    skill: fighter.skill,
                    mods: (fighter as { mods?: string[] }).mods,
                    enduranceMax: (fighter as { enduranceMax?: number }).enduranceMax,
                };
                ship.hangars = hangars;
            }
            return { state: foldSnapshot(meta, position, fold) };
        }
        case "launchFighterOrdnance": {
            const c = cmd as { id?: string; targetShipId?: string };
            if (!c.id || !c.targetShipId) throw new Error("launchFighterOrdnance: incomplete");
            const fighter = findObj(position, c.id) as FighterObj & { payloadSpent?: boolean };
            if (fighter.objType !== "fighters") throw new Error("launchFighterOrdnance: not fighters");
            const wing = {
                type: fighter.type,
                mods: (fighter as { mods?: string[] }).mods,
            };
            const profile = fighterProfileFor(wing);
            fighter.endurance = Math.max(0, (fighter.endurance ?? 6) - 1);
            fighter.payloadSpent = true;
            const fpos = fighter.position;
            if (fpos && typeof fpos === "object" && "x" in fpos) {
                const ordId = `ftord_${nanoid(8)}`;
                if (!position.objects) position.objects = [];
                const ordType = profile.ordnanceLaunchType === "missile" ? "salvo" : "missile";
                position.objects.push({
                    objType: "ordnance",
                    id: ordId,
                    owner: fighter.owner,
                    type: ordType,
                    position: { x: fpos.x, y: fpos.y },
                    facing: fighter.facing ?? 12,
                    targetShip: c.targetShipId,
                    deployedTurn: meta.turn,
                    salvoCount: fighter.number ?? 6,
                    range: profile.missileLockRangeMu,
                } as NonNullable<FullThrustGamePosition["objects"]>[number]);
            }
            return { state: foldSnapshot(meta, position, fold) };
        }
        case "moveFighters": {
            const obj = findObj(position, cmd.id!) as FighterObj;
            if (obj.objType !== "fighters") throw new Error("moveFighters: not fighters");
            const oldPos = obj.position as Point | undefined;
            const newPos = cmd.position as FighterObj["position"];
            const wasDeployed =
                oldPos &&
                typeof oldPos === "object" &&
                "x" in oldPos;
            const docking =
                newPos &&
                typeof newPos === "object" &&
                "ship" in newPos &&
                "hangar" in newPos;
            clearFighterAttachment(obj);
            obj.position = newPos;
            if (cmd.facing !== undefined) {
                obj.facing = cmd.facing;
            } else if (
                wasDeployed &&
                !docking &&
                newPos &&
                typeof newPos === "object" &&
                "x" in newPos &&
                oldPos &&
                "x" in oldPos
            ) {
                obj.facing = movementClockFacing(oldPos, newPos);
            }
            if (cmd.vectors) {
                if (!obj.vectors) obj.vectors = [];
                obj.vectors.unshift(cmd.vectors as [ { x: number; y: number }, { x: number; y: number }, ...{ x: number; y: number }[] ]);
            }
            decrementFighterEnduranceIfSecondary(obj, meta.phase);
            if (docking && wasDeployed) {
                const carrier = findShip(position, newPos.ship);
                const hangars =
                    (carrier as { hangars?: import("ftlibship").HangarState }).hangars ?? {};
                (carrier as { hangars?: import("ftlibship").HangarState }).hangars =
                    dockFighterInHangar(
                        carrier.object as FullThrustShip,
                        hangars,
                        newPos.hangar,
                        {
                            type: obj.type as import("ftlibship").FighterType,
                            number: obj.number,
                            skill: obj.skill,
                        }
                    );
            }
            const moveWarnings = validateMoveFightersCommand(fold, cmd)
                .filter((i) => i.severity === "warning")
                .map((i) => i.message);
            if (moveWarnings.length) warnings.push(...moveWarnings);
            return {
                state: foldSnapshot(meta, position, fold),
                warnings: warnings.length ? warnings : undefined,
            };
        }
        case "screenFighters": {
            const c = cmd as {
                id?: string;
                ship?: string;
                targetType?: ScreenFightersTargetType;
                targetId?: string;
                facing?: number;
            };
            const parsed = parseScreenFightersTarget(c);
            if (!parsed) throw new Error("screenFighters: missing target");
            const obj = findObj(position, c.id!) as FighterObj;
            if (obj.objType !== "fighters") throw new Error("screenFighters: not fighters");
            const target = findAttachmentTarget(
                position,
                parsed.targetType,
                parsed.targetId
            );
            if (!target) {
                throw new Error(
                    `screenFighters: target not found ${parsed.targetType} ${parsed.targetId}`
                );
            }
            applyFighterAttachment(obj, target, "screen", parsed.targetType, {
                screenFacing:
                    c.facing !== undefined
                        ? (c.facing as import("./movement").ClockFacing)
                        : undefined,
            });
            decrementFighterEnduranceIfSecondary(obj, meta.phase);
            const screenWarnings = validateScreenFighters(fold, cmd)
                .filter((i) => i.severity === "warning")
                .map((i) => i.message);
            if (screenWarnings.length) warnings.push(...screenWarnings);
            return {
                state: foldSnapshot(meta, position, fold),
                warnings: warnings.length ? warnings : undefined,
            };
        }
        case "pursueFighters": {
            const c = cmd as {
                id?: string;
                targetType?: "ship" | "fighters";
                targetId?: string;
            };
            const obj = findObj(position, c.id!) as FighterObj;
            if (obj.objType !== "fighters") throw new Error("pursueFighters: not fighters");
            const target = findAttachmentTarget(position, c.targetType!, c.targetId!);
            if (!target) {
                throw new Error(`pursueFighters: target not found ${c.targetType} ${c.targetId}`);
            }
            applyFighterAttachment(obj, target, "pursue", c.targetType!);
            decrementFighterEnduranceIfSecondary(obj, meta.phase);
            const pursueWarnings = validatePursueFighters(fold, cmd)
                .filter((i) => i.severity === "warning")
                .map((i) => i.message);
            if (pursueWarnings.length) warnings.push(...pursueWarnings);
            return {
                state: foldSnapshot(meta, position, fold),
                warnings: warnings.length ? warnings : undefined,
            };
        }
        case "adjustFighters": {
            const obj = findObj(position, cmd.id!);
            if (obj.objType !== "fighters") throw new Error("adjustFighters: not fighters");
            if (cmd.number !== undefined) obj.number = cmd.number;
            if (cmd.endurance !== undefined) obj.endurance = cmd.endurance;
            if (cmd.skill !== undefined) obj.skill = cmd.skill;
            return { state: foldSnapshot(meta, position, fold) };
        }
        case "launchGunboats":
        case "moveGunboats":
        case "screenGunboats":
        case "pursueGunboats":
        case "adjustGunboats":
        case "declareGunboatAttack":
        case "setGunboatCallsign":
        case "launchGunboatOrdnance": {
            const gb = applyGunboatCommand(cmd, position, meta, { ...fold, meta, position }, warnings);
            if (!gb.handled) throw new Error(`Unhandled gunboat command: ${cmd.name}`);
            return {
                state: foldSnapshot(meta, position, fold),
                warnings:
                    gb.warnings ?? (warnings.length ? warnings : undefined),
            };
        }
        case "fireWeapon": {
            // Log-only for board state; damage applied via subsequent dmgShip/sysDisable.
            findShip(position, cmd.ship!);
            findObj(position, cmd.target!);
            return { state: foldSnapshot(meta, position, fold) };
        }
        case "dmgShip": {
            const ship = findShip(position, cmd.ship!);
            const dmgBefore = ship.dmgHull ?? 0;
            const hullAdded = cmd.hull ?? 0;
            ship.dmgHull = dmgBefore + hullAdded;
            if (cmd.armour) {
                if (!ship.dmgArmour) {
                    ship.dmgArmour = cmd.armour.map((n) => ({
                        standard: n,
                        regenerative: 0,
                        regenerativeLost: 0,
                    }));
                } else {
                    for (let i = 0; i < cmd.armour.length; i++) {
                        if (!ship.dmgArmour[i]) {
                            ship.dmgArmour[i] = { standard: 0, regenerative: 0, regenerativeLost: 0 };
                        }
                        ship.dmgArmour[i].standard =
                            (ship.dmgArmour[i].standard ?? 0) + cmd.armour[i];
                    }
                }
            }
            if (hullAdded > 0 && (meta.phase === 11 || meta.phase === 12)) {
                const { hullBoxes, rows } = hullLayout(ship);
                const crossing = thresholdsCrossed(hullBoxes, rows, dmgBefore, ship.dmgHull ?? 0);
                if (crossing.thresholdsCrossed > 0) {
                    const empShip = ship as { empHullRowDrm?: number };
                    empShip.empHullRowDrm =
                        (empShip.empHullRowDrm ?? 0) + crossing.thresholdsCrossed;
                }
            }
            applyHullDamageThreshold(ship, dmgBefore, hullAdded);
            return { state: foldSnapshot(meta, position, fold) };
        }
        case "regenArmour": {
            const ship = findShip(position, cmd.ship!);
            if (!ship.dmgArmour) ship.dmgArmour = [];
            for (let i = 0; i < (cmd.armour?.length ?? 0); i++) {
                if (!ship.dmgArmour[i]) {
                    ship.dmgArmour[i] = { standard: 0, regenerative: 0 };
                }
                const repair = cmd.armour![i];
                const cur = ship.dmgArmour[i].regenerative ?? 0;
                ship.dmgArmour[i].regenerative = Math.max(0, cur - repair);
                // Also reduce standard damage if regenerative track unused
                if ((ship.dmgArmour[i].regenerative ?? 0) === 0) {
                    ship.dmgArmour[i].standard = Math.max(
                        0,
                        (ship.dmgArmour[i].standard ?? 0) - repair
                    );
                }
            }
            return { state: foldSnapshot(meta, position, fold) };
        }
        case "sysDisable": {
            const ship = findShip(position, cmd.ship!);
            if (!ship.systems) ship.systems = [];
            const existing = ship.systems.find((s) => s.id === cmd.system);
            const state = (cmd as { state?: "damaged" | "destroyed" }).state ?? "damaged";
            if (existing) existing.state = state;
            else ship.systems.push({ id: cmd.system!, state });
            if (state === "destroyed" || state === "damaged") {
                undeploySystem(ship, cmd.system!);
            }
            return { state: foldSnapshot(meta, position, fold) };
        }
        case "sysEnable": {
            const ship = findShip(position, cmd.ship!);
            if (!ship.systems) ship.systems = [];
            const existing = ship.systems.find((s) => s.id === cmd.system);
            const enableState = (cmd as { state?: "repaired" | null }).state;
            if (enableState === "repaired") {
                if (existing) existing.state = "repaired";
                else ship.systems.push({ id: cmd.system!, state: "repaired" });
            } else {
                ship.systems = ship.systems.filter((s) => s.id !== cmd.system);
            }
            return { state: foldSnapshot(meta, position, fold) };
        }
        case "objDestroy": {
            const uuid = (cmd as { uuid?: string }).uuid;
            if (!uuid) throw new Error("objDestroy: missing uuid");
            ensureObjects(position);
            const objects = position.objects!;
            const exactIdx = objects.findIndex((o) => o.id === uuid);
            if (exactIdx >= 0) {
                objects.splice(exactIdx, 1);
            } else {
                const legacy = uuid.match(/^mine_([^_]+)_([^_]+)_/);
                if (legacy) {
                    const [, shipId, systemId] = legacy;
                    const prefix = `mine_${shipId}_${systemId}_`;
                    const candidates = objects.filter(
                        (o) =>
                            o.objType === "ordnance" &&
                            (o as OrdnanceObj).type === "mine" &&
                            o.id.startsWith(prefix)
                    );
                    if (candidates.length === 1) {
                        position.objects = objects.filter((o) => o.id !== candidates[0].id);
                    } else if (candidates.length > 1) {
                        warnings.push(
                            `objDestroy: could not match mine ${uuid} (${candidates.length} candidates with prefix ${prefix})`
                        );
                    }
                }
            }
            return { state: foldSnapshot(meta, position, fold) };
        }
        case "objHide": {
            const uuid = (cmd as { uuid?: string }).uuid;
            if (!uuid) throw new Error("objHide: missing uuid");
            const obj = findObj(position, uuid);
            if (obj.objType === "ship" || obj.objType === "fighters") {
                (obj as ShipObj).position = null as unknown as ShipObj["position"];
            }
            return { state: foldSnapshot(meta, position, fold) };
        }
        case "awardVP": {
            const player = position.players?.find((p) => p.id === cmd.player);
            if (!player) throw new Error(`awardVP: player not found: ${cmd.player}`);
            player.vp = (player.vp ?? 0) + (cmd.vp ?? 0);
            return { state: foldSnapshot(meta, position, fold) };
        }
        case "advanceSegment": {
            const prevSegment = meta.segment ?? "orders";
            if (meta.phase === 11 && prevSegment === "resolve") {
                assertNoPendingTransporterDeliveries(fold.pendingTransporterDeliveries);
            }
            if (meta.phase === 12 && prevSegment === "orders") {
                const step = meta.boardingStep ?? "attacker";
                if (step === "attacker") {
                    const undeclared = phase12UndeclaredAttackerShips(
                        meta,
                        position,
                        undefined,
                        fold.pendingBoardingOrders
                    );
                    if (undeclared.length > 0) {
                        throw new Error(
                            `advanceSegment: ${BOARDING_STEP_LABELS.attackerAllocation} incomplete for ${undeclared.join(", ")}`
                        );
                    }
                } else if (step === "defender") {
                    const undeclared = phase12UndeclaredDefenderShips(
                        meta,
                        position,
                        undefined,
                        fold.pendingBoardingOrders
                    );
                    if (undeclared.length > 0) {
                        throw new Error(
                            `advanceSegment: ${BOARDING_STEP_LABELS.defenderAllocation} incomplete for ${undeclared.join(", ")}`
                        );
                    }
                }
            }
            if (meta.phase === 7 && prevSegment === "orders") {
                const pending = fold.pendingOrdnanceAllocations ?? [];
                if (pending.length > 0) {
                    applyOrdnanceAllocationsToPosition(position, pending);
                }
                meta = applyAdvanceSegment(meta);
                return {
                    state: foldSnapshot(meta, position, fold, {
                        pendingOrdnanceAllocations: [],
                    }),
                };
            }
            meta = applyAdvanceSegment(meta);
            return { state: foldSnapshot(meta, position, fold) };
        }
        case "proposeOrdnanceAllocations": {
            const pendingOrdnanceAllocations = buildOrdnanceAllocationProposals(position);
            return {
                state: foldSnapshot(meta, position, fold, { pendingOrdnanceAllocations }),
            };
        }
        case "allocateOrdnanceTarget": {
            const c = cmd as {
                ordnanceId?: string;
                action?: PendingOrdnanceAllocation["action"];
                targetShipId?: string;
            };
            if (!c.ordnanceId || !c.action) {
                throw new Error("allocateOrdnanceTarget: incomplete");
            }
            const segment = meta.segment ?? "orders";
            const entry: PendingOrdnanceAllocation = {
                ordnanceId: c.ordnanceId,
                action: c.action,
                targetShipId: c.targetShipId,
                proposed: false,
            };
            if (segment === "resolve") {
                applyOrdnanceAllocationsToPosition(position, [entry]);
                return { state: foldSnapshot(meta, position, fold) };
            }
            const pending = [...(fold.pendingOrdnanceAllocations ?? [])];
            const idx = pending.findIndex((p) => p.ordnanceId === c.ordnanceId);
            if (idx >= 0) pending[idx] = entry;
            else pending.push(entry);
            return {
                state: foldSnapshot(meta, position, fold, {
                    pendingOrdnanceAllocations: pending,
                }),
            };
        }
        case "clearOrdnanceAllocation": {
            const ordnanceId = (cmd as { ordnanceId?: string }).ordnanceId;
            if (!ordnanceId) throw new Error("clearOrdnanceAllocation: missing ordnanceId");
            const ord = position.objects?.find(
                (o) => o.objType === "ordnance" && o.id === ordnanceId
            );
            if (ord && ord.objType === "ordnance") {
                delete (ord as { targetShip?: string }).targetShip;
            }
            const pending = (fold.pendingOrdnanceAllocations ?? []).filter(
                (p) => p.ordnanceId !== ordnanceId
            );
            return {
                state: foldSnapshot(meta, position, fold, {
                    pendingOrdnanceAllocations: pending,
                }),
            };
        }
        case "applyOrdnanceAllocations": {
            const pending = fold.pendingOrdnanceAllocations ?? [];
            if (pending.length > 0) {
                applyOrdnanceAllocationsToPosition(position, pending);
            }
            return {
                state: foldSnapshot(meta, position, fold, {
                    pendingOrdnanceAllocations: [],
                }),
            };
        }
        case "declareFighterAttack": {
            const c = cmd as {
                id?: string;
                targetType?: FighterAttackTargetType;
                targetId?: string;
            };
            if (!c.id || !c.targetType || !c.targetId) {
                throw new Error("declareFighterAttack: incomplete");
            }
            const fighter = findObj(position, c.id) as FighterObj;
            if (fighter.objType !== "fighters") {
                throw new Error("declareFighterAttack: not a fighter group");
            }
            const allocation: FighterAttackAllocation = {
                turn: meta.turn,
                targetType: c.targetType,
                targetId: c.targetId,
            };
            (fighter as FighterObj & { attackAllocation?: FighterAttackAllocation }).attackAllocation =
                allocation;
            (fighter as { lastAttack?: import("./fighterAttachment").LastAttack }).lastAttack = {
                turn: meta.turn,
                targetType: c.targetType,
                targetId: c.targetId,
            };
            if (c.targetType === "ship" || c.targetType === "fighters") {
                recordFighterAttackOnTarget(
                    position,
                    c.id,
                    c.targetType,
                    c.targetId,
                    meta.turn
                );
            }
            return { state: foldSnapshot(meta, position, fold) };
        }
        case "declareFurball": {
            const c = cmd as { engagement?: FurballEngagement };
            if (!c.engagement) throw new Error("declareFurball: missing engagement");
            const allocations = fighterAttackAllocations(position, [], meta.turn);
            const gunboatAllocations = phase8GunboatAllocations(position, [], meta.turn);
            const existing = fold.phase8FurballDeclarations ?? [];
            const issues = validateDeclareFurball(
                position,
                c.engagement,
                existing,
                allocations,
                gunboatAllocations
            );
            const errors = issues.filter((i) => i.severity === "error");
            if (errors.length) throw new Error(errors[0].message);
            const declWarnings = issues
                .filter((i) => i.severity === "warning")
                .map((i) => i.message);
            if (declWarnings.length) warnings.push(...declWarnings);
            const nextDecl = [...existing, c.engagement];
            return {
                state: foldSnapshot(meta, position, fold, {
                    phase8FurballDeclarations: nextDecl,
                }),
                warnings: warnings.length ? warnings : undefined,
            };
        }
        case "resolvePhase8Furballs": {
            const c = cmd as { rolls?: number[] };
            if (!c.rolls?.length) throw new Error("resolvePhase8Furballs: rolls required");
            if (meta.phase !== 8) throw new Error("resolvePhase8Furballs: phase 8 only");
            if ((meta.segment ?? "orders") !== "resolve") {
                throw new Error("resolvePhase8Furballs: resolve segment only");
            }
            const declarations = fold.phase8FurballDeclarations ?? [];
            const allocations = fighterAttackAllocations(position, [], meta.turn);
            const gunboatAllocations = phase8GunboatAllocations(position, [], meta.turn);
            const issues = validateResolvePhase8Furballs(
                position,
                allocations,
                declarations,
                gunboatAllocations
            );
            const errors = issues.filter((i) => i.severity === "error");
            if (errors.length) throw new Error(errors[0].message);
            const result = applyPhase8FurballBatchFromRolls(
                position,
                declarations,
                c.rolls,
                allocations,
                gunboatAllocations
            );
            void result;
            return {
                state: foldSnapshot(meta, position, fold, {
                    phase8FurballDeclarations: [],
                }),
                warnings: warnings.length ? warnings : undefined,
            };
        }
        case "declarePointDefense": {
            const c = cmd as PointDefenseDeclaration & { name?: string };
            if (!c.defenderShip || !c.weapon || !c.threatId) {
                throw new Error("declarePointDefense: incomplete");
            }
            const declaration: PointDefenseDeclaration = {
                defenderShip: c.defenderShip,
                weapon: c.weapon,
                supportedShip: c.supportedShip ?? c.defenderShip,
                threatId: c.threatId,
                profile: c.profile ?? "pds",
                adsMode: c.adsMode,
                splitTargetId: c.splitTargetId,
            };
            const existing = fold.phase9PdDeclarations ?? [];
            const issues = validateDeclarePointDefense(
                position,
                declaration,
                existing,
                replayCommands,
                meta.turn,
                { furballDeclarations: fold.phase8FurballDeclarations }
            );
            const errors = issues.filter((i) => i.severity === "error");
            if (errors.length) throw new Error(errors[0].message);
            const declWarnings = issues
                .filter((i) => i.severity === "warning")
                .map((i) => i.message);
            if (declWarnings.length) warnings.push(...declWarnings);
            return {
                state: foldSnapshot(meta, position, fold, {
                    phase9PdDeclarations: [...existing, declaration],
                }),
                warnings: warnings.length ? warnings : undefined,
            };
        }
        case "resolvePhase9PointDefense": {
            const c = cmd as { rolls?: number[] };
            if (!c.rolls?.length) throw new Error("resolvePhase9PointDefense: rolls required");
            if (meta.phase !== 9) throw new Error("resolvePhase9PointDefense: phase 9 only");
            if ((meta.segment ?? "orders") !== "resolve") {
                throw new Error("resolvePhase9PointDefense: resolve segment only");
            }
            const declarations = fold.phase9PdDeclarations ?? [];
            const issues = validateResolvePhase9PointDefense(
                position,
                declarations,
                replayCommands,
                meta.turn,
                { furballDeclarations: fold.phase8FurballDeclarations }
            );
            const errors = issues.filter((i) => i.severity === "error");
            if (errors.length) throw new Error(errors[0].message);
            applyPhase9PointDefenseBatchFromRolls(
                position,
                declarations,
                c.rolls,
                replayCommands,
                meta.turn
            );
            let weaponUsedThisTurn = { ...(fold.weaponUsedThisTurn ?? {}) };
            for (const decl of declarations) {
                weaponUsedThisTurn = markWeaponUsed(
                    { ...fold, weaponUsedThisTurn },
                    decl.weapon,
                    "pds"
                );
            }
            return {
                state: foldSnapshot(meta, position, fold, {
                    phase9PdDeclarations: [],
                    weaponUsedThisTurn,
                }),
                warnings: warnings.length ? warnings : undefined,
            };
        }
        case "resolvePointDefenseMount": {
            const c = cmd as import("./pointDefensePhase9").PointDefenseDeclaration & {
                rolls?: number[];
            };
            if (!c.rolls?.length) throw new Error("resolvePointDefenseMount: rolls required");
            if (!c.defenderShip || !c.weapon || !c.threatId) {
                throw new Error("resolvePointDefenseMount: incomplete");
            }
            if (meta.phase !== 9) throw new Error("resolvePointDefenseMount: phase 9 only");
            if ((meta.segment ?? "orders") !== "resolve") {
                throw new Error("resolvePointDefenseMount: resolve segment only");
            }
            const declaration = {
                defenderShip: c.defenderShip,
                weapon: c.weapon,
                supportedShip: c.supportedShip ?? c.defenderShip,
                threatId: c.threatId,
                profile: c.profile ?? "pds",
                adsMode: c.adsMode,
                splitTargetId: c.splitTargetId,
            };
            const existing = fold.phase9PdDeclarations ?? [];
            const issues = validateResolvePointDefenseMount(
                position,
                declaration,
                existing,
                replayCommands,
                meta.turn,
                { furballDeclarations: fold.phase8FurballDeclarations }
            );
            const errors = issues.filter((i) => i.severity === "error");
            if (errors.length) throw new Error(errors[0].message);
            applyPointDefenseMountFromRolls(position, declaration, c.rolls, {
                applySelfDestruct: false,
            });
            const remaining = existing.filter(
                (d) =>
                    !(
                        d.defenderShip === declaration.defenderShip &&
                        d.weapon === declaration.weapon
                    )
            );
            const weaponUsedThisTurn = markWeaponUsed(fold, declaration.weapon, "pds");
            return {
                state: foldSnapshot(meta, position, fold, {
                    phase9PdDeclarations: remaining,
                    weaponUsedThisTurn,
                }),
                warnings: warnings.length ? warnings : undefined,
            };
        }
        case "resolvePhase9Complete": {
            if (meta.phase !== 9) throw new Error("resolvePhase9Complete: phase 9 only");
            if ((meta.segment ?? "orders") !== "resolve") {
                throw new Error("resolvePhase9Complete: resolve segment only");
            }
            const remaining = fold.phase9PdDeclarations ?? [];
            if (remaining.length > 0) {
                throw new Error(
                    `resolvePhase9Complete: ${remaining.length} declaration(s) not yet resolved`
                );
            }
            return {
                state: foldSnapshot(meta, position, fold, {
                    phase9PdDeclarations: [],
                }),
                warnings: warnings.length ? warnings : undefined,
            };
        }
        case "detonateOrdnance":
        case "strikeOrdnance":
        case "attackRunIntercept":
        case "fighterShipStrike":
        case "gunboatShipStrike": {
            if (meta.phase !== 10) {
                throw new Error(`${cmd.name}: phase 10 only`);
            }
            const c = cmd as { rolls?: number[] };
            if (!c.rolls?.length) throw new Error(`${cmd.name}: rolls required`);
            return {
                state: foldSnapshot(meta, position, fold),
                warnings: warnings.length ? warnings : undefined,
            };
        }
        case "resolvePhase10Complete": {
            if (meta.phase !== 10) throw new Error("resolvePhase10Complete: phase 10 only");
            return {
                state: foldSnapshot(meta, position, fold),
                warnings: warnings.length ? warnings : undefined,
            };
        }
        case "resolvePhase11HullDestruction": {
            return {
                state: foldSnapshot(meta, position, fold),
                warnings: warnings.length ? warnings : undefined,
            };
        }
        case "setShipCaptured": {
            const c = cmd as { ship?: string; capturedBy?: string; turn?: number };
            if (!c.ship || !c.capturedBy) throw new Error("setShipCaptured: incomplete");
            const ship = findShip(position, c.ship) as ShipObj & {
                boardingCapture?: { by: string; turn?: number; resolved?: boolean };
            };
            ship.boardingCapture = {
                by: c.capturedBy,
                turn: c.turn ?? meta.turn,
                resolved: false,
            };
            return { state: foldSnapshot(meta, position, fold) };
        }
        case "setShipOwner": {
            const c = cmd as { ship?: string; owner?: string };
            if (!c.ship || !c.owner) throw new Error("setShipOwner: incomplete");
            const player = position.players?.find((p) => p.id === c.owner);
            if (!player) throw new Error(`setShipOwner: unknown owner ${c.owner}`);
            const ship = findShip(position, c.ship) as ShipObj & {
                boardingCapture?: { by: string; turn?: number; resolved?: boolean };
            };
            ship.owner = c.owner;
            if (ship.boardingCapture) {
                ship.boardingCapture = { ...ship.boardingCapture, resolved: true };
            }
            return { state: foldSnapshot(meta, position, fold) };
        }
        case "resolveFurball": {
            const c = cmd as {
                engagement?: FurballEngagement;
                rolls?: number[];
            };
            if (!c.engagement) throw new Error("resolveFurball: missing engagement");
            if (!c.rolls?.length) throw new Error("resolveFurball: rolls required for replay");
            const resolution = resolveFurballFromRolls(position, c.engagement, c.rolls);
            applyFurballToPosition(position, c.engagement, resolution);
            const furballWarnings = validateFurballCommand(fold, cmd)
                .filter((i) => i.severity === "warning")
                .map((i) => i.message);
            if (furballWarnings.length) warnings.push(...furballWarnings);
            return {
                state: foldSnapshot(meta, position, fold),
                warnings: warnings.length ? warnings : undefined,
            };
        }
        case "interceptOrdnance": {
            const c = cmd as { id?: string; ordnanceId?: string; rolls?: number[] };
            if (!c.id || !c.ordnanceId) throw new Error("interceptOrdnance: incomplete");
            const interceptor = findObj(position, c.id);
            const ord = findObj(position, c.ordnanceId);
            if (ord.objType !== "ordnance") throw new Error("interceptOrdnance: not ordnance");
            if (!c.rolls?.length) throw new Error("interceptOrdnance: rolls required for replay");
            const source = arrayRollSource(c.rolls);
            if (interceptor.objType === "fighters") {
                const fighter = interceptor as FighterObj;
                const count = fighter.number ?? 6;
                const result = resolveFighterIntercept(count, ord.type, ord, source);
                const opos = ord.position;
                if (opos && typeof opos === "object" && "x" in opos) {
                    clearFighterAttachment(fighter);
                    fighter.position = { x: opos.x, y: opos.y };
                }
                const applied = applyInterceptToFighter(fighter, result.interceptorLosses);
                fighter.number = applied.number;
                fighter.endurance = applied.endurance;
                if (result.ordnanceDestroyed) {
                    position.objects = (position.objects ?? []).filter(
                        (o) => o.id !== c.ordnanceId
                    );
                } else {
                    applyInterceptToOrdnance(ord, ord.type, result);
                }
                if (applied.destroyed) {
                    clearFighterAttachment(fighter);
                    position.objects = (position.objects ?? []).filter((o) => o.id !== c.id);
                }
            } else if (interceptor.objType === "gunboats") {
                const gunboat = interceptor as GunboatObj;
                const count = gunboat.number ?? 6;
                const result = resolveFighterIntercept(count, ord.type, ord, source);
                const applied = applyInterceptToGunboat(gunboat, result.interceptorLosses);
                gunboat.number = applied.number;
                gunboat.endurance = applied.endurance;
                if (result.ordnanceDestroyed) {
                    position.objects = (position.objects ?? []).filter(
                        (o) => o.id !== c.ordnanceId
                    );
                } else {
                    applyInterceptToOrdnance(ord, ord.type, result);
                }
                if (applied.destroyed) {
                    clearGunboatAttachment(gunboat);
                    position.objects = (position.objects ?? []).filter((o) => o.id !== c.id);
                }
            } else {
                throw new Error("interceptOrdnance: not fighters or gunboats");
            }
            const interceptWarnings = (
                interceptor.objType === "gunboats"
                    ? validateGunboatInterceptOrdnance(
                          position,
                          c.id,
                          c.ordnanceId,
                          meta.phase
                      )
                    : validateInterceptOrdnance(position, c.id, c.ordnanceId, meta.phase)
            )
                .filter((i) => i.severity === "warning")
                .map((i) => i.message);
            if (interceptWarnings.length) warnings.push(...interceptWarnings);
            return {
                state: foldSnapshot(meta, position, fold),
                warnings: warnings.length ? warnings : undefined,
            };
        }
        case "declareLaunchOrdnance": {
            const pendingLaunches = queueDeclareLaunch(fold, cmd);
            return { state: foldSnapshot(meta, position, fold, { pendingLaunches }) };
        }
        case "resolveLaunchOrdnance": {
            const rc = cmd as { rolls?: [number, number] };
            let rollIdx = 0;
            const rollSource = policyRollSource(meta.dicePolicy, {
                seed: meta.diceSeed,
            });
            const resolved = applyResolveLaunchOrdnance(
                position,
                fold,
                (pos, c) => launchFromDeclare(pos, c, findShip, ensureObjects),
                {
                    rollsForRocket: () => {
                        if (rc.rolls && rollIdx < 2) {
                            const r = rc.rolls;
                            rollIdx = 2;
                            return r;
                        }
                        return [rollSource(), rollSource()] as [number, number];
                    },
                }
            );
            return {
                state: foldSnapshot(meta, resolved.position, fold, {
                    pendingLaunches: resolved.pending,
                }),
            };
        }
        case "bankEmpHits": {
            const c = cmd as {
                targetShip?: string;
                firerShip?: string;
                weapon?: string;
                hits?: number;
            };
            const bankedEmpHits = applyBankEmpHitsCommand(fold.bankedEmpHits, c);
            return {
                state: foldSnapshot(meta, position, fold, { bankedEmpHits }),
            };
        }
        case "queueTransporterDelivery": {
            const c = cmd as {
                firerShip?: string;
                targetShip?: string;
                weapon?: string;
                hits?: number;
            };
            if (!c.firerShip || !c.targetShip || !c.weapon) {
                throw new Error("queueTransporterDelivery: incomplete");
            }
            const pendingTransporterDeliveries = queueTransporterDelivery(
                fold.pendingTransporterDeliveries,
                c.firerShip,
                c.targetShip,
                c.weapon,
                Number(c.hits ?? 0)
            );
            return {
                state: foldSnapshot(meta, position, fold, { pendingTransporterDeliveries }),
            };
        }
        case "declareTransporterDelivery": {
            const c = cmd as {
                firerShip?: string;
                targetShip?: string;
                weapon?: string;
                attackerOwner?: string;
                choice?: TransporterDeliveryChoice;
                rolls?: number[];
            };
            if (!c.firerShip || !c.targetShip || !c.weapon || !c.choice) {
                throw new Error("declareTransporterDelivery: incomplete");
            }
            if (meta.phase !== 11) {
                throw new Error("declareTransporterDelivery: phase 11 only");
            }
            const deliveryIssues = validateDeclareTransporterDelivery(fold, cmd);
            const deliveryErrors = deliveryIssues.filter((i) => i.severity === "error");
            if (deliveryErrors.length) throw new Error(deliveryErrors[0].message);

            const slot = consumeTransporterDeliverySlot(
                fold.pendingTransporterDeliveries,
                c.firerShip,
                c.targetShip,
                c.weapon
            );
            if (!slot.hadSlot) {
                throw new Error("declareTransporterDelivery: no pending delivery slot");
            }
            const firer = findShip(position, c.firerShip);
            const owner = c.attackerOwner ?? firer.owner ?? "";
            const source = c.rolls?.length
                ? arrayRollSource(c.rolls)
                : policyRollSource(meta.dicePolicy, { seed: meta.diceSeed });
            const { logCommands } = applyTransporterDelivery(
                position,
                c.firerShip,
                c.targetShip,
                owner,
                c.choice,
                source,
                meta.turn
            );
            for (const lc of logCommands) {
                if (lc.name === "sysDisable" && lc.ship && lc.system) {
                    const ship = findShip(position, lc.ship);
                    const sys = ship.systems?.find((s) => s.id === lc.system);
                    if (sys) sys.state = (lc as { state?: string }).state as "destroyed";
                }
            }
            return {
                state: foldSnapshot(meta, position, fold, {
                    pendingTransporterDeliveries: slot.remaining,
                }),
                warnings: deliveryIssues
                    .filter((i) => i.severity === "warning")
                    .map((i) => i.message),
            };
        }
        case "declareEmpAllocation": {
            if (meta.phase !== 13) throw new Error("declareEmpAllocation: phase 13 only");
            return { state: foldSnapshot(meta, position, fold) };
        }
        case "resolveEmpAllocation": {
            const c = cmd as {
                targetShip?: string;
                allocations?: { systemId: string; hitCount: number }[];
                hullRowDrm?: number;
                rolls?: number[];
            };
            if (!c.targetShip || !c.allocations?.length || !c.rolls?.length) {
                throw new Error("resolveEmpAllocation: incomplete");
            }
            if (meta.phase !== 13) throw new Error("resolveEmpAllocation: phase 13 only");
            const banked = fold.bankedEmpHits?.[c.targetShip];
            if (!banked?.totalHits) {
                throw new Error(`resolveEmpAllocation: no banked EMP hits for ${c.targetShip}`);
            }
            const allocations = c.allocations;
            if (!allocations.length) {
                throw new Error(`resolveEmpAllocation: no allocations for ${c.targetShip}`);
            }
            const targetShip = findShip(position, c.targetShip);
            const hullRowDrm =
                c.hullRowDrm !== undefined
                    ? Number(c.hullRowDrm)
                    : empHullRowDrmForShip(targetShip);
            const labelMap = new Map(
                empValidTargets(targetShip).map((t) => [t.id, t.label])
            );
            const source = arrayRollSource(c.rolls);
            const { cmds } = resolveBankedEmp(
                c.targetShip,
                banked.totalHits,
                allocations,
                hullRowDrm,
                source,
                labelMap
            );
            let nextFold = fold;
            let nextMeta = meta;
            let nextPos = position;
            for (const sub of cmds) {
                const applied = applyCommand(
                    { meta: nextMeta, position: nextPos, ...nextFold },
                    sub,
                    options
                );
                nextMeta = applied.state.meta;
                nextPos = applied.state.position;
                nextFold = applied.state;
            }
            const bankedEmpHits = { ...(nextFold.bankedEmpHits ?? {}) };
            delete bankedEmpHits[c.targetShip];
            return {
                state: foldSnapshot(nextMeta, nextPos, nextFold, { bankedEmpHits }),
            };
        }
        case "spinalWeaponFired": {
            const c = cmd as { ship?: string; weapon?: string };
            if (!c.ship) throw new Error("spinalWeaponFired: missing ship");
            const ship = findShip(position, c.ship);
            (
                ship as ShipObj & {
                    movementFlags?: { spinalManeuverLocked?: boolean; spinalLastFiredTurn?: number };
                }
            ).movementFlags = {
                ...(ship as ShipObj & { movementFlags?: Record<string, unknown> }).movementFlags,
                spinalManeuverLocked: true,
                spinalLastFiredTurn: meta.turn,
            };
            return { state: foldSnapshot(meta, position, fold) };
        }
        case "declareShipFire": {
            const shipId = (cmd as { ship?: string }).ship;
            if (shipId) {
                const declareWarnings = validateDeclareShipFireCommand(fold, cmd)
                    .filter((i) => i.severity === "warning")
                    .map((i) => i.message);
                if (declareWarnings.length) warnings.push(...declareWarnings);
            }
            const pendingFireDeclarations = queueDeclareFire(fold, cmd);
            return {
                state: foldSnapshot(meta, position, fold, { pendingFireDeclarations }),
                warnings: warnings.length ? warnings : undefined,
            };
        }
        case "resolveShipFire": {
            const shipId =
                (cmd as { ship?: string }).ship ?? currentActivationId(meta);
            const pending = fold.pendingFireDeclarations ?? [];
            let weaponUsedThisTurn = { ...(fold.weaponUsedThisTurn ?? {}) };
            for (const weaponId of weaponsFromFireDeclarations(pending, shipId)) {
                weaponUsedThisTurn = markWeaponUsed(
                    { ...fold, weaponUsedThisTurn },
                    weaponId,
                    "shipFire"
                );
            }
            const remaining = pending.filter(
                (c) =>
                    c.name !== "declareShipFire" ||
                    (c as { ship?: string }).ship !== shipId
            );
            return {
                state: foldSnapshot(meta, position, fold, {
                    pendingFireDeclarations: remaining,
                    weaponUsedThisTurn,
                }),
            };
        }
        case "setBoarders": {
            const c = cmd as {
                ship?: string;
                owner?: string;
                dcp?: number;
                marines?: number;
                boardedTurn?: number;
                fromShip?: string;
                deployMarineIds?: string[];
                deployDcpIds?: string[];
                deployBuiltinDcp?: number;
            };
            const ship = findShip(position, c.ship!) as ShipWithBoarders;
            const prev = boarderUnitsOnShip(ship, c.owner!);
            const prevCounts = {
                dcp: prev.filter((u) => u.type === "dcp").length,
                marines: prev.filter((u) => u.type === "marine").length,
            };
            setBoarderUnitsForOwner(ship, c.owner!, {
                dcp: c.dcp ?? 0,
                marines: c.marines ?? 0,
                boardedTurn: c.boardedTurn ?? meta.turn,
                fromShip: c.fromShip,
            });
            const deploy: BoarderCommandDeploy = {
                fromShip: c.fromShip ?? prev[0]?.fromShip,
                deployMarineIds: c.deployMarineIds,
                deployDcpIds: c.deployDcpIds,
                deployBuiltinDcp: c.deployBuiltinDcp,
            };
            applyBoarderDeploymentEffects(position, ship, c.owner!, deploy, {
                marines: (c.marines ?? 0) - prevCounts.marines,
                dcp: (c.dcp ?? 0) - prevCounts.dcp,
                builtinDcp: c.deployBuiltinDcp,
            });
            return { state: foldSnapshot(meta, position, fold) };
        }
        case "adjustBoarders": {
            const c = cmd as {
                ship?: string;
                owner?: string;
                dcp?: number;
                marines?: number;
                boardedTurn?: number;
                fromShip?: string;
                deployMarineIds?: string[];
                deployDcpIds?: string[];
                deployBuiltinDcp?: number;
            };
            const ship = findShip(position, c.ship!) as ShipWithBoarders;
            const prevUnits = boarderUnitsOnShip(ship, c.owner!);
            const marineIds = c.deployMarineIds ?? [];
            const dcpIds = c.deployDcpIds ?? [];
            const dcpDelta = Math.floor(c.dcp ?? 0);
            const marineDelta = Math.floor(c.marines ?? 0);
            const boardedTurnDefault = c.boardedTurn ?? meta.turn;
            const addedSpecs: import("./boardingState").NewBoarderUnit[] = [];
            if (marineDelta > 0) {
                for (let i = 0; i < marineDelta; i++) {
                    addedSpecs.push({
                        type: "marine",
                        fromShip: c.fromShip,
                        boardedTurn: boardedTurnDefault,
                        sourceMarineId: marineIds[i],
                    });
                }
            }
            if (dcpDelta > 0) {
                const builtinCount = Math.max(0, c.deployBuiltinDcp ?? 0);
                for (let i = 0; i < dcpDelta; i++) {
                    const hiredId = dcpIds[i];
                    const useBuiltin = !hiredId && i >= dcpIds.length && builtinCount > 0;
                    addedSpecs.push({
                        type: "dcp",
                        fromShip: c.fromShip,
                        boardedTurn: boardedTurnDefault,
                        sourceDcpId: hiredId,
                        sourceBuiltinDcp: useBuiltin || undefined,
                    });
                }
            }
            const { added, removed } = adjustBoarderUnits(
                ship,
                c.owner!,
                {
                    dcp: addedSpecs.length ? Math.min(0, dcpDelta) : dcpDelta,
                    marines: addedSpecs.length ? Math.min(0, marineDelta) : marineDelta,
                    boardedTurn: c.boardedTurn,
                    fromShip: c.fromShip,
                },
                addedSpecs.length ? addedSpecs : undefined
            );
            const deploy: BoarderCommandDeploy = {
                fromShip: c.fromShip ?? prevUnits[0]?.fromShip ?? added[0]?.fromShip,
                deployMarineIds: c.deployMarineIds,
                deployDcpIds: c.deployDcpIds,
                deployBuiltinDcp: c.deployBuiltinDcp,
                removedUnits: removed,
            };
            applyBoarderDeploymentEffects(position, ship, c.owner!, deploy, {
                marines: marineDelta,
                dcp: dcpDelta,
                builtinDcp: c.deployBuiltinDcp,
            });
            return { state: foldSnapshot(meta, position, fold) };
        }
        case "removeBoarders": {
            const c = cmd as { ship?: string; unitIds?: string[] };
            const ship = findShip(position, c.ship!) as ShipWithBoarders;
            const removed = removeBoarderUnits(ship, c.unitIds ?? []);
            const byOwner = new Map<string, typeof removed>();
            for (const u of removed) {
                if (!byOwner.has(u.owner)) byOwner.set(u.owner, []);
                byOwner.get(u.owner)!.push(u);
            }
            for (const [owner, units] of byOwner) {
                const marineLoss = units.filter((u) => u.type === "marine").length;
                const dcpLoss = units.filter((u) => u.type === "dcp").length;
                const builtinLoss = units.filter((u) => u.type === "dcp" && u.sourceBuiltinDcp).length;
                applyBoarderDeploymentEffects(
                    position,
                    ship,
                    owner,
                    { fromShip: units[0]?.fromShip, removedUnits: units },
                    { marines: -marineLoss, dcp: -dcpLoss, builtinDcp: builtinLoss > 0 ? -builtinLoss : undefined }
                );
            }
            return { state: foldSnapshot(meta, position, fold) };
        }
        case "declareBoardingAttackerOrders":
        case "declareBoardingDefenderOrders": {
            const pendingBoardingOrders = queueDeclareBoarding(fold, cmd);
            return {
                state: foldSnapshot(meta, position, fold, { pendingBoardingOrders }),
                warnings: warnings.length ? warnings : undefined,
            };
        }
        case "resolveBoardingCombat": {
            const shipId =
                (cmd as { ship?: string }).ship ?? currentActivationId(meta);
            const remaining = (fold.pendingBoardingOrders ?? []).filter(
                (c) =>
                    !isBoardingDeclareCommand(c) ||
                    (c as { ship?: string }).ship !== shipId
            );
            return {
                state: foldSnapshot(meta, position, fold, {
                    pendingBoardingOrders: remaining,
                }),
            };
        }
        case "declareRepairOrders": {
            const shipId = (cmd as { ship?: string }).ship;
            if (shipId) {
                const declareWarnings = validateDeclareRepairOrdersCommand(fold, position, cmd)
                    .filter((i) => i.severity === "warning")
                    .map((i) => i.message);
                if (declareWarnings.length) warnings.push(...declareWarnings);
            }
            const pendingRepairOrders = queueDeclareRepair(fold, cmd);
            return {
                state: foldSnapshot(meta, position, fold, { pendingRepairOrders }),
                warnings: warnings.length ? warnings : undefined,
            };
        }
        case "resolveRepairOrders": {
            const shipId = (cmd as { ship?: string }).ship;
            const remaining = (fold.pendingRepairOrders ?? []).filter(
                (c) =>
                    c.name !== "declareRepairOrders" ||
                    (c as { ship?: string }).ship !== shipId
            );
            return {
                state: foldSnapshot(meta, position, fold, {
                    pendingRepairOrders: remaining,
                }),
            };
        }
        case "adjustRegenArmour": {
            const ship = findShip(position, (cmd as { ship: string }).ship);
            if (!ship.dmgArmour) ship.dmgArmour = [];
            const row = (cmd as { row: number }).row;
            while (ship.dmgArmour.length <= row) {
                ship.dmgArmour.push({ standard: 0, regenerative: 0, regenerativeLost: 0 });
            }
            if (!ship.dmgArmour[row]) {
                ship.dmgArmour[row] = { standard: 0, regenerative: 0, regenerativeLost: 0 };
            }
            const patch = cmd as { regenerative?: number; regenerativeLost?: number };
            if (patch.regenerative !== undefined) {
                ship.dmgArmour[row].regenerative = Math.max(
                    0,
                    (ship.dmgArmour[row].regenerative ?? 0) + patch.regenerative
                );
            }
            if (patch.regenerativeLost !== undefined) {
                ship.dmgArmour[row].regenerativeLost = Math.max(
                    0,
                    (ship.dmgArmour[row].regenerativeLost ?? 0) + patch.regenerativeLost
                );
            }
            return { state: foldSnapshot(meta, position, fold) };
        }
        case "resolveThresholdCheck": {
            const ship = findShip(position, (cmd as { ship: string }).ship);
            const idx = (cmd as { thresholdIndex?: number }).thresholdIndex;
            if (idx !== undefined) {
                (ship as { thresholdRowsResolved?: number }).thresholdRowsResolved = idx;
            }
            clearPendingThreshold(ship);
            return { state: foldSnapshot(meta, position, fold) };
        }
        case "resolveReactorBreaches":
            return { state: foldSnapshot(meta, position, fold) };
        case "_custom":
        case "logDice":
            return { state: foldSnapshot(meta, position, fold) };
        case "advancePhase": {
            const phase = coerceGamePhase((cmd as { phase?: number }).phase ?? 1);
            const prevPhase = coerceGamePhase(fold.meta.phase);
            if (prevPhase === 11 && phase !== 11) {
                assertNoPendingTransporterDeliveries(fold.pendingTransporterDeliveries);
            }
            if (prevPhase === 13 && phase !== 13) {
                if (hasBankedEmp(fold.bankedEmpHits)) {
                    throw new Error(
                        "Resolve all banked EMP hits before leaving phase 13."
                    );
                }
                if (shipsHavePendingThresholds(position)) {
                    throw new Error(
                        "Resolve all hull threshold checks before leaving phase 13."
                    );
                }
            }
            let foldOverrides: Partial<FoldState> = {};
            let resolvedMoves = fold.phase5ResolvedMoves;

            if (
                prevPhase === SHIP_MOVEMENT_RESOLVE_PHASE &&
                phase > SHIP_MOVEMENT_RESOLVE_PHASE
            ) {
                if (!fold.phase5MovementResolved && !fold.phase5ResolvedMoves?.length) {
                    const result = resolvePhase5MovementSequence(
                        position,
                        fold.meta,
                        fold.pendingMoves,
                        fold.pendingLayMines
                    );
                    position = result.position;
                    resolvedMoves = result.moves;
                    if (result.warnings.length) warnings.push(...result.warnings);
                    warnings.push("Phase 5 movement was applied on advance.");
                    foldOverrides = {
                        pendingMoves: [],
                        pendingLayMines: [],
                        phase5ResolvedMoves: result.moves,
                        phase5MovementResolved: true,
                    };
                }

                const movesForMineCheck = fold.phase5ResolvedMoves?.length
                    ? fold.phase5ResolvedMoves
                    : (resolvedMoves ?? []);
                if (movesForMineCheck.length > 0) {
                    const dice = minePhaseDiceCount(movesForMineCheck, position, fold.meta);
                    if (dice.total > 0) {
                        throw new Error(
                            `Resolve mine sweep/detonation (${dice.sweeps} sweep, ${dice.detonations} detonation dice) before leaving phase 5.`
                        );
                    }
                }

                foldOverrides = {
                    ...foldOverrides,
                    phase5ResolvedMoves: undefined,
                    phase5MovementResolved: undefined,
                };
            }

            const wrapping = phase === 1 && prevPhase === 15;
            meta.phase = phase;
            if (cmd.turn !== undefined) {
                meta.turn = cmd.turn;
            } else if (wrapping) {
                meta.turn = fold.meta.turn + 1;
            }
            if (
                phase === SHIP_MOVEMENT_RESOLVE_PHASE &&
                prevPhase !== SHIP_MOVEMENT_RESOLVE_PHASE
            ) {
                // New ship-movement phase — drop any stale paths from a prior turn.
                foldOverrides = {
                    ...foldOverrides,
                    phase5ResolvedMoves: undefined,
                    phase5MovementResolved: undefined,
                };
            }
            if (wrapping) {
                for (const obj of position.objects ?? []) {
                    if (obj.objType !== "ship") continue;
                    const ship = obj as ShipObj;
                    if (ship.coreState) {
                        ship.coreState = tickCoreState(
                            ship.coreState as CoreState
                        ) as ShipObj["coreState"];
                    }
                    delete (ship as ShipObj & { movementFlags?: unknown }).movementFlags;
                    delete (ship as ShipObj & { empHullRowDrm?: number }).empHullRowDrm;
                }
                foldOverrides = {
                    ...foldOverrides,
                    phase5ResolvedMoves: undefined,
                    phase5MovementResolved: undefined,
                    weaponUsedThisTurn: {},
                };
            }
            if (prevPhase === 8 && phase !== 8) {
                foldOverrides = {
                    ...foldOverrides,
                    phase8FurballDeclarations: [],
                };
            }
            if (prevPhase === 9 && phase !== 9) {
                for (const obj of position.objects ?? []) {
                    if (obj.objType !== "fighters") continue;
                    delete (obj as { attackAllocation?: FighterAttackAllocation }).attackAllocation;
                }
                foldOverrides = {
                    ...foldOverrides,
                    phase9PdDeclarations: [],
                };
            }
            if (prevPhase === 7 && phase !== 7) {
                const pending = fold.pendingOrdnanceAllocations ?? [];
                if (pending.length > 0) {
                    applyOrdnanceAllocationsToPosition(position, pending);
                    foldOverrides = {
                        ...foldOverrides,
                        pendingOrdnanceAllocations: [],
                    };
                }
            }
            meta = applySegmentPhaseEntry(meta, position, prevPhase);
            const cleared = clearPendingForSegment(fold);
            const nextState = foldSnapshot(meta, position, fold, {
                ...cleared,
                ...foldOverrides,
            });
            return {
                state: nextState,
                warnings: warnings.length ? warnings : undefined,
            };
        }
        case "setInitiative": {
            meta.initiative = {
                rolls: cmd.rolls!,
                winner: cmd.winner!,
            };
            return { state: foldSnapshot(meta, position, fold) };
        }
        case "setMeta": {
            if (cmd.dicePolicy) meta.dicePolicy = cmd.dicePolicy;
            if ((cmd as { diceSeed?: string }).diceSeed !== undefined) {
                meta.diceSeed = (cmd as { diceSeed?: string }).diceSeed;
            }
            if (cmd.fleetLimits) meta.fleetLimits = cmd.fleetLimits;
            if ((cmd as { allowVectorMovement?: boolean }).allowVectorMovement !== undefined) {
                meta.allowVectorMovement = (cmd as { allowVectorMovement: boolean })
                    .allowVectorMovement;
            }
            if (
                (cmd as { includeCoreSystemsInThreshold?: boolean })
                    .includeCoreSystemsInThreshold !== undefined
            ) {
                meta.includeCoreSystemsInThreshold = (
                    cmd as { includeCoreSystemsInThreshold: boolean }
                ).includeCoreSystemsInThreshold;
            }
            return { state: foldSnapshot(meta, position, fold) };
        }
        case "setCoreState": {
            const ship = findShip(position, (cmd as { ship: string }).ship);
            const patch: CoreState = {};
            const c = cmd as {
                powerless?: boolean;
                lifeless?: number;
                uncontrolled?: number;
                dumped?: boolean;
                abandonedSinceTurn?: number;
            };
            if (c.powerless !== undefined) patch.powerless = c.powerless;
            if (c.lifeless !== undefined) patch.lifeless = c.lifeless;
            if (c.uncontrolled !== undefined) patch.uncontrolled = c.uncontrolled;
            if (c.dumped !== undefined) patch.dumped = c.dumped;
            if (c.abandonedSinceTurn !== undefined) {
                patch.abandonedSinceTurn = c.abandonedSinceTurn;
            }
            const prev = (ship as ShipObj).coreState as CoreState | undefined;
            (ship as ShipObj).coreState = mergeCoreState(prev, patch) as ShipObj["coreState"];
            return { state: foldSnapshot(meta, position, fold) };
        }
        default:
            throw new Error(
                `I don't know how to process the command named "${(cmd as { name: string }).name}".`
            );
    }
};

/** Fold commands onto initial meta+position. */
export function foldCommands(
    meta: GameMeta,
    initialState: FullThrustGamePosition,
    commands: FullThrustGameCommand[],
    headOffset = 0
): {
    state: FoldState;
    warnings: CommandAudit[];
    error?: CommandAudit;
} {
    resetBoarderIdCounter();
    let offset = Math.round(Math.abs(headOffset));
    if (offset > commands.length) offset = commands.length;

    let state: FoldState = {
        meta: metaForCommandReplay(meta),
        position: deepclone(initialState) as FullThrustGamePosition,
    };

    const warnings: CommandAudit[] = [];
    for (let i = 0; i < commands.length - offset; i++) {
        try {
            const preIssues = validateCommand(state, commands[i], commands.slice(0, i));
            warnings.push(...issuesToAudits(i, commands[i].name, preIssues));
            const result = applyCommand(state, commands[i], {
                replayCommands: commands.slice(0, i),
            });
            state = result.state;
            if (result.warnings?.length) {
                warnings.push({
                    location: i,
                    command: commands[i].name,
                    description: result.warnings.join("\n"),
                    severity: "error",
                });
            }
        } catch (e) {
            return {
                state,
                warnings,
                error: {
                    location: i,
                    command: commands[i].name,
                    description: e instanceof Error ? e.message : String(e),
                    severity: "error",
                },
            };
        }
    }
    return { state, warnings };
}

export function advanceSegmentCommand(): FullThrustGameCommand {
    return { name: "advanceSegment" } as FullThrustGameCommand;
}

export function advancePhaseCommand(meta: GameMeta): FullThrustGameCommand {
    const n = nextPhase(meta);
    return {
        name: "advancePhase",
        phase: n.phase,
        turn: n.turn,
    } as FullThrustGameCommand;
}

const placeShip = (
    state: FullThrustGamePosition,
    cmd: FullThrustGameCommand,
    meta: GameMeta
): [FullThrustGamePosition, string[] | undefined] => {
    const newstate = deepclone(state) as FullThrustGamePosition;

    if (cmd.name !== "placeShip") {
        throw new Error("This function only handles 'placeShip' commands.");
    }

    if (cmd.id === undefined || cmd.id.length === 0) {
        throw new Error(`placeShip: Missing ID`);
    }
    assertValidHtmlUid(cmd.id, "placeShip");
    assertGameUidAvailable(state, cmd.id, "placeShip");

    if (cmd.object === undefined) {
        throw new Error(`placeShip: Missing ship object`);
    }
    try {
        const shipCheck = validateShipJson(JSON.stringify(cmd.object));
        if (!shipCheck.wellFormed) {
            throw new Error(
                `placeShip: ${shipCheck.blockingMessages[0] ?? "Malformed ship JSON"}`
            );
        }
    } catch (e) {
        if (e instanceof Error && e.message.startsWith("placeShip:")) throw e;
        throw new Error(`placeShip: Could not validate ship object`);
    }

    if (cmd.svg === undefined || cmd.svg.length < 30) {
        throw new Error(`placeShip: Missing ship SVG`);
    }
    const result = XMLValidator.validate(cmd.svg, {
        allowBooleanAttributes: true,
    });
    if (typeof result === "boolean" && result === true) {
        const interim = cmd.svg.trim();
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "@_",
            allowBooleanAttributes: true,
            preserveOrder: true,
            ignoreDeclaration: true,
            removeNSPrefix: true,
        });
        const output = parser.parse(interim);
        if (output.length > 1) {
            throw new Error("placeShip: The custom counter has multiple root nodes");
        }
        const root = output[0];
        const rootName = [...Object.keys(root)][0] as string;
        if (rootName !== "symbol") {
            throw new Error("placeShip: Must be a <symbol> tag");
        }
        const rootAttrs = root[":@"];
        if (rootAttrs === undefined || !rootAttrs.hasOwnProperty("@_viewBox")) {
            throw new Error("placeShip: No `viewBox` attribute found");
        }
        if (rootAttrs.hasOwnProperty("@_id")) {
            throw new Error("placeShip: Counter SVG must not have an ID attribute");
        }
    } else {
        throw new Error(`placeShip: Could not validate SVG`);
    }

    if (state.players === undefined || state.players.length === 0) {
        throw new Error(`placeShip: No players found`);
    }
    if (cmd.owner === undefined || cmd.owner.length === 0) {
        throw new Error(`placeShip: No owner specified`);
    }
    const owner = state.players.find((p) => p.id === cmd.owner);
    if (owner === undefined) {
        throw new Error(`placeShip: The given owner doesn't appear to be playing`);
    }

    if (cmd.position === undefined || cmd.position === null) {
        throw new Error(`placeShip: No position given`);
    }
    if (typeof cmd.position.x !== "number" || typeof cmd.position.y !== "number") {
        throw new Error(`placeShip: Position must be numeric`);
    }

    if (cmd.facing === undefined) {
        throw new Error(`placeShip: No facing given`);
    }
    if (cmd.facing < 1 || cmd.facing > 12) {
        throw new Error(`placeShip: Invalid facing given`);
    }

    if (cmd.speed === undefined || typeof cmd.speed !== "number" || cmd.speed < 0) {
        throw new Error(`placeShip: Invalid speed given`);
    }

    if (cmd.course !== undefined) {
        if (typeof cmd.course !== "number" || cmd.course < 0 || cmd.course > 360) {
            throw new Error(`placeShip: Invalid course given`);
        }
    }

    const movementMode =
        (cmd as { movementMode?: "cinematic" | "vector" }).movementMode ??
        (cmd.course !== undefined ? "vector" : "cinematic");

    if (movementMode === "vector") {
        if (!meta.allowVectorMovement) {
            throw new Error("placeShip: Vector movement is not allowed in this game");
        }
        if (cmd.course === undefined) {
            throw new Error("placeShip: Vector ships require a starting course");
        }
    } else if (cmd.course !== undefined) {
        throw new Error("placeShip: Cinematic ships cannot have a course");
    }

    if (newstate.objects === undefined) {
        newstate.objects = [];
    }
    const ssd = cmd.object as FullThrustShip;
    const hangars = initialHangarStateFromDesign(ssd);
    const gunboatRacks = initialGunboatRackStateFromDesign(ssd);
    const deployedSquadrons =
        (cmd as { deployedSquadrons?: Array<{
            objType: "fighters" | "gunboats";
            id: string;
            position: { x: number; y: number };
            endurance?: number;
            facing?: number;
            callsign?: string;
        }> }).deployedSquadrons ?? [];
    if (!cmd.position || typeof cmd.position !== "object" || !("x" in cmd.position)) {
        throw new Error("placeShip: missing ship position");
    }
    const shipEntry: ShipObj = {
        objType: "ship",
        id: cmd.id,
        owner: cmd.owner,
        object: cmd.object,
        svg: cmd.svg,
        position: { x: cmd.position.x, y: cmd.position.y },
        facing: cmd.facing,
        speed: cmd.speed,
        movementMode,
        ...(movementMode === "vector" ? { course: cmd.course } : {}),
        hangars,
        gunboatRacks,
        boatBays: {},
    } as ShipObj;
    newstate.objects.push(shipEntry);

    for (const wing of ssd.fighters ?? []) {
        const norm = normalizeFighterFromDesign(wing);
        const wingType = norm.type;
        const wingNumber = norm.number;
        const wingSkill = norm.skill;
        const wingEnduranceMax = norm.enduranceMax;

        if (!wing.hangar) {
            continue;
        }

        const wingId = wingIdForHangar(cmd.id, wing.hangar);
        const fighterFields = {
            type: wingType,
            mods: norm.mods,
            number: wingNumber,
            endurance: norm.endurance,
            enduranceMax: wingEnduranceMax,
            skill: wingSkill,
        };
        hangars[wing.hangar] = {
            type: wingType,
            number: wingNumber,
            skill: wingSkill,
            mods: norm.mods,
            enduranceMax: wingEnduranceMax,
        };

        const dep = deployedSquadrons.find(
            (d) => d.objType === "fighters" && d.id === wingId
        );
        if (dep) {
            delete hangars[wing.hangar];
            const sym = buildFighterSymbol(dep.id, {
                type: wingType,
                number: wingNumber,
                skill: wingSkill,
            });
            const depCallsign = normalizeCallsign(dep.callsign);
            newstate.objects.push({
                objType: "fighters",
                id: dep.id,
                owner: cmd.owner,
                ...fighterFields,
                position: dep.position,
                facing: (dep.facing ?? cmd.facing) as FighterObj["facing"],
                endurance: dep.endurance ?? Math.min(5, wingEnduranceMax),
                svg: sym.svg,
                ...(depCallsign ? { callsign: depCallsign } : {}),
            } as FighterObj);
            continue;
        }

        const sym = buildFighterSymbol(wingId, {
            type: wingType,
            number: wingNumber,
            skill: wingSkill,
        });
        newstate.objects.push({
            objType: "fighters",
            id: wingId,
            owner: cmd.owner,
            ...fighterFields,
            position: { ship: cmd.id, hangar: wing.hangar },
            svg: sym.svg,
        } as FighterObj);
    }

    for (const gb of placeGunboatSquadronsForShip(
        cmd.id,
        cmd.owner!,
        ssd,
        cmd.facing,
        deployedSquadrons
    )) {
        newstate.objects.push(gb);
    }

    return [newstate, undefined];
};

/** Legacy signature: mutate position only (meta optional). */
export const applyCommandToPosition = (
    state: FullThrustGamePosition,
    cmd: FullThrustGameCommand,
    meta?: GameMeta
): { state: FullThrustGamePosition; warnings?: string[]; meta: GameMeta } => {
    const result = applyCommand(
        { meta: meta ?? DEFAULT_META(), position: state },
        cmd
    );
    return {
        state: result.state.position,
        warnings: result.warnings,
        meta: result.state.meta,
    };
};
