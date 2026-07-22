import type { FullThrustGameCommand } from "@/schemas/commands";
import type { FullThrustGamePosition } from "@/schemas/position";
import type { GameMeta, GamePhase } from "./types";
import {
    isSegmentActivationPhase,
    currentActivationId,
} from "./phase";
import { initSegmentMetaForPhase } from "./activation";
import type { FoldState } from "./applyCommand";
import deepclone from "rfdc/default";
import { decodeAttackerBoardingNotes, isBoardingDeclareCommand, boardingCommandRole } from "./boardingOrders";
import { contestedShipsForPhase12, attackerOwnersOnShip } from "./boardingState";
import { shipsNeedingRepairOrders } from "./repairSystems";
import { distance } from "./movement";
import {
    resolveRocketHits,
    rocketPlacementPositions,
    ordnanceLaunchFacing,
} from "./ordnanceLaunch";
import { consumeLauncherAmmunitionPatch } from "@/lib/ammunition";
import { buildOrdnanceSymbol } from "@/lib/ordnanceGlyph";
import type { ShipGameState } from "./shipSystems";
import { isSystemDestroyed } from "./shipSystems";
import { initialSalvoFields } from "./salvoOrdnance";

type ShipObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "ship" }
>;
type OrdnanceObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "ordnance" }
>;

function cmdShip(cmd: FullThrustGameCommand): string | undefined {
    const c = cmd as { ship?: string };
    return typeof c.ship === "string" ? c.ship : undefined;
}

function cmdFireShip(cmd: FullThrustGameCommand): string | undefined {
    if (cmd.name === "declareShipFire") {
        const c = cmd as { ship?: string };
        return typeof c.ship === "string" ? c.ship : undefined;
    }
    return undefined;
}

function cmdBoardingShip(cmd: FullThrustGameCommand): string | undefined {
    if (isBoardingDeclareCommand(cmd)) {
        const c = cmd as { ship?: string };
        return typeof c.ship === "string" ? c.ship : undefined;
    }
    return undefined;
}

function cmdRepairShip(cmd: FullThrustGameCommand): string | undefined {
    if (cmd.name === "declareRepairOrders") {
        const c = cmd as { ship?: string };
        return typeof c.ship === "string" ? c.ship : undefined;
    }
    return undefined;
}

export function applyAdvanceSegment(meta: GameMeta): GameMeta {
    if (!isSegmentActivationPhase(meta.phase)) {
        throw new Error("advanceSegment: not in a segmented activation phase");
    }
    const act = meta.activation ?? { queue: [], index: 0 };
    const segment = meta.segment ?? "orders";

    if (meta.phase === 12) {
        const step = meta.boardingStep ?? "attacker";
        if (segment === "orders" && step === "attacker") {
            return { ...meta, boardingStep: "defender", activation: { ...act } };
        }
        if (segment === "orders" && step === "defender") {
            return {
                ...meta,
                segment: "resolve",
                boardingStep: "attacker",
                activation: { ...act },
            };
        }
        if (segment === "resolve") {
            return {
                ...meta,
                segment: "orders",
                boardingStep: "attacker",
                activation: { ...act },
            };
        }
    }

    if (segment === "orders") {
        return { ...meta, segment: "resolve", activation: { ...act } };
    }
    // Phase 7: missile allocation → fighter allocation (one-way).
    if (meta.phase === 7) {
        return meta;
    }
    // Phase 8: furball orders → resolve (one-way).
    if (meta.phase === 8) {
        return meta;
    }
    // Phase 9: point defense orders → resolve (one-way).
    if (meta.phase === 9) {
        return meta;
    }
    if (meta.phase === 11 || meta.phase === 14) {
        return { ...meta, segment: "orders", activation: { ...act } };
    }
    return {
        ...meta,
        segment: "orders",
        activation: { ...act, index: act.index + 1 },
    };
}

