import type { FullThrustGameCommand } from "@/schemas/commands";
import type { FullThrustGamePosition } from "@/schemas/position";
import { applyCommand, type FoldState } from "./applyCommand";
import {
    activationOrder,
    isAlternatingActivationPhase,
    isSegmentActivationPhase,
    LOSER_FIRST_PHASES,
    commandsForPhase,
    coerceGamePhase,
    phaseName,
    WINNER_FIRST_PHASES,
    currentActivationId,
    activationsComplete,
    segmentDisplayLabel,
    type CommandKind,
} from "./phase";
import { fireDeclarationModeratorHints, repairDeclarationModeratorHints } from "./commandValidation";
import { BOARDING_STEP_LABELS } from "./boardingOrders";
import { fighterLaunchModeratorHints } from "./fighterLaunchDeclare";
import {
    countFighterOrdersByPlayer,
    expectedFighterOrderPlayer,
    fighterGroupsOrderedThisPhase,
    fighterOrderModeratorHints,
    formatUndeclaredFightersByPlayer,
} from "./fighterMove";
import {
    fighterAttackModeratorHints,
    ordnanceAllocationModeratorHints,
} from "./fighterAttack";
import { gunboatAttackModeratorHints } from "./gunboatAttack";
import { fighterAttackAllocations } from "./fighterEngagement";
import { fighterGroupLabel } from "./fighterLabel";
import { screeningModeratorHints } from "./fighterScreening";
import { uncoveredFurballGroups, effectivePhase8FurballDeclarations, phase8FurballsResolvedInLog } from "./fighterPhase8";
import {
    effectivePhase9PdDeclarations,
    phase9PointDefenseResolvedInLog,
} from "./pointDefensePhase9";
import { incomingThreatsForPhase9 } from "./incomingThreats";
import {
    phase10StrikeQueue,
    phase10StrikesCompleteInLog,
} from "./phase10Strikes";
import {
    mineLaysComplete,
    shipsNeedingMinePlacements,
    minePhaseDiceCount,
} from "./mineMovement";
import {
    orderedShipsWithPendingFire,
    orderedShipsWithPendingBoarding,
    orderedShipsWithPendingRepair,
    phase11UndeclaredShips,
    phase12UndeclaredShips,
    phase12UndeclaredAttackerShips,
    phase12UndeclaredDefenderShips,
    phase14UndeclaredRepairShips,
    phase14DuplicateRepairShips,
    shipsCompletedActivation,
    shipsWithPendingFireOrders,
} from "./segmentApply";
import { pendingTransporterSummary } from "./weaponFireState";
import { contestedShipsForPhase12 } from "./boardingState";
import { dcpAvailabilityForShip } from "./crewDeployment";
import {
    coreSystemsEnabled,
    reactorDiceCount,
    shipsNeedingReactorRoll,
} from "./coreSystems";
import {
    shipsNeedingRepairOrders,
    repairHintForShip,
    type ShipWithRepairState,
} from "./repairSystems";
import {
    operationalHangars,
    isSystemDestroyed,
    listShipSystems,
    shipBoardingCrewCapacity,
    type ShipGameState,
} from "./shipSystems";
import { listLaunchableSystems } from "./ordnanceLaunch";
import { launchableWings } from "@/lib/hangars";
import type { GameMeta, GamePhase, InitiativeState } from "./types";
import { metaForCommandReplay } from "./types";
import { thresholdDiceCount } from "./thresholdSystems";
import {
    empContributorsNeedingAllocation,
    empFailThreshold,
    hasBankedEmp,
    type BankedEmpState,
} from "./empFire";
import { phase7HasAllocationContent } from "./ordnanceAllocation";

const META_COMMANDS = new Set<CommandKind>([
    "advancePhase",
    "advanceSegment",
    "setInitiative",
    "logDice",
    "setMeta",
    "_custom",
    "awardVP",
]);

export { isAlternatingActivationPhase } from "./phase";

export function activationOrderDescription(phase: GamePhase): string {
    if (LOSER_FIRST_PHASES.includes(phase)) {
        return "initiative loser first";
    }
    if (WINNER_FIRST_PHASES.includes(phase)) {
        return "player sequence (winner first)";
    }
    return "simultaneous";
}

export function commandsInCurrentPhaseSegment(
    commands: FullThrustGameCommand[],
    target: { turn: number; phase: GamePhase },
    startMeta: GameMeta,
    initialPosition: FullThrustGamePosition
): FullThrustGameCommand[] {
    let fold: FoldState = {
        meta: metaForCommandReplay(startMeta),
        position: structuredClone(initialPosition),
    };
    let segmentStart = 0;
    if (fold.meta.turn === target.turn && fold.meta.phase === target.phase) {
        segmentStart = 0;
    }

    for (let i = 0; i < commands.length; i++) {
        const prev = { turn: fold.meta.turn, phase: fold.meta.phase };
        try {
            fold = applyCommand(fold, commands[i], {
                replayCommands: commands.slice(0, i),
            }).state;
        } catch {
            break;
        }
        const now = { turn: fold.meta.turn, phase: fold.meta.phase };
        if (
            now.turn === target.turn &&
            now.phase === target.phase &&
            (prev.turn !== target.turn || prev.phase !== target.phase)
        ) {
            segmentStart = i + 1;
        }
    }

    if (fold.meta.turn !== target.turn || fold.meta.phase !== target.phase) {
        return [];
    }
    return commands.slice(segmentStart);
}