export function applySegmentPhaseEntry(
    meta: GameMeta,
    position: FullThrustGamePosition,
    prevPhase: GamePhase
): GameMeta {
    const next = { ...meta };
    if (isSegmentActivationPhase(prevPhase) && !isSegmentActivationPhase(meta.phase)) {
        next.segment = undefined;
        next.activation = undefined;
        next.boardingStep = undefined;
        return next;
    }
    if (isSegmentActivationPhase(meta.phase)) {
        const playerIds = position.players?.map((p) => p.id) ?? [];
        const init = initSegmentMetaForPhase(
            meta.phase,
            position,
            playerIds,
            meta.initiative,
            meta.turn
        );
        if (init) {
            next.segment = init.segment;
            next.activation = init.activation;
            if (meta.phase === 12) {
                next.boardingStep = "attacker";
            }
        } else {
            next.segment = undefined;
            next.activation = undefined;
        }
    }
    return next;
}

export function queueDeclareLaunch(
    fold: FoldState,
    cmd: FullThrustGameCommand
): FullThrustGameCommand[] {
    const ship = cmdShip(cmd);
    if (!ship) throw new Error("declareLaunchOrdnance: missing ship");
    const current = currentActivationId(fold.meta);
    if (current && ship !== current) {
        throw new Error(`declareLaunchOrdnance: expected orders for ${current}`);
    }
    return [...(fold.pendingLaunches ?? []), deepclone(cmd)];
}

export function queueDeclareFire(
    fold: FoldState,
    cmd: FullThrustGameCommand
): FullThrustGameCommand[] {
    const ship = cmdFireShip(cmd);
    if (!ship) throw new Error("declareShipFire: missing ship");
    return [...(fold.pendingFireDeclarations ?? []), deepclone(cmd)];
}

export function queueDeclareBoarding(
    fold: FoldState,
    cmd: FullThrustGameCommand
): FullThrustGameCommand[] {
    const ship = cmdBoardingShip(cmd);
    if (!ship) throw new Error("declareBoarding*: missing ship");
    const role = boardingCommandRole(cmd);
    if (!role) throw new Error("queueDeclareBoarding: not a boarding declare command");
    const pending = fold.pendingBoardingOrders ?? [];
    const attNotes =
        role === "attacker" ? decodeAttackerBoardingNotes((cmd as { notes?: string }).notes) : null;
    const filtered = pending.filter((c) => {
        if (!isBoardingDeclareCommand(c) || cmdBoardingShip(c) !== ship) return true;
        const cRole = boardingCommandRole(c);
        if (cRole !== role) return true;
        if (role === "attacker" && attNotes) {
            const existing = decodeAttackerBoardingNotes((c as { notes?: string }).notes);
            if (existing?.attackerOwner !== attNotes.attackerOwner) return true;
        }
        return false;
    });
    return [...filtered, deepclone(cmd)];
}

export function queueDeclareRepair(
    fold: FoldState,
    cmd: FullThrustGameCommand
): FullThrustGameCommand[] {
    const ship = cmdRepairShip(cmd);
    if (!ship) throw new Error("declareRepairOrders: missing ship");
    const pending = fold.pendingRepairOrders ?? [];
    const filtered = pending.filter(
        (c) => c.name !== "declareRepairOrders" || cmdRepairShip(c) !== ship
    );
    return [...filtered, deepclone(cmd)];
}

export function applyResolveLaunchOrdnance(
    position: FullThrustGamePosition,
    fold: FoldState,
    applyLaunch: (pos: FullThrustGamePosition, cmd: FullThrustGameCommand) => void,
    opts: {
        rollsForRocket?: (cmd: FullThrustGameCommand) => [number, number];
    } = {}
): { position: FullThrustGamePosition; pending: FullThrustGameCommand[] } {
    const shipId = currentActivationId(fold.meta);
    if (!shipId) throw new Error("resolveLaunchOrdnance: no current activation");
    const pos = deepclone(position) as FullThrustGamePosition;
    const remaining: FullThrustGameCommand[] = [];
    for (const cmd of fold.pendingLaunches ?? []) {
        if (cmd.name === "declareLaunchOrdnance" && cmdShip(cmd) === shipId) {
            const type = (cmd as { type?: string }).type;
            if (type === "rocket" && opts.rollsForRocket) {
                const rolls = opts.rollsForRocket(cmd);
                resolveRocketLaunch(pos, cmd, rolls, findShip, ensureObjects);
            } else if (type !== "rocket") {
                applyLaunch(pos, cmd);
            }
        } else {
            remaining.push(cmd);
        }
    }
    return { position: pos, pending: remaining };
}

export function launchFromDeclare(
    position: FullThrustGamePosition,
    cmd: FullThrustGameCommand,
    findShip: (pos: FullThrustGamePosition, id: string) => ShipObj,
    ensureObjects: (pos: FullThrustGamePosition) => NonNullable<FullThrustGamePosition["objects"]>
): void {
    const c = cmd as {
        ship?: string;
        id?: string;
        systemId?: string;
        position?: { x: number; y: number };
        type?: OrdnanceObj["type"];
        range?: number;
        facing?: OrdnanceObj["facing"];
        stage?: 1 | 2;
        aimPosition?: { x: number; y: number };
        deployedTurn?: number;
        targetShip?: string;
    };
    if (c.type === "rocket") {
        throw new Error("declareLaunchOrdnance: rockets resolve via resolveRocketLaunch");
    }
    if (!c.ship || !c.id || !c.position) {
        throw new Error("declareLaunchOrdnance: incomplete");
    }
    const ship = findShip(position, c.ship);
    const glyph = c.systemId
        ? buildOrdnanceSymbol(ship as ShipGameState, c.systemId, c.id)
        : undefined;
    const facing = ordnanceLaunchFacing(ship, c.position);
    const ordType = c.type ?? "missile";
    ensureObjects(position).push({
        objType: "ordnance",
        id: c.id,
        owner: ship.owner,
        type: ordType,
        position: c.position,
        range: c.range,
        facing,
        stage: c.stage,
        aimPosition: c.aimPosition,
        launcherShip: c.ship,
        systemId: c.systemId,
        targetShip: c.targetShip,
        deployedTurn: c.deployedTurn,
        detonateOpenSpace: (c as { detonateOpenSpace?: boolean }).detonateOpenSpace,
        svg: glyph?.svg,
        ...initialSalvoFields(ordType),
    } as OrdnanceObj);
    if (!ship.ammo) ship.ammo = [];
    if (c.systemId) {
        ship.ammo = consumeLauncherAmmunitionPatch(ship as ShipGameState, c.systemId);
    }
}

export function resolveRocketLaunch(
    position: FullThrustGamePosition,
    cmd: FullThrustGameCommand,
    rolls: [number, number],
    findShip: (pos: FullThrustGamePosition, id: string) => ShipObj,
    ensureObjects: (pos: FullThrustGamePosition) => NonNullable<FullThrustGamePosition["objects"]>
): { hits: number; rangeMu: number } {
    const c = cmd as {
        ship?: string;
        systemId?: string;
        targetShip?: string;
        rocketIds?: string[];
        type?: string;
    };
    if (!c.ship || !c.systemId || !c.targetShip) {
        throw new Error("resolveRocketLaunch: incomplete declare");
    }
    const ship = findShip(position, c.ship);
    const target = findShip(position, c.targetShip);
    const shipPos = ship.position;
    const tgtPos = target.position;
    if (!shipPos || !("x" in shipPos) || !tgtPos || !("x" in tgtPos)) {
        throw new Error("resolveRocketLaunch: missing positions");
    }
    const rangeMu = distance(shipPos, tgtPos);
    const [hit1, hit2] = resolveRocketHits(rolls, rangeMu);
    const hitCount = (hit1 ? 1 : 0) + (hit2 ? 1 : 0);
    const ids = c.rocketIds ?? [];
    const positions = rocketPlacementPositions(tgtPos, hitCount);
    let placed = 0;
    for (let i = 0; i < hitCount; i++) {
        const ordId = ids[i];
        if (!ordId) continue;
        const glyph = buildOrdnanceSymbol(ship as ShipGameState, c.systemId, ordId);
        const rocketPos = positions[i];
        ensureObjects(position).push({
            objType: "ordnance",
            id: ordId,
            owner: ship.owner,
            type: "rocket",
            position: rocketPos,
            facing: ordnanceLaunchFacing(ship, rocketPos),
            launcherShip: c.ship,
            systemId: c.systemId,
            targetShip: c.targetShip,
            svg: glyph?.svg,
        } as OrdnanceObj);
        placed++;
    }
    if (!ship.ammo) ship.ammo = [];
    ship.ammo = consumeLauncherAmmunitionPatch(ship as ShipGameState, c.systemId);
    if (!ship.systems) ship.systems = [];
    if (!isSystemDestroyed(ship as ShipGameState, c.systemId)) {
        ship.systems.push({ id: c.systemId, state: "destroyed" });
    }
    return { hits: placed, rangeMu };
}