function isPhasePlayerCommand(name: string, phase: GamePhase): boolean {
    if (META_COMMANDS.has(name as CommandKind)) return false;
    return commandsForPhase(phase).includes(name as CommandKind);
}

function findShip(position: FullThrustGamePosition, id: string | undefined) {
    if (!id) return undefined;
    return position.objects?.find((o) => o.objType === "ship" && o.id === id);
}

function findFighters(position: FullThrustGamePosition, id: string | undefined) {
    if (!id) return undefined;
    return position.objects?.find((o) => o.objType === "fighters" && o.id === id);
}

function fighterGroupDisplayLabel(
    position: FullThrustGamePosition,
    id: string
): string {
    const fighter = findFighters(position, id);
    return fighter ? fighterGroupLabel(fighter as { id: string; callsign?: string }) : id;
}

function formatFighterGroupIds(
    position: FullThrustGamePosition,
    ids: string[]
): string {
    return ids.map((id) => fighterGroupDisplayLabel(position, id)).join(", ");
}

function findOrdnance(position: FullThrustGamePosition, id: string | undefined) {
    if (!id) return undefined;
    return position.objects?.find((o) => o.objType === "ordnance" && o.id === id);
}

function asString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

/** Best-effort owner for a command in the current position snapshot. */
export function commandActingPlayer(
    cmd: FullThrustGameCommand,
    position: FullThrustGamePosition
): string | undefined {
    const c = cmd as Record<string, unknown>;
    const name = cmd.name;

    if (name === "placeShip" || name === "moveShip") {
        return asString(findShip(position, asString(c.id))?.owner);
    }
    if (name === "declareLaunchOrdnance" || name === "resolveLaunchOrdnance") {
        return asString(findShip(position, asString(c.ship))?.owner);
    }
    if (name === "declareShipFire" || name === "resolveShipFire") {
        return asString(findShip(position, asString(c.ship))?.owner);
    }
    if (name === "moveFighters" || name === "pursueFighters" || name === "adjustFighters") {
        return asString(findFighters(position, asString(c.id))?.owner);
    }
    if (
        name === "moveGunboats" ||
        name === "pursueGunboats" ||
        name === "adjustGunboats" ||
        name === "screenGunboats" ||
        name === "declareGunboatAttack"
    ) {
        const gb = position.objects?.find(
            (o) => o.objType === "gunboats" && o.id === asString(c.id)
        );
        return asString(gb?.owner);
    }
    if (name === "screenFighters") {
        return asString(findFighters(position, asString(c.id))?.owner);
    }
    if ("ship" in c) {
        return asString(findShip(position, asString(c.ship))?.owner);
    }
    if (name === "declareFighterAttack") {
        return asString(findFighters(position, asString(c.id))?.owner);
    }
    if (name === "resolveFurball") {
        const eng = c.engagement as { attackers?: { id: string }[] } | undefined;
        const first = eng?.attackers?.[0]?.id;
        if (first) return asString(findFighters(position, first)?.owner);
    }
    if (name === "interceptOrdnance") {
        return asString(findFighters(position, asString(c.id))?.owner);
    }
    if (name === "allocateOrdnanceTarget" || name === "clearOrdnanceAllocation") {
        return asString(findOrdnance(position, asString(c.ordnanceId))?.owner);
    }
    if (name === "moveOrdnance") {
        return asString(findOrdnance(position, asString(c.id))?.owner);
    }
    if ("owner" in c) {
        return asString(c.owner);
    }
    return undefined;
}

function shipHasLaunchableOrdnance(ship: ShipGameState): boolean {
    return listLaunchableSystems(ship).length > 0;
}

function phase3LaunchLabel(
    position: FullThrustGamePosition,
    shipId: string
): string {
    const ship = findShip(position, shipId) as ShipGameState | undefined;
    if (!ship) return shipId;
    const parts: string[] = [];
    if (shipHasLaunchableOrdnance(ship)) parts.push("ordnance");
    const wings = launchableWings(ship, position).length;
    if (wings > 0) parts.push(`fighters (${wings})`);
    return parts.length ? `${shipId} (${parts.join(", ")})` : shipId;
}