export function pendingRocketLaunchesForShip(
    fold: FoldState,
    shipId: string
): FullThrustGameCommand[] {
    return (fold.pendingLaunches ?? []).filter(
        (c) =>
            c.name === "declareLaunchOrdnance" &&
            cmdShip(c) === shipId &&
            (c as { type?: string }).type === "rocket"
    );
}

function findShip(pos: FullThrustGamePosition, id: string): ShipObj {
    const obj = pos.objects?.find((o) => o.id === id);
    if (!obj || obj.objType !== "ship") throw new Error(`Ship not found: ${id}`);
    return obj;
}

function ensureObjects(
    state: FullThrustGamePosition
): NonNullable<FullThrustGamePosition["objects"]> {
    if (!state.objects) state.objects = [];
    return state.objects;
}

export function pendingLaunchesForShip(
    fold: FoldState,
    shipId: string
): FullThrustGameCommand[] {
    return (fold.pendingLaunches ?? []).filter(
        (c) => c.name === "declareLaunchOrdnance" && cmdShip(c) === shipId
    );
}

export function pendingFireForShip(
    fold: FoldState,
    shipId: string
): FullThrustGameCommand[] {
    return (fold.pendingFireDeclarations ?? []).filter(
        (c) => c.name === "declareShipFire" && cmdFireShip(c) === shipId
    );
}

/** Weapon ids that already have a declareShipFire queued for this ship this phase. */
export function pendingFireWeaponIds(fold: FoldState, shipId: string): Set<string> {
    const ids = new Set<string>();
    for (const cmd of pendingFireForShip(fold, shipId)) {
        const weapon = (cmd as { weapon?: string }).weapon;
        if (weapon) ids.add(weapon);
    }
    return ids;
}

/** Drop declarations for weapons already present in pending fire for this ship. */
export function filterNewFireDeclarations(
    fold: FoldState,
    shipId: string,
    decls: FullThrustGameCommand[]
): FullThrustGameCommand[] {
    const pending = pendingFireWeaponIds(fold, shipId);
    return decls.filter((d) => {
        const weapon = (d as { weapon?: string }).weapon;
        return weapon && !pending.has(weapon);
    });
}

export function pendingBoardingForShip(
    fold: FoldState,
    shipId: string
): FullThrustGameCommand[] {
    return (fold.pendingBoardingOrders ?? []).filter(
        (c) => isBoardingDeclareCommand(c) && cmdBoardingShip(c) === shipId
    );
}

/** Ships that finished an orders→resolve activation cycle this segmented phase. */
export function shipsCompletedActivation(meta: import("./types").GameMeta): string[] {
    const act = meta.activation;
    if (!act) return [];
    return act.queue.slice(0, act.index);
}

export function orderedShipsWithPendingFire(
    pending: FullThrustGameCommand[] | undefined
): string[] {
    const order: string[] = [];
    const seen = new Set<string>();
    for (const cmd of pending ?? []) {
        if (cmd.name !== "declareShipFire") continue;
        const ship = cmdFireShip(cmd);
        if (!ship || seen.has(ship)) continue;
        seen.add(ship);
        order.push(ship);
    }
    return order;
}

export function shipsWithPendingFireOrders(
    pending: FullThrustGameCommand[] | undefined
): Set<string> {
    const ids = new Set<string>();
    for (const cmd of pending ?? []) {
        if (cmd.name !== "declareShipFire") continue;
        const ship = cmdFireShip(cmd);
        if (ship) ids.add(ship);
    }
    return ids;
}

/** Ships that already have fire orders this segment (pending fold state and/or master log). */
export function shipsWithDeclaredFire(
    phaseCommands: FullThrustGameCommand[] | undefined,
    pending: FullThrustGameCommand[] | undefined
): Set<string> {
    const ids = shipsWithPendingFireOrders(pending);
    for (const cmd of phaseCommands ?? []) {
        if (cmd.name !== "declareShipFire") continue;
        const ship = cmdFireShip(cmd);
        if (ship) ids.add(ship);
    }
    return ids;
}