function formatPhase3LaunchSummary(
    position: FullThrustGamePosition,
    playerOrder: string[],
    queue: string[]
): string | undefined {
    if (queue.length === 0) return undefined;
    const byPlayer = new Map<string, string[]>();
    for (const id of queue) {
        const owner = shipOwner(position, id);
        if (!owner) continue;
        if (!byPlayer.has(owner)) byPlayer.set(owner, []);
        byPlayer.get(owner)!.push(phase3LaunchLabel(position, id));
    }
    const players =
        playerOrder.length > 0 ? playerOrder : [...byPlayer.keys()].sort();
    const parts = players
        .filter((p) => byPlayer.has(p))
        .map((p) => `${p}: ${byPlayer.get(p)!.join("; ")}`);
    return parts.length ? parts.join(" · ") : undefined;
}

function playersWithShipCapability(
    position: FullThrustGamePosition,
    predicate: (ship: ShipGameState) => boolean
): string[] {
    const owners = new Set<string>();
    for (const obj of position.objects ?? []) {
        if (obj.objType !== "ship" || !obj.owner) continue;
        if (predicate(obj as ShipGameState)) owners.add(obj.owner);
    }
    return [...owners];
}

export function phaseCapabilityHint(
    phase: GamePhase,
    position: FullThrustGamePosition,
    meta?: GameMeta
): string | null {
    const ships = (position.objects ?? []).filter((o) => o.objType === "ship");

    switch (phase) {
        case 3: {
            if (ships.length === 0) return "No ships on the map.";
            const ordnance = ships.some((s) =>
                shipHasLaunchableOrdnance(s as ShipGameState)
            );
            const fighters = ships.some(
                (s) =>
                    launchableWings(s as ShipGameState, position).length > 0
            );
            if (!ordnance && !fighters) {
                return "No ordnance or docked fighters to launch — orders may not be needed.";
            }
            return null;
        }
        case 4: {
            const deployed = (position.objects ?? []).filter(
                (o) =>
                    o.objType === "fighters" &&
                    o.position &&
                    typeof o.position === "object" &&
                    "x" in o.position
            );
            if (deployed.length === 0) {
                return "No deployed fighter groups on the map — orders may not be needed.";
            }
            return null;
        }
        case 5:
        case 6:
            if (ships.length === 0) {
                return "No ships on the map — movement orders may not be needed.";
            }
            return null;
        case 7: {
            if (!phase7HasAllocationContent(position)) {
                return "No allocatable ordnance or deployed fighters — advance phase.";
            }
            return null;
        }
        case 12: {
            const contested = contestedShipsForPhase12(position);
            if (contested.length === 0) {
                return "No ships have enemy boarders — advance phase.";
            }
            return `Contested ships: ${contested.join(", ")}.`;
        }
        case 13: {
            const summary = thresholdDiceCount(position, meta ?? { includeCoreSystemsInThreshold: true } as GameMeta);
            if (summary.perShip.length === 0) {
                return "No pending threshold checks — advance phase.";
            }
            return `Threshold checks pending: ${summary.perShip.map((s) => s.shipId).join(", ")} (${summary.total} dice).`;
        }
        case 15: {
            const m = meta ?? ({ includeCoreSystemsInThreshold: true } as GameMeta);
            if (!coreSystemsEnabled(m)) {
                return "Core systems not in play — advance phase.";
            }
            const ships = shipsNeedingReactorRoll(position, m);
            if (ships.length === 0) {
                return "No unstable reactors — advance phase.";
            }
            return `Poll players (dump / abandon / hold), apply Moderator tab orders, then Resolve reactor breaches: ${ships.join(", ")} (${reactorDiceCount(position, m)} dice).`;
        }
        default:
            return null;
    }
}

export function playersWhoActedInPhase(
    phaseCommands: FullThrustGameCommand[],
    phase: GamePhase,
    position: FullThrustGamePosition
): Set<string> {
    const acted = new Set<string>();
    for (const cmd of phaseCommands) {
        if (!isPhasePlayerCommand(cmd.name, phase)) continue;
        const owner = commandActingPlayer(cmd, position);
        if (owner) acted.add(owner);
    }
    return acted;
}

export interface ModeratorStatusInput {
    meta: GameMeta;
    position: FullThrustGamePosition;
    playerIds: string[];
    packageMeta: GameMeta;
    initialPosition: FullThrustGamePosition;
    commands: FullThrustGameCommand[];
    pendingFireDeclarations?: FullThrustGameCommand[];
    pendingBoardingOrders?: FullThrustGameCommand[];
    pendingRepairOrders?: FullThrustGameCommand[];
    pendingMoves?: FullThrustGameCommand[];
    pendingLayMines?: FullThrustGameCommand[];
    phase5ResolvedMoves?: import("./mineMovement").ResolvedShipMove[];
    phase5MovementResolved?: boolean;
    pendingOrdnanceAllocations?: import("./ordnanceAllocation").PendingOrdnanceAllocation[];
    phase8FurballDeclarations?: import("./fighterDogfight").FurballEngagement[];
    phase9PdDeclarations?: import("./pointDefensePhase9").PointDefenseDeclaration[];
    pendingTransporterDeliveries?: import("./weaponFireState").PendingTransporterDelivery[];
    bankedEmpHits?: BankedEmpState;
}