/** Update FC targets so no two firecons track the same enemy ship. */
export function applyExclusiveFireControlTarget(
    fcTargets: Record<string, string>,
    fcId: string,
    targetId: string
): Record<string, string> {
    const next = { ...fcTargets, [fcId]: targetId };
    if (targetId) {
        for (const [id, t] of Object.entries(next)) {
            if (id !== fcId && t === targetId) next[id] = "";
        }
    }
    return next;
}

/** Enemy ship ids available for one FC (excludes targets assigned to other FCs). */
export function enemyTargetsForFireControl(
    fcId: string,
    fcTargets: Record<string, string>,
    enemyShipIds: string[]
): string[] {
    return enemyShipIds.filter(
        (shipId) =>
            !Object.entries(fcTargets).some(([id, t]) => id !== fcId && t === shipId)
    );
}

/** Distinct declareShipFire weapon ids for a ship this segment (pending + phase log). */
export function declaredFireWeaponIdsForShip(
    shipId: string,
    phaseCommands: FullThrustGameCommand[] | undefined,
    pending: FullThrustGameCommand[] | undefined
): Set<string> {
    const ids = new Set<string>();
    for (const cmd of pending ?? []) {
        if (cmd.name !== "declareShipFire") continue;
        if (cmdFireShip(cmd) !== shipId) continue;
        const weapon = (cmd as { weapon?: string }).weapon;
        if (weapon) ids.add(weapon);
    }
    for (const cmd of phaseCommands ?? []) {
        if (cmd.name !== "declareShipFire") continue;
        if (cmdFireShip(cmd) !== shipId) continue;
        const weapon = (cmd as { weapon?: string }).weapon;
        if (weapon) ids.add(weapon);
    }
    return ids;
}

/** Ships in the activation queue that still need fire declarations this phase. */
export function phase11UndeclaredShips(
    meta: GameMeta,
    phaseCommands: FullThrustGameCommand[] | undefined,
    pending: FullThrustGameCommand[] | undefined
): string[] {
    const completed = new Set(shipsCompletedActivation(meta));
    const declared = shipsWithDeclaredFire(phaseCommands, pending);
    return (meta.activation?.queue ?? []).filter(
        (id) => !completed.has(id) && !declared.has(id)
    );
}

function boardingCommandsForShip(
    shipId: string,
    phaseCommands: FullThrustGameCommand[] | undefined,
    pending: FullThrustGameCommand[] | undefined
): FullThrustGameCommand[] {
    const cmds: FullThrustGameCommand[] = [];
    for (const cmd of pending ?? []) {
        if (isBoardingDeclareCommand(cmd) && cmdBoardingShip(cmd) === shipId) {
            cmds.push(cmd);
        }
    }
    for (const cmd of phaseCommands ?? []) {
        if (isBoardingDeclareCommand(cmd) && cmdBoardingShip(cmd) === shipId) {
            cmds.push(cmd);
        }
    }
    return cmds;
}

export function attackerBoardingOrdersForShip(
    shipId: string,
    phaseCommands: FullThrustGameCommand[] | undefined,
    pending: FullThrustGameCommand[] | undefined
): FullThrustGameCommand[] {
    return boardingCommandsForShip(shipId, phaseCommands, pending).filter(
        (c) => c.name === "declareBoardingAttackerOrders"
    );
}

function defenderBoardingOrdersForShip(
    shipId: string,
    phaseCommands: FullThrustGameCommand[] | undefined,
    pending: FullThrustGameCommand[] | undefined
): FullThrustGameCommand[] {
    return boardingCommandsForShip(shipId, phaseCommands, pending).filter(
        (c) => c.name === "declareBoardingDefenderOrders"
    );
}

export function shipsWithPendingBoardingOrders(
    pending: FullThrustGameCommand[] | undefined
): Set<string> {
    const ids = new Set<string>();
    for (const cmd of pending ?? []) {
        if (!isBoardingDeclareCommand(cmd)) continue;
        const ship = cmdBoardingShip(cmd);
        if (ship) ids.add(ship);
    }
    return ids;
}

export function orderedShipsWithPendingBoarding(
    pending: FullThrustGameCommand[] | undefined
): string[] {
    const order: string[] = [];
    const seen = new Set<string>();
    for (const cmd of pending ?? []) {
        if (!isBoardingDeclareCommand(cmd)) continue;
        const ship = cmdBoardingShip(cmd);
        if (!ship || seen.has(ship)) continue;
        seen.add(ship);
        order.push(ship);
    }
    return order;
}

export function attackerOrderForOwner(
    shipId: string,
    owner: string,
    phaseCommands: FullThrustGameCommand[] | undefined,
    pending: FullThrustGameCommand[] | undefined
): FullThrustGameCommand | undefined {
    for (const cmd of attackerBoardingOrdersForShip(shipId, phaseCommands, pending)) {
        const notes = decodeAttackerBoardingNotes((cmd as { notes?: string }).notes);
        if (notes?.attackerOwner === owner) return cmd;
    }
    return undefined;
}

export function attackerOrdersCompleteForShip(
    position: FullThrustGamePosition,
    shipId: string,
    phaseCommands: FullThrustGameCommand[] | undefined,
    pending: FullThrustGameCommand[] | undefined
): boolean {
    const ship = position.objects?.find((o) => o.id === shipId && o.objType === "ship");
    if (!ship || ship.objType !== "ship") return false;
    const attackerOwners = new Set(
        attackerOwnersOnShip(ship as import("./boardingState").ShipWithBoarders)
    );
    if (attackerOwners.size === 0) return true;
    const orders = attackerBoardingOrdersForShip(shipId, phaseCommands, pending);
    for (const owner of attackerOwners) {
        const hasAtt = orders.some((c) => {
            const n = decodeAttackerBoardingNotes((c as { notes?: string }).notes);
            return n?.attackerOwner === owner;
        });
        if (!hasAtt) return false;
    }
    return true;
}

export function defenderOrdersCompleteForShip(
    shipId: string,
    phaseCommands: FullThrustGameCommand[] | undefined,
    pending: FullThrustGameCommand[] | undefined
): boolean {
    return defenderBoardingOrdersForShip(shipId, phaseCommands, pending).length > 0;
}

export function boardingOrdersCompleteForShip(
    position: FullThrustGamePosition,
    shipId: string,
    phaseCommands: FullThrustGameCommand[] | undefined,
    pending: FullThrustGameCommand[] | undefined
): boolean {
    return (
        attackerOrdersCompleteForShip(position, shipId, phaseCommands, pending) &&
        defenderOrdersCompleteForShip(shipId, phaseCommands, pending)
    );
}

function phase12ShipIds(meta: GameMeta, position: FullThrustGamePosition): string[] {
    const queue = meta.activation?.queue ?? [];
    if (queue.length > 0) return queue;
    return contestedShipsForPhase12(position);
}

export function phase12UndeclaredAttackerShips(
    meta: GameMeta,
    position: FullThrustGamePosition,
    phaseCommands: FullThrustGameCommand[] | undefined,
    pending: FullThrustGameCommand[] | undefined
): string[] {
    return phase12ShipIds(meta, position).filter(
        (id) => !attackerOrdersCompleteForShip(position, id, phaseCommands, pending)
    );
}

export function phase12UndeclaredDefenderShips(
    meta: GameMeta,
    position: FullThrustGamePosition,
    phaseCommands: FullThrustGameCommand[] | undefined,
    pending: FullThrustGameCommand[] | undefined
): string[] {
    return phase12ShipIds(meta, position).filter(
        (id) => !defenderOrdersCompleteForShip(id, phaseCommands, pending)
    );
}

export function phase12UndeclaredShips(
    meta: GameMeta,
    position: FullThrustGamePosition,
    phaseCommands: FullThrustGameCommand[] | undefined,
    pending: FullThrustGameCommand[] | undefined
): string[] {
    return phase12ShipIds(meta, position).filter(
        (id) => !boardingOrdersCompleteForShip(position, id, phaseCommands, pending)
    );
}

function repairDeclareCountForShip(
    shipId: string,
    phaseCommands: FullThrustGameCommand[] | undefined,
    pending: FullThrustGameCommand[] | undefined
): number {
    let count = 0;
    for (const cmd of phaseCommands ?? []) {
        if (cmd.name === "declareRepairOrders" && cmdRepairShip(cmd) === shipId) count += 1;
    }
    for (const cmd of pending ?? []) {
        if (cmd.name === "declareRepairOrders" && cmdRepairShip(cmd) === shipId) count += 1;
    }
    return count;
}