export interface ModeratorStatus {
    activationLabel: string;
    activationOrder: string[];
    hints: string[];
    segment?: string;
    currentActivationId?: string;
}

function shipOwner(position: FullThrustGamePosition, id: string): string | undefined {
    return findShip(position, id)?.owner;
}

/** Ships with unresolved boarding capture awaiting moderator ownership transfer. */
function shipsAwaitingCaptureTransfer(position: FullThrustGamePosition): string[] {
    const lines: string[] = [];
    for (const obj of position.objects ?? []) {
        if (obj.objType !== "ship") continue;
        const cap = (obj as ShipGameState & {
            boardingCapture?: { by: string; resolved?: boolean };
        }).boardingCapture;
        if (cap && !cap.resolved) {
            lines.push(`${obj.id} (by ${cap.by})`);
        }
    }
    return lines;
}

function ownerLabel(position: FullThrustGamePosition, id: string): string {
    const owner = shipOwner(position, id);
    return owner ? `${id} (${owner})` : id;
}

function formatPhase11UndeclaredShips(
    playerOrder: string[],
    position: FullThrustGamePosition,
    undeclared: string[],
    activationQueue: string[] = []
): string | undefined {
    if (undeclared.length === 0) return undefined;
    const queueIndex = new Map(activationQueue.map((id, index) => [id, index]));
    const sortShips = (ids: string[]) =>
        [...ids].sort(
            (a, b) =>
                (queueIndex.get(a) ?? Number.MAX_SAFE_INTEGER) -
                    (queueIndex.get(b) ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(b)
        );

    const parts: string[] = [];
    for (const playerId of playerOrder) {
        const ships = sortShips(
            undeclared.filter((shipId) => shipOwner(position, shipId) === playerId)
        );
        if (ships.length > 0) {
            parts.push(`${playerId}: ${ships.join(", ")}`);
        }
    }
    const listed = new Set(playerOrder);
    const unowned = sortShips(
        undeclared.filter((shipId) => {
            const owner = shipOwner(position, shipId);
            return !owner || !listed.has(owner);
        })
    );
    if (unowned.length > 0) {
        parts.push(unowned.join(", "));
    }
    return parts.join("; ");
}

export function buildModeratorStatus(input: ModeratorStatusInput): ModeratorStatus {
    const {
        meta,
        position,
        playerIds,
        packageMeta,
        initialPosition,
        commands,
        pendingFireDeclarations,
        pendingBoardingOrders,
        pendingRepairOrders,
        pendingMoves,
        pendingLayMines,
        phase5ResolvedMoves,
        phase5MovementResolved,
        pendingOrdnanceAllocations,
        phase8FurballDeclarations,
        phase9PdDeclarations,
        pendingTransporterDeliveries,
        bankedEmpHits,
    } = input;
    const phase = coerceGamePhase(meta.phase);
    const initiative = meta.initiative;
    const order = activationOrder(playerIds, initiative, phase);
    const activationLabel = activationOrderDescription(phase);
    const currentId = currentActivationId(meta);

    const hints: string[] = [];
    const cap = phaseCapabilityHint(phase, position, meta);
    if (cap) hints.push(cap);

    if (phase >= 12) {
        const captured = shipsAwaitingCaptureTransfer(position);
        if (captured.length > 0) {
            hints.push(
                `Captured ships awaiting ownership transfer: ${captured.join(", ")}. Use Moderator tools → Transfer ownership.`
            );
        }
    }

    if (phase === 13) {
        const phaseCommands = commandsInCurrentPhaseSegment(
            commands,
            { turn: meta.turn, phase },
            packageMeta,
            initialPosition
        );
        if (hasBankedEmp(bankedEmpHits)) {
            for (const [targetId, entry] of Object.entries(bankedEmpHits!)) {
                hints.push(
                    `EMP on ${targetId}: ${entry.totalHits} hit(s), fail ${empFailThreshold(entry.totalHits)}+`
                );
            }
            const needing = empContributorsNeedingAllocation(bankedEmpHits!, phaseCommands);
            if (needing.length > 0) {
                hints.push(
                    `EMP allocation pending — ${needing.map((n) => `${n.firerShip}/${n.weapon} → ${n.targetShip}`).join("; ")}.`
                );
            } else {
                hints.push("All EMP allocations declared — resolve in the EMP prompt.");
            }
        }
        const summary = thresholdDiceCount(position, meta);
        if (summary.checks.length === 0 && !hasBankedEmp(bankedEmpHits)) {
            hints.push("No pending threshold checks — advance phase.");
        } else if (summary.checks.length > 0) {
            for (const row of summary.checks) {
                hints.push(
                    `${row.shipId} row ${row.thresholdIndex}: fail ${row.failOn}+${row.rollBonus ? ` (+${row.rollBonus} roll)` : ""}, ${row.dice} dice`
                );
            }
            hints.push(`Total threshold dice: ${summary.total}.`);
        }
        return { activationLabel, activationOrder: order, hints };
    }

    if (phase === 15) {
        const ships = shipsNeedingReactorRoll(position, meta);
        if (ships.length > 0) {
            hints.push(
                `Poll players (dump / abandon / hold) via Moderator tab before resolving.`
            );
            hints.push(
                `Reactor explosion rolls: ${ships.join(", ")} (${reactorDiceCount(position, meta)} dice).`
            );
            hints.push(`Click Resolve reactor breaches when ready.`);
        }
        return { activationLabel, activationOrder: order, hints };
    }

    if (phase === 2) {
        if (!initiative) {
            hints.push("Roll initiative and record the winner, then advance.");
        } else {
            hints.push("Initiative recorded — advance to Launch Ordnance when ready.");
        }
        return { activationLabel, activationOrder: order, hints };
    }

    if (isSegmentActivationPhase(phase)) {
        const segment = meta.segment ?? "orders";
        const segmentLabel = segmentDisplayLabel(phase, segment, meta.boardingStep);

        if (phase === 7) {
            const phaseCommands = commandsInCurrentPhaseSegment(
                commands,
                { turn: meta.turn, phase },
                packageMeta,
                initialPosition
            );
            if (segment === "orders") {
                hints.push(
                    "Missile allocation: homing missiles are proposed automatically — override only for house rules or corrections."
                );
                hints.push(
                    ...ordnanceAllocationModeratorHints(position, pendingOrdnanceAllocations)
                );
            } else {
                hints.push(
                    "Fighter allocation: each deployed group may declare one attack (6 MU, front 180° arc)."
                );
                hints.push(...fighterAttackModeratorHints(meta, position, phaseCommands));
                hints.push(
                    "Gunboat allocation: each deployed squadron may declare one attack (12 MU)."
                );
                hints.push(...gunboatAttackModeratorHints(meta, position, phaseCommands));
            }
            return {
                activationLabel,
                activationOrder: order,
                hints,
                segment: segmentLabel,
            };
        }

        if (phase === 8) {
            const allocations = fighterAttackAllocations(position, commands, meta.turn);
            const alreadyResolved = phase8FurballsResolvedInLog(commands, meta.turn);
            const declarations = effectivePhase8FurballDeclarations(
                phase8FurballDeclarations,
                commands,
                meta.turn
            );
            hints.push("Ordnance intercepts were resolved automatically when phase 8 began.");
            if (segment === "orders") {
                hints.push(
                    "Furball orders: players declare engagements (no dice). Use Next step when ready."
                );
                hints.push(...screeningModeratorHints(position, allocations));
                const uncovered = uncoveredFurballGroups(position, allocations, declarations);
                if (uncovered.length > 0) {
                    hints.push(
                        `Groups that must participate in a furball: ${formatFighterGroupIds(position, uncovered)}.`
                    );
                } else if (declarations.length > 0) {
                    hints.push(
                        `${declarations.length} furball declaration(s) recorded — advance step to resolve.`
                    );
                }
            } else {
                if (alreadyResolved) {
                    hints.push("Furballs resolved for this phase — advance when ready.");
                } else {
                    hints.push("Resolve segment: roll and apply all declared furballs.");
                    if (declarations.length > 0) {
                        const summary = declarations
                            .map(
                                (d, i) =>
                                    `#${i + 1} ${formatFighterGroupIds(
                                        position,
                                        d.attackers.map((a) => a.id)
                                    )} vs ${
                                        d.defenders.length > 0
                                            ? formatFighterGroupIds(
                                                  position,
                                                  d.defenders.map((x) => x.id)
                                              )
                                            : "—"
                                    }`
                            )
                            .join("; ");
                        hints.push(`Pending: ${summary}.`);
                    } else {
                        hints.push("No furball declarations yet.");
                    }
                    const uncovered = uncoveredFurballGroups(position, allocations, declarations);
                    if (uncovered.length > 0) {
                        hints.push(
                            `Cannot resolve until these groups are declared: ${formatFighterGroupIds(position, uncovered)}.`
                        );
                    }
                }
            }
            return {
                activationLabel,
                activationOrder: order,
                hints,
                segment: segmentLabel,
            };
        }

        if (phase === 9) {
            const alreadyResolved = phase9PointDefenseResolvedInLog(commands, meta.turn);
            const declarations = effectivePhase9PdDeclarations(
                phase9PdDeclarations,
                commands,
                meta.turn
            );
            const board = incomingThreatsForPhase9(
                position,
                commands,
                meta.turn,
                phase8FurballDeclarations
            );
            if (segment === "orders") {
                hints.push(
                    "Point defense orders: allocate each PD mount against incoming threats. Use Next step when ready."
                );
                const threatCount =
                    board.fighters.filter((f) => f.kind === "shipAttack").length +
                    board.gunboats.length +
                    board.ordnance.length;
                if (threatCount > 0) {
                    hints.push(`${threatCount} incoming threat(s) detected.`);
                }
                if (board.forfeitedShipAttackers.length > 0) {
                    hints.push(
                        `Not PD-eligible (screeners fought, no bypass): ${formatFighterGroupIds(position, board.forfeitedShipAttackers)}.`
                    );
                }
                if (declarations.length > 0) {
                    hints.push(
                        `${declarations.length} point defense allocation(s) recorded — advance step to resolve.`
                    );
                }
            } else {
                if (alreadyResolved) {
                    hints.push("Point defense resolved for this phase — advance when ready.");
                } else {
                    hints.push("Resolve segment: roll and apply all point defense declarations.");
                    if (declarations.length === 0) {
                        hints.push("No point defense declarations yet.");
                    }
                }
            }
            return {
                activationLabel,
                activationOrder: order,
                hints,
                segment: segmentLabel,
            };
        }

        if (phase === 14) {
            const repairable = shipsNeedingRepairOrders(position);
            if (repairable.length === 0) {
                hints.push("No ships need repair — advance phase.");
                return { activationLabel, activationOrder: order, hints };
            }
            const phaseCommands = commandsInCurrentPhaseSegment(
                commands,
                { turn: meta.turn, phase },
                packageMeta,
                initialPosition
            );
            if (segment === "orders") {
                hints.push(
                    "Orders segment: collect repair declarations from any ship — order is not required."
                );
                const undeclared = phase14UndeclaredRepairShips(
                    position,
                    phaseCommands,
                    pendingRepairOrders
                );
                if (undeclared.length > 0) {
                    const parts = undeclared.map((shipId) => {
                        const ship = findShip(position, shipId) as ShipWithRepairState | undefined;
                        const hint = ship ? repairHintForShip(ship) : "—";
                        return `${shipId} (${hint})`;
                    });
                    hints.push(`Ships awaiting repair orders: ${parts.join("; ")}.`);
                } else {
                    hints.push("All repair orders received — advance step to resolve.");
                }
                hints.push(
                    ...repairDeclarationModeratorHints(position, phaseCommands, pendingRepairOrders)
                );
                for (const shipId of phase14DuplicateRepairShips(phaseCommands, pendingRepairOrders)) {
                    hints.push(
                        `Multiple repair orders for ${shipId} this turn — resolve will use the latest; remove duplicates if unintended.`
                    );
                }
            } else if (segment === "resolve") {
                hints.push("Resolve segment: roll repair dice for pending orders.");
                const ships = orderedShipsWithPendingRepair(pendingRepairOrders);
                if (ships.length) {
                    hints.push(`Resolve pending repair for: ${ships.join(", ")}.`);
                } else {
                    hints.push("No pending repair orders — skip resolve or advance step.");
                }
            }
            return {
                activationLabel,
                activationOrder: order,
                hints,
                segment: segmentLabel,
                currentActivationId: undefined,
            };
        }

        if (activationsComplete(meta)) {
            hints.push("All activations complete — advance phase when ready.");
        } else if (phase === 11 && segment === "resolve") {
            const phaseCommands = commandsInCurrentPhaseSegment(
                commands,
                { turn: meta.turn, phase },
                packageMeta,
                initialPosition
            );
            const undeclared = phase11UndeclaredShips(
                meta,
                phaseCommands,
                pendingFireDeclarations
            );
            const undeclaredSummary = formatPhase11UndeclaredShips(
                order,
                position,
                undeclared,
                meta.activation?.queue ?? []
            );
            const ships = orderedShipsWithPendingFire(pendingFireDeclarations);
            if (ships.length) {
                hints.push(`Resolve pending fire for: ${ships.join(", ")}.`);
            }
            if (undeclaredSummary) {
                hints.push(
                    `More orders needed — ${undeclaredSummary}. Click Next step to return to orders.`
                );
            } else if (ships.length === 0) {
                hints.push("No pending fire declarations — skip resolve or advance step.");
            }
            hints.push(...fireDeclarationModeratorHints(meta, position, pendingFireDeclarations));
            const transporterPending = pendingTransporterSummary(pendingTransporterDeliveries);
            for (const line of transporterPending) {
                hints.push(`Transporter delivery pending: ${line}.`);
            }
        } else if (phase === 12 && segment === "resolve") {
            const phaseCommands = commandsInCurrentPhaseSegment(
                commands,
                { turn: meta.turn, phase },
                packageMeta,
                initialPosition
            );
            const undeclared = phase12UndeclaredShips(
                meta,
                position,
                phaseCommands,
                pendingBoardingOrders
            );
            const undeclaredSummary = formatPhase11UndeclaredShips(
                order,
                position,
                undeclared,
                meta.activation?.queue ?? []
            );
            const ships = orderedShipsWithPendingBoarding(pendingBoardingOrders);
            if (ships.length) {
                hints.push(`Resolve pending boarding for: ${ships.join(", ")}.`);
                hints.push(
                    `Resolve applies ${BOARDING_STEP_LABELS.dcpRepel}, then ${BOARDING_STEP_LABELS.resolveCombat}, then ${BOARDING_STEP_LABELS.raze}.`
                );
            }
            if (undeclaredSummary) {
                hints.push(
                    `More orders needed — ${undeclaredSummary}. Click Next step to return to orders.`
                );
            } else if (ships.length === 0) {
                hints.push("No pending boarding orders — skip resolve or advance step.");
            }
        } else if (phase === 12 && segment === "orders") {
            const phaseCommands = commandsInCurrentPhaseSegment(
                commands,
                { turn: meta.turn, phase },
                packageMeta,
                initialPosition
            );
            const step = meta.boardingStep ?? "attacker";
            if (step === "attacker") {
                const undeclared = phase12UndeclaredAttackerShips(
                    meta,
                    position,
                    phaseCommands,
                    pendingBoardingOrders
                );
                const undeclaredSummary = formatPhase11UndeclaredShips(
                    order,
                    position,
                    undeclared,
                    meta.activation?.queue ?? []
                );
                hints.push(
                    `${BOARDING_STEP_LABELS.attackerAllocation}: each attacking player declares kill/raze per boarder unit, then Next step.`
                );
                if (undeclaredSummary) {
                    hints.push(`Ships awaiting attacker orders — ${undeclaredSummary}.`);
                }
            } else {
                const undeclared = phase12UndeclaredDefenderShips(
                    meta,
                    position,
                    phaseCommands,
                    pendingBoardingOrders
                );
                const undeclaredSummary = formatPhase11UndeclaredShips(
                    order,
                    position,
                    undeclared,
                    meta.activation?.queue ?? []
                );
                hints.push(
                    `${BOARDING_STEP_LABELS.defenderAllocation}: assign DCP repel and marines per boarder (attacker allocations are visible), then Next step to resolve (${BOARDING_STEP_LABELS.dcpRepel} → ${BOARDING_STEP_LABELS.resolveCombat} → ${BOARDING_STEP_LABELS.raze}).`
                );
                if (undeclaredSummary) {
                    hints.push(`Ships awaiting defender orders — ${undeclaredSummary}.`);
                }
            }
            for (const shipId of contestedShipsForPhase12(position)) {
                const ship = position.objects?.find(
                    (o) => o.objType === "ship" && o.id === shipId
                ) as ShipGameState | undefined;
                if (!ship) continue;
                const crew = shipBoardingCrewCapacity(ship);
                const dcp = dcpAvailabilityForShip(ship);
                hints.push(
                    `${shipId}: defender marines ${crew.marines}, DCP pool ${crew.dcpPool} (builtin ${dcp.builtin}, hired ${dcp.hiredAvailable}).`
                );
            }
        } else if (phase === 11 && segment === "orders") {
            const phaseCommands = commandsInCurrentPhaseSegment(
                commands,
                { turn: meta.turn, phase },
                packageMeta,
                initialPosition
            );
            const completed = new Set(shipsCompletedActivation(meta));
            const pending = shipsWithPendingFireOrders(pendingFireDeclarations);
            const undeclared = phase11UndeclaredShips(
                meta,
                phaseCommands,
                pendingFireDeclarations
            );
            const undeclaredSummary = formatPhase11UndeclaredShips(
                order,
                position,
                undeclared,
                meta.activation?.queue ?? []
            );
            hints.push(
                "Orders segment: declare fire for any ship that has not completed activation yet — ship order is not required."
            );
            if (undeclaredSummary) {
                hints.push(`Ships awaiting activation — ${undeclaredSummary}.`);
            }
            for (const shipId of pending) {
                if (completed.has(shipId)) continue;
                hints.push(`Pending fire declarations for ${ownerLabel(position, shipId)}.`);
            }
            hints.push(...fireDeclarationModeratorHints(meta, position, pendingFireDeclarations));
        } else if (currentId) {
            const label = ownerLabel(position, currentId);
            if (segment === "orders") {
                const verb =
                    phase === 3
                        ? "launch orders"
                        : "fire declarations";
                hints.push(`Expecting ${verb} for ${label}.`);
                if (phase === 3) {
                    hints.push(
                        ...fighterLaunchModeratorHints({
                            meta,
                            position,
                            pendingMoves,
                        } as import("./applyCommand").FoldState)
                    );
                }
            } else {
                hints.push(`Roll dice and resolve ${label}.`);
            }
        }
        if (phase === 3 && segment === "orders" && !activationsComplete(meta)) {
            const summary = formatPhase3LaunchSummary(
                position,
                order,
                meta.activation?.queue ?? []
            );
            if (summary) {
                hints.push(`Possible launches — ${summary}.`);
            }
        }
        const showActivationId =
            phase !== 7 &&
            phase !== 8 &&
            phase !== 11 &&
            phase !== 12 &&
            phase !== 14
                ? currentId
                : undefined;
        return {
            activationLabel,
            activationOrder: order,
            hints,
            segment: segmentLabel,
            currentActivationId: showActivationId,
        };
    }

    if (!initiative && isAlternatingActivationPhase(phase)) {
        hints.push("Initiative is not set — alternating phases need a winner from phase 2.");
        return { activationLabel, activationOrder: order, hints };
    }

    const phaseCommands = commandsInCurrentPhaseSegment(
        commands,
        { turn: meta.turn, phase },
        packageMeta,
        initialPosition
    );

    if (phase === 4 && order.length > 0) {
        const fold = { meta, position } as FoldState;
        const ordered = fighterGroupsOrderedThisPhase(phaseCommands);
        const undeclared = formatUndeclaredFightersByPlayer(position, ordered);
        if (undeclared) {
            hints.push(`Fighter groups awaiting orders — ${undeclared}.`);
        }
        const counts = countFighterOrdersByPlayer(phaseCommands, position);
        const total = [...counts.values()].reduce((a, b) => a + b, 0);
        const expected = expectedFighterOrderPlayer(order, total);
        if (expected) {
            hints.push(`Expecting order from ${expected}.`);
        }
        hints.push(...fighterOrderModeratorHints(fold, phaseCommands));
    } else if (isAlternatingActivationPhase(phase) && order.length > 0) {
        const acted = playersWhoActedInPhase(phaseCommands, phase, position);
        const waiting = order.find((p) => !acted.has(p));
        if (waiting) {
            hints.push(`Expecting orders from ${waiting}.`);
        } else {
            hints.push("Each player in activation order has at least one order — advance phase when ready.");
        }
    } else if (phase === 1) {
        hints.push(
            "Collect placement and movement orders (movement resolves in phase 5), then advance to Initiative."
        );
        hints.push(
            ...fighterLaunchModeratorHints({
                meta,
                position,
                pendingMoves,
            } as import("./applyCommand").FoldState)
        );
    } else if (phase === 5) {
        const needs = shipsNeedingMinePlacements(pendingMoves, pendingLayMines);
        if (needs.length > 0) {
            hints.push(
                `${needs.length} minelayer placement(s) still needed: ${needs.map((n) => `${n.shipId}/${n.systemId}`).join(", ")}.`
            );
        } else if ((pendingMoves?.length ?? 0) > 0) {
            hints.push("All placements recorded — use Resolve movement when ready.");
        } else if (!phase5MovementResolved && !phase5ResolvedMoves?.length) {
            hints.push(
                "Resolve movement to apply orders and drift (ships without orders continue at current course and speed)."
            );
        }
        if (phase5ResolvedMoves?.length) {
            const dice = minePhaseDiceCount(phase5ResolvedMoves, position, meta);
            if (dice.total > 0) {
                hints.push(
                    `Enter mine sweep/detonation dice (${dice.sweeps} sweep, ${dice.detonations} detonation dice).`
                );
            }
        }
    } else if (phase === 10) {
        const resolved = phase10StrikesCompleteInLog(commands, meta.turn);
        const queue = phase10StrikeQueue(position, commands, meta.turn);
        const counts = queue.reduce(
            (acc, e) => {
                acc[e.kind] = (acc[e.kind] ?? 0) + 1;
                return acc;
            },
            {} as Record<string, number>
        );
        const parts = Object.entries(counts).map(([k, n]) => `${k}: ${n}`);
        if (resolved) {
            hints.push("Phase 10 strikes resolved — advance when ready.");
        } else {
            hints.push(
                "Strikes resolve automatically when advancing from phase 9 — no player orders in this phase."
            );
            if (queue.length === 0) {
                hints.push("No pending missile or fighter strikes on the board.");
            } else {
                hints.push(
                    `${queue.length} strike event(s) pending${parts.length ? ` (${parts.join(", ")})` : ""} — advance from phase 9 to resolve.`
                );
            }
        }
    } else {
        const typical = commandsForPhase(phase).filter((c) => !META_COMMANDS.has(c));
        if (typical.length > 0) {
            hints.push(
                `Simultaneous phase — collect ${phaseName(phase).toLowerCase()} orders, then advance.`
            );
        }
    }

    return { activationLabel, activationOrder: order, hints };
}

/** Validate initiative winner is a known player (multi-player safe). */
export function normalizeInitiativeWinner(
    initiative: InitiativeState,
    playerIds: string[]
): InitiativeState | undefined {
    if (!playerIds.includes(initiative.winner)) return undefined;
    const rolls = initiative.rolls.filter((r) => playerIds.includes(r.player));
    if (rolls.length === 0) return undefined;
    return { ...initiative, rolls };
}