export function repairOrdersDeclaredForShip(
    shipId: string,
    phaseCommands: FullThrustGameCommand[] | undefined,
    pending: FullThrustGameCommand[] | undefined
): boolean {
    return repairDeclareCountForShip(shipId, phaseCommands, pending) > 0;
}

/** Ships with declareRepairOrders (pending or logged) or resolveRepairOrders this phase segment. */
export function shipsWithRepairOrders(
    phaseCommands: FullThrustGameCommand[] | undefined,
    pending: FullThrustGameCommand[] | undefined
): Set<string> {
    const ids = new Set<string>();
    for (const cmd of pending ?? []) {
        if (cmd.name === "declareRepairOrders") {
            const ship = cmdRepairShip(cmd);
            if (ship) ids.add(ship);
        }
    }
    for (const cmd of phaseCommands ?? []) {
        if (cmd.name === "declareRepairOrders" || cmd.name === "resolveRepairOrders") {
            const ship = cmdRepairShip(cmd);
            if (ship) ids.add(ship);
        }
    }
    return ids;
}

export function repairOrdersResolvedForShip(
    shipId: string,
    phaseCommands: FullThrustGameCommand[] | undefined
): boolean {
    for (const cmd of phaseCommands ?? []) {
        if (cmd.name === "resolveRepairOrders" && cmdRepairShip(cmd) === shipId) return true;
    }
    return false;
}

export function phase14UndeclaredRepairShips(
    position: FullThrustGamePosition,
    phaseCommands: FullThrustGameCommand[] | undefined,
    pending: FullThrustGameCommand[] | undefined
): string[] {
    return shipsNeedingRepairOrders(position).filter(
        (id) => !repairOrdersDeclaredForShip(id, phaseCommands, pending)
    );
}

export function phase14DuplicateRepairShips(
    phaseCommands: FullThrustGameCommand[] | undefined,
    _pending?: FullThrustGameCommand[] | undefined
): string[] {
    const counts = new Map<string, number>();
    for (const cmd of phaseCommands ?? []) {
        if (cmd.name !== "declareRepairOrders") continue;
        const ship = cmdRepairShip(cmd);
        if (!ship) continue;
        counts.set(ship, (counts.get(ship) ?? 0) + 1);
    }
    return [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id).sort();
}

export function pendingRepairForShip(
    fold: FoldState,
    shipId: string
): FullThrustGameCommand[] {
    return (fold.pendingRepairOrders ?? []).filter(
        (c) => c.name === "declareRepairOrders" && cmdRepairShip(c) === shipId
    );
}

export function orderedShipsWithPendingRepair(
    pending: FullThrustGameCommand[] | undefined
): string[] {
    const order: string[] = [];
    const seen = new Set<string>();
    for (const cmd of pending ?? []) {
        if (cmd.name !== "declareRepairOrders") continue;
        const ship = cmdRepairShip(cmd);
        if (!ship || seen.has(ship)) continue;
        seen.add(ship);
        order.push(ship);
    }
    return order;
}

export function latestRepairDeclareForShip(
    shipId: string,
    phaseCommands: FullThrustGameCommand[] | undefined,
    pending: FullThrustGameCommand[] | undefined
): FullThrustGameCommand | undefined {
    let latest: FullThrustGameCommand | undefined;
    for (const cmd of phaseCommands ?? []) {
        if (cmd.name === "declareRepairOrders" && cmdRepairShip(cmd) === shipId) {
            latest = cmd;
        }
    }
    for (const cmd of pending ?? []) {
        if (cmd.name === "declareRepairOrders" && cmdRepairShip(cmd) === shipId) {
            latest = cmd;
        }
    }
    return latest;
}

export function clearPendingForSegment(fold: FoldState): Partial<FoldState> {
    return {
        pendingLaunches: [],
        pendingFireDeclarations: [],
        pendingBoardingOrders: [],
        pendingRepairOrders: [],
        pendingOrdnanceAllocations: [],
    };
}
