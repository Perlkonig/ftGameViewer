/** Phase 10 automatic strike resolution — scrub-back command stream. */

import type { FullThrustGameCommand } from "@/schemas/commands";
import type { FullThrustGamePosition } from "@/schemas/position";
import type { RollSource } from "./dice";
import { arrayRollSource } from "./dice";
import {
    incomingThreatsForPhase9,
    mutuallyEngagedFighterIds,
    pdKillsFromPhase9Log,
    type OrdnanceThreat,
} from "./incomingThreats";
import {
    fighterAttackAllocations,
    fighterAttackAllocationsFromLog,
    type FighterAttackAlloc,
} from "./fighterEngagement";
import {
    declaredFurballsFromCommands,
    isAttackRunInterceptPair,
    phase8FurballsResolvedInLog,
} from "./fighterPhase8";
import { isDeployedFighter } from "./fighterMove";
import {
    resolveSalvoStrike,
    resolveHeavyMissile,
    resolveFighterStrike,
} from "./ordnanceAttack";
import {
    fighterProfileFor,
    resolveFighterStrikeWithProfile,
} from "./fighterProfiles";
import { fighterWingFromObj } from "./fighterTypeCommand";
import { nextEnduranceAfterFighterAttack } from "./fighterProfiles";
import {
    gunboatBoatProfile,
    gunboatProtectionDrm,
    liveGunboatBoats,
    resolveGunboatBoatStrike,
} from "./gunboatProfiles";
import { gunboatGroupLabel } from "./gunboatLabel";
import { isDeployedGunboat } from "./gunboatMove";
import { distance } from "./movement";
import {
    resolveAmtOpenSpaceBlast,
    resolveAmtOpenSpaceBlastFromRolls,
    resolveAmtShipImpactBlast,
    resolveAmtShipImpactBlastFromRolls,
    resolvePblDetonationBlast,
    resolvePblDetonationBlastFromRolls,
} from "./ordnanceBlast";
import { applySalvoMissileKills, isSalvoOrdnanceType } from "./salvoOrdnance";
import {
    computeShipDamageApplication,
    pushAppliedHullDamageCommands,
} from "./resolveCombat";
import { screenLevelFromSystems } from "./combat";
import {
    isFighterExhausted,
    nextEnduranceAfterCombat,
    resolveDogfightSideRolls,
} from "./fighterEndurance";
import { fighterGroupLabel } from "./fighterLabel";

type FighterObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "fighters" }
>;
type OrdnanceObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "ordnance" }
>;
type ShipObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "ship" }
>;
type GunboatObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "gunboats" }
>;

function findGunboat(position: FullThrustGamePosition, id: string): GunboatObj | undefined {
    const obj = position.objects?.find((o) => o.id === id);
    return obj?.objType === "gunboats" ? (obj as GunboatObj) : undefined;
}

export type Phase10StrikeKind =
    | "amtOpenSpace"
    | "pblDetonation"
    | "salvoStrike"
    | "heavyMissile"
    | "amtShipImpact"
    | "attackRunIntercept"
    | "fighterShipStrike"
    | "gunboatShipStrike";

export interface Phase10StrikeEvent {
    kind: Phase10StrikeKind;
    id: string;
    targetShipId?: string;
    interceptorId?: string;
    attackerId?: string;
}

function findFighter(position: FullThrustGamePosition, id: string): FighterObj | undefined {
    const obj = position.objects?.find((o) => o.id === id);
    return obj?.objType === "fighters" ? (obj as FighterObj) : undefined;
}

function findOrdnance(position: FullThrustGamePosition, id: string): OrdnanceObj | undefined {
    const obj = position.objects?.find((o) => o.id === id);
    return obj?.objType === "ordnance" ? (obj as OrdnanceObj) : undefined;
}

function findShip(position: FullThrustGamePosition, id: string): ShipObj | undefined {
    const obj = position.objects?.find((o) => o.id === id);
    return obj?.objType === "ship" ? (obj as ShipObj) : undefined;
}

function shipScreens(ship: ShipObj): number {
    const systems = (ship.object as { systems?: { name?: string; type?: string; level?: number }[] })
        ?.systems;
    return screenLevelFromSystems(Array.isArray(systems) ? systems : []);
}

function amtStillViable(ord: OrdnanceObj): boolean {
    const hits = (ord as { interceptHits?: number }).interceptHits ?? 0;
    const str = (ord as { amtWarheadStrength?: number }).amtWarheadStrength ?? 6;
    return hits < 3 && str > 0;
}

export function incomingThreatsForPhase10(
    position: FullThrustGamePosition,
    commands: FullThrustGameCommand[],
    turn: number
) {
    return incomingThreatsForPhase9(position, commands, turn);
}

/** Pairs already fought in a resolved phase-8 furball batch. */
export function furballPairsResolvedInLog(
    commands: FullThrustGameCommand[],
    turn: number
): Set<string> {
    const pairs = new Set<string>();
    if (!phase8FurballsResolvedInLog(commands, turn)) return pairs;
    const engagements = declaredFurballsFromCommands(commands, turn);
    for (const eng of engagements) {
        const attackers = eng.attackers.map((a) => a.id);
        const defenders = eng.defenders.map((d) => d.id);
        for (const a of attackers) {
            for (const d of defenders) {
                pairs.add(`${a}:${d}`);
                pairs.add(`${d}:${a}`);
            }
        }
    }
    return pairs;
}

function pairKey(a: string, b: string): string {
    return `${a}:${b}`;
}

/** Section 8.9: interceptor vs attacker wing where attacker is on a ship attack run. */
export function attackRunInterceptPairs(
    position: FullThrustGamePosition,
    commands: FullThrustGameCommand[],
    turn: number
): Array<{ interceptorId: string; attackerId: string }> {
    const allocations = fighterAttackAllocationsFromLog(commands, turn);
    const mutual = mutuallyEngagedFighterIds(position, allocations);
    const resolvedPairs = furballPairsResolvedInLog(commands, turn);
    const board = incomingThreatsForPhase9(position, commands, turn);
    const qualifiedAttackers = new Set(
        board.fighters.filter((f) => f.kind === "shipAttack").map((f) => f.groupId)
    );

    const pairs: Array<{ interceptorId: string; attackerId: string }> = [];
    const seen = new Set<string>();
    for (const alloc of allocations) {
        if (!isAttackRunInterceptPair(alloc, allocations, position)) continue;
        if (mutual.has(alloc.groupId) || mutual.has(alloc.targetId)) continue;
        if (!qualifiedAttackers.has(alloc.targetId)) continue;
        if (resolvedPairs.has(pairKey(alloc.groupId, alloc.targetId))) continue;
        const key = pairKey(alloc.groupId, alloc.targetId);
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push({ interceptorId: alloc.groupId, attackerId: alloc.targetId });
    }
    return pairs.sort(
        (a, b) =>
            a.interceptorId.localeCompare(b.interceptorId) ||
            a.attackerId.localeCompare(b.attackerId)
    );
}

export function phase10StrikeQueue(
    position: FullThrustGamePosition,
    commands: FullThrustGameCommand[],
    turn: number
): Phase10StrikeEvent[] {
    const events: Phase10StrikeEvent[] = [];
    const pdKills = pdKillsFromPhase9Log(commands, turn);

    for (const obj of position.objects ?? []) {
        if (obj.objType !== "ordnance") continue;
        const ord = obj as OrdnanceObj;
        if (
            ord.type === "amt" &&
            (ord as { detonateOpenSpace?: boolean }).detonateOpenSpace &&
            amtStillViable(ord)
        ) {
            events.push({ kind: "amtOpenSpace", id: ord.id });
        }
    }

    for (const obj of position.objects ?? []) {
        if (obj.objType !== "ordnance") continue;
        const ord = obj as OrdnanceObj;
        if (ord.type === "plasmaBolt" && (ord.deployedTurn ?? turn) === turn) {
            events.push({ kind: "pblDetonation", id: ord.id });
        }
    }

    const board = incomingThreatsForPhase10(position, commands, turn);
    for (const o of board.ordnance) {
        const ord = findOrdnance(position, o.ordnanceId);
        if (!ord) continue;
        if (isSalvoOrdnanceType(ord.type)) {
            events.push({
                kind: "salvoStrike",
                id: o.ordnanceId,
                targetShipId: o.targetShipId,
            });
        } else if (ord.type === "missile" || ord.type === "amt") {
            if (ord.type === "amt" && (ord as { detonateOpenSpace?: boolean }).detonateOpenSpace) {
                continue;
            }
            events.push({
                kind: ord.type === "amt" ? "amtShipImpact" : "heavyMissile",
                id: o.ordnanceId,
                targetShipId: o.targetShipId,
            });
        }
    }

    for (const pair of attackRunInterceptPairs(position, commands, turn)) {
        events.push({
            kind: "attackRunIntercept",
            id: `${pair.interceptorId}_vs_${pair.attackerId}`,
            interceptorId: pair.interceptorId,
            attackerId: pair.attackerId,
        });
    }

    for (const f of board.fighters) {
        if (f.kind !== "shipAttack") continue;
        const wing = findFighter(position, f.groupId);
        if (!wing || (wing.number ?? 0) <= 0) continue;
        events.push({
            kind: "fighterShipStrike",
            id: f.groupId,
            targetShipId: f.targetShipId,
        });
    }

    for (const g of board.gunboats) {
        const squad = findGunboat(position, g.groupId);
        if (!squad || !isDeployedGunboat(squad) || (squad.number ?? 0) <= 0) continue;
        events.push({
            kind: "gunboatShipStrike",
            id: g.groupId,
            targetShipId: g.targetShipId,
        });
    }

    return events.sort((a, b) => {
        const order: Phase10StrikeKind[] = [
            "amtOpenSpace",
            "pblDetonation",
            "salvoStrike",
            "heavyMissile",
            "amtShipImpact",
            "attackRunIntercept",
            "fighterShipStrike",
            "gunboatShipStrike",
        ];
        const ka = order.indexOf(a.kind);
        const kb = order.indexOf(b.kind);
        if (ka !== kb) return ka - kb;
        return a.id.localeCompare(b.id);
    });
}

export function phase10StrikesCompleteInLog(
    commands: FullThrustGameCommand[],
    turn: number
): boolean {
    let cmdTurn = 1;
    let phase = 1;
    for (const cmd of commands) {
        if (cmd.name === "advancePhase") {
            const p = (cmd as { phase?: number }).phase;
            if (typeof p === "number") {
                phase = p;
                if (phase === 1) cmdTurn += 1;
            }
        }
        if (cmd.name === "resolvePhase10Complete" && cmdTurn === turn && phase === 10) {
            return true;
        }
    }
    return false;
}

export interface Phase10ResolveBatchResult {
    commands: FullThrustGameCommand[];
    warnings: string[];
}

/** Build per-event scrub-back commands for phase 10 (does not mutate position). */
export function buildPhase10ResolveCommands(
    position: FullThrustGamePosition,
    commands: FullThrustGameCommand[],
    turn: number,
    source: RollSource,
    diceSource: "client" | "moderatorSequence" = "client"
): Phase10ResolveBatchResult {
    const pos = structuredClone(position);
    const out: FullThrustGameCommand[] = [];
    const warnings: string[] = [];
    const queue = phase10StrikeQueue(pos, commands, turn);
    const pdKills = pdKillsFromPhase9Log(commands, turn);

    for (const event of queue) {
        const cmds = resolvePhase10EventCommands(
            pos,
            event,
            source,
            pdKills,
            diceSource,
            warnings
        );
        out.push(...cmds);
        for (const cmd of cmds) {
            if (
                cmd.name === "detonateOrdnance" ||
                cmd.name === "strikeOrdnance" ||
                cmd.name === "attackRunIntercept" ||
                cmd.name === "fighterShipStrike"
            ) {
                applyPhase10StrikeCommand(pos, cmd);
            } else if (cmd.name === "dmgShip" && cmd.ship) {
                const ship = findShip(pos, cmd.ship);
                if (ship) {
                    ship.dmgHull = (ship.dmgHull ?? 0) + (cmd.hull ?? 0);
                }
            } else if (cmd.name === "adjustFighters" && cmd.id) {
                const f = findFighter(pos, cmd.id);
                if (f) {
                    if (cmd.number !== undefined) f.number = cmd.number;
                    if (cmd.endurance !== undefined) f.endurance = cmd.endurance;
                }
            } else if (cmd.name === "objDestroy" && "uuid" in cmd) {
                const id = (cmd as { uuid?: string }).uuid;
                if (id) pos.objects = (pos.objects ?? []).filter((o) => o.id !== id);
            }
        }
    }

    out.push({
        name: "resolvePhase10Complete",
        count: queue.length,
    } as FullThrustGameCommand);

    return { commands: out, warnings };
}

function resolvePhase10EventCommands(
    position: FullThrustGamePosition,
    event: Phase10StrikeEvent,
    source: RollSource,
    pdKills: Record<string, number>,
    diceSource: "client" | "moderatorSequence",
    warnings: string[]
): FullThrustGameCommand[] {
    const cmds: FullThrustGameCommand[] = [];
    switch (event.kind) {
        case "amtOpenSpace":
            return buildDetonateOrdnanceCommands(position, event.id, "amtOpenSpace", source, diceSource);
        case "pblDetonation":
            return buildDetonateOrdnanceCommands(position, event.id, "pbl", source, diceSource);
        case "salvoStrike":
            return buildStrikeOrdnanceCommands(
                position,
                event.id,
                event.targetShipId!,
                "salvo",
                source,
                pdKills[event.id] ?? 0,
                diceSource
            );
        case "heavyMissile":
            return buildStrikeOrdnanceCommands(
                position,
                event.id,
                event.targetShipId!,
                "heavy",
                source,
                0,
                diceSource
            );
        case "amtShipImpact":
            return buildStrikeOrdnanceCommands(
                position,
                event.id,
                event.targetShipId!,
                "amtImpact",
                source,
                0,
                diceSource
            );
        case "attackRunIntercept":
            return buildAttackRunInterceptCommands(
                position,
                event.interceptorId!,
                event.attackerId!,
                source,
                diceSource
            );
        case "fighterShipStrike":
            return buildFighterShipStrikeCommands(
                position,
                event.id,
                event.targetShipId!,
                source,
                diceSource
            );
        case "gunboatShipStrike":
            return buildGunboatShipStrikeCommands(
                position,
                event.id,
                event.targetShipId!,
                source,
                diceSource
            );
        default:
            warnings.push(`Unknown phase 10 event: ${(event as Phase10StrikeEvent).kind}`);
            return cmds;
    }
}

function buildDetonateOrdnanceCommands(
    position: FullThrustGamePosition,
    ordnanceId: string,
    mode: "amtOpenSpace" | "pbl",
    source: RollSource,
    diceSource: "client" | "moderatorSequence"
): FullThrustGameCommand[] {
    const mark = source.mark();
    const blast =
        mode === "amtOpenSpace"
            ? resolveAmtOpenSpaceBlast(position, ordnanceId, source)
            : resolvePblDetonationBlast(position, ordnanceId, source);
    const rolls = source.consumedSince(mark);
    const purpose =
        mode === "amtOpenSpace"
            ? `phase10: AMT open-space ${ordnanceId}`
            : `phase10: PBL ${ordnanceId}`;
    const cmds: FullThrustGameCommand[] = [
        {
            name: "logDice",
            purpose,
            rolls,
            source: diceSource,
            result: blast.summary,
        } as FullThrustGameCommand,
        {
            name: "detonateOrdnance",
            ordnanceId,
            mode,
            rolls,
        } as FullThrustGameCommand,
    ];
    for (const hit of blast.hits) {
        if (hit.objectType === "ship" && hit.normalDamage !== undefined) {
            const ship = findShip(position, hit.objectId);
            if (ship) {
                const applied = computeShipDamageApplication(
                    ship,
                    hit.normalDamage,
                    hit.penetratingDamage ?? 0,
                    "standard"
                );
                if (applied) pushAppliedHullDamageCommands(cmds, hit.objectId, ship, applied);
            }
        } else if (hit.objectType === "fighters" && hit.fighterCasualties) {
            const f = findFighter(position, hit.objectId);
            if (f) {
                const after = Math.max(0, (f.number ?? 6) - hit.fighterCasualties);
                cmds.push({
                    name: "adjustFighters",
                    id: hit.objectId,
                    number: after,
                } as FullThrustGameCommand);
            }
        }
    }
    cmds.push({
        name: "objDestroy",
        uuid: ordnanceId,
    } as FullThrustGameCommand);
    cmds.push({
        name: "_custom",
        msg: blast.summary,
    } as FullThrustGameCommand);
    return cmds;
}

function buildStrikeOrdnanceCommands(
    position: FullThrustGamePosition,
    ordnanceId: string,
    targetShipId: string,
    mode: "salvo" | "heavy" | "amtImpact",
    source: RollSource,
    pdKills: number,
    diceSource: "client" | "moderatorSequence"
): FullThrustGameCommand[] {
    const mark = source.mark();
    const cmds: FullThrustGameCommand[] = [];
    let summary = "";
    let rolls: number[] = [];

    if (mode === "salvo") {
        const attackRoll = source.next();
        const missilesOnTarget = Math.max(1, Math.min(6, Math.round(attackRoll)));
        const survivors = Math.max(0, missilesOnTarget - pdKills);
        const sapRolls: number[] = [];
        for (let i = 0; i < survivors; i++) sapRolls.push(source.next());
        rolls = [attackRoll, ...sapRolls];
        const result = resolveSalvoStrike(attackRoll, pdKills, sapRolls);
        summary = `Salvo ${ordnanceId} → ${targetShipId}: ${result.totalSap} SAP`;
        const target = findShip(position, targetShipId);
        if (target && result.totalSap > 0) {
            const applied = computeShipDamageApplication(target, result.totalSap, 0, "SAP");
            if (applied) pushAppliedHullDamageCommands(cmds, targetShipId, target, applied);
        }
    } else if (mode === "heavy") {
        const sapRolls = [source.next(), source.next(), source.next()];
        rolls = sapRolls;
        const result = resolveHeavyMissile(sapRolls);
        summary = `Heavy missile ${ordnanceId} → ${targetShipId}: ${result.totalSap} SAP`;
        const target = findShip(position, targetShipId);
        if (target && result.totalSap > 0) {
            const applied = computeShipDamageApplication(target, result.totalSap, 0, "SAP");
            if (applied) pushAppliedHullDamageCommands(cmds, targetShipId, target, applied);
        }
    } else {
        const blast = resolveAmtShipImpactBlast(position, ordnanceId, targetShipId, source);
        rolls = blast.rolls;
        summary = blast.summary;
        for (const hit of blast.hits) {
            const ship = findShip(position, hit.objectId);
            if (ship && hit.normalDamage !== undefined) {
                const applied = computeShipDamageApplication(
                    ship,
                    hit.normalDamage,
                    hit.penetratingDamage ?? 0,
                    "standard"
                );
                if (applied) pushAppliedHullDamageCommands(cmds, hit.objectId, ship, applied);
            }
        }
    }

    rolls = source.consumedSince(mark);
    const purpose = `phase10: ${mode} ${ordnanceId} → ${targetShipId}`;
    return [
        {
            name: "logDice",
            purpose,
            rolls,
            source: diceSource,
            result: summary,
        } as FullThrustGameCommand,
        {
            name: "strikeOrdnance",
            ordnanceId,
            targetShipId,
            mode,
            rolls,
            pdKills: mode === "salvo" ? pdKills : undefined,
        } as FullThrustGameCommand,
        ...cmds,
        { name: "objDestroy", uuid: ordnanceId } as FullThrustGameCommand,
        { name: "_custom", msg: summary } as FullThrustGameCommand,
    ];
}

function buildAttackRunInterceptCommands(
    position: FullThrustGamePosition,
    interceptorId: string,
    attackerId: string,
    source: RollSource,
    diceSource: "client" | "moderatorSequence"
): FullThrustGameCommand[] {
    const interceptor = findFighter(position, interceptorId);
    const attacker = findFighter(position, attackerId);
    if (!interceptor || !attacker) return [];

    const mark = source.mark();
    const intResult = resolveDogfightSideRolls(
        interceptor.number ?? 6,
        isFighterExhausted(interceptor),
        source
    );
    const rolls = source.consumedSince(mark);
    const kills = Math.min(intResult.killsDealt, attacker.number ?? 6);
    const after = Math.max(0, (attacker.number ?? 6) - kills);
    const summary = `Attack-run intercept: ${interceptorId} → ${attackerId}: ${kills} kill(s)`;

    return [
        {
            name: "logDice",
            purpose: `phase10: intercept ${interceptorId} vs ${attackerId}`,
            rolls,
            source: diceSource,
            result: summary,
        } as FullThrustGameCommand,
        {
            name: "attackRunIntercept",
            interceptorId,
            attackerId,
            rolls,
        } as FullThrustGameCommand,
        {
            name: "adjustFighters",
            id: attackerId,
            number: after,
        } as FullThrustGameCommand,
        {
            name: "adjustFighters",
            id: interceptorId,
            endurance: nextEnduranceAfterCombat(interceptor.endurance),
        } as FullThrustGameCommand,
        { name: "_custom", msg: summary } as FullThrustGameCommand,
    ];
}

function buildFighterShipStrikeCommands(
    position: FullThrustGamePosition,
    groupId: string,
    targetShipId: string,
    source: RollSource,
    diceSource: "client" | "moderatorSequence"
): FullThrustGameCommand[] {
    const fighter = findFighter(position, groupId);
    const target = findShip(position, targetShipId);
    if (!fighter || !target || (fighter.number ?? 0) <= 0) return [];

    const mark = source.mark();
    const screens = shipScreens(target);
    const wing = fighterWingFromObj(fighter);
    const profile = fighterProfileFor(wing);
    const weaponMode = (fighter as { weaponMode?: "beam" | "cannon" }).weaponMode;
    const result = resolveFighterStrikeWithProfile(
        fighter.number ?? 6,
        screens as 0 | 1 | 2,
        profile,
        "ship",
        weaponMode,
        source
    );
    const rolls = source.consumedSince(mark);
    const label = fighterGroupLabel(fighter);
    const summary = `Fighter strike: ${label} → ${targetShipId}: ${result.totalDamage} damage`;

    const cmds: FullThrustGameCommand[] = [
        {
            name: "logDice",
            purpose: `phase10: fighter ${groupId} → ${targetShipId}`,
            rolls,
            source: diceSource,
            result: summary,
        } as FullThrustGameCommand,
        {
            name: "fighterShipStrike",
            groupId,
            targetShipId,
            rolls,
        } as FullThrustGameCommand,
    ];
    if (result.totalDamage > 0) {
        const applied = computeShipDamageApplication(
            target,
            result.normalDamage,
            result.penetratingDamage,
            "standard"
        );
        if (applied) pushAppliedHullDamageCommands(cmds, targetShipId, target, applied);
    }
    cmds.push({
        name: "adjustFighters",
        id: groupId,
        endurance: nextEnduranceAfterFighterAttack(fighter.endurance, wing),
    } as FullThrustGameCommand);
    cmds.push({ name: "_custom", msg: summary } as FullThrustGameCommand);
    return cmds;
}

function buildGunboatShipStrikeCommands(
    position: FullThrustGamePosition,
    groupId: string,
    targetShipId: string,
    source: RollSource,
    diceSource: "client" | "moderatorSequence"
): FullThrustGameCommand[] {
    const gunboat = findGunboat(position, groupId);
    const target = findShip(position, targetShipId);
    if (!gunboat || !target || (gunboat.number ?? 0) <= 0) return [];

    const gpos = gunboat.position as { x: number; y: number };
    const tpos = target.position as { x: number; y: number };
    const dist =
        gpos && tpos && "x" in gpos && "x" in tpos ? distance(gpos, tpos) : 12;
    const screens = shipScreens(target);
    const ctx = {
        protection: (gunboat as { protection?: "heavy" | "screened" }).protection,
        ecm: (gunboat as { ecm?: number }).ecm,
    };
    void gunboatProtectionDrm(ctx);

    const mark = source.mark();
    let normalDamage = 0;
    let penetratingDamage = 0;
    for (const boat of liveGunboatBoats(gunboat)) {
        const prof = gunboatBoatProfile(boat.type);
        const hit = resolveGunboatBoatStrike(prof, screens as 0 | 1 | 2, dist, source);
        normalDamage += hit.normalDamage;
        penetratingDamage += hit.penetratingDamage;
    }
    const rolls = source.consumedSince(mark);
    const totalDamage = normalDamage + penetratingDamage;
    const label = gunboatGroupLabel(gunboat);
    const summary = `Gunboat strike: ${label} → ${targetShipId}: ${totalDamage} damage`;

    const cmds: FullThrustGameCommand[] = [
        {
            name: "logDice",
            purpose: `phase10: gunboat ${groupId} → ${targetShipId}`,
            rolls,
            source: diceSource,
            result: summary,
        } as FullThrustGameCommand,
        {
            name: "gunboatShipStrike",
            groupId,
            targetShipId,
            rolls,
        } as FullThrustGameCommand,
    ];
    if (totalDamage > 0) {
        const applied = computeShipDamageApplication(
            target,
            normalDamage,
            penetratingDamage,
            "standard"
        );
        if (applied) pushAppliedHullDamageCommands(cmds, targetShipId, target, applied);
    }
    cmds.push({
        name: "adjustGunboats",
        id: groupId,
        endurance: Math.max(0, (gunboat.endurance ?? 6) - 1),
    } as FullThrustGameCommand);
    cmds.push({ name: "_custom", msg: summary } as FullThrustGameCommand);
    return cmds;
}

/** Apply a single phase-10 strike command during replay. */
export function applyPhase10StrikeCommand(
    position: FullThrustGamePosition,
    cmd: FullThrustGameCommand
): void {
    switch (cmd.name) {
        case "detonateOrdnance": {
            const c = cmd as { ordnanceId?: string; mode?: string; rolls?: number[] };
            if (!c.ordnanceId || !c.rolls?.length) return;
            if (c.mode === "pbl") {
                resolvePblDetonationBlastFromRolls(position, c.ordnanceId, c.rolls);
            } else {
                resolveAmtOpenSpaceBlastFromRolls(position, c.ordnanceId, c.rolls);
            }
            position.objects = (position.objects ?? []).filter((o) => o.id !== c.ordnanceId);
            break;
        }
        case "strikeOrdnance": {
            const c = cmd as {
                ordnanceId?: string;
                targetShipId?: string;
                mode?: string;
                rolls?: number[];
                pdKills?: number;
            };
            if (!c.ordnanceId || !c.rolls?.length) return;
            if (c.mode === "amtImpact" && c.targetShipId) {
                resolveAmtShipImpactBlastFromRolls(
                    position,
                    c.ordnanceId,
                    c.targetShipId,
                    c.rolls
                );
            } else if (c.mode === "salvo" && c.targetShipId) {
                const attackRoll = c.rolls[0];
                const pdK = c.pdKills ?? 0;
                const survivors = Math.max(0, Math.min(6, attackRoll) - pdK);
                resolveSalvoStrike(attackRoll, pdK, c.rolls.slice(1, 1 + survivors));
                const ord = findOrdnance(position, c.ordnanceId);
                if (ord) applySalvoMissileKills(ord, survivors);
            }
            position.objects = (position.objects ?? []).filter((o) => o.id !== c.ordnanceId);
            break;
        }
        case "attackRunIntercept": {
            const c = cmd as { interceptorId?: string; attackerId?: string; rolls?: number[] };
            if (!c.interceptorId || !c.attackerId || !c.rolls?.length) return;
            const interceptor = findFighter(position, c.interceptorId);
            const attacker = findFighter(position, c.attackerId);
            if (!interceptor || !attacker) return;
            const source = arrayRollSource(c.rolls);
            const intResult = resolveDogfightSideRolls(
                interceptor.number ?? 6,
                isFighterExhausted(interceptor),
                source
            );
            const kills = Math.min(intResult.killsDealt, attacker.number ?? 6);
            attacker.number = Math.max(0, (attacker.number ?? 6) - kills);
            interceptor.endurance = nextEnduranceAfterCombat(interceptor.endurance);
            break;
        }
        case "fighterShipStrike": {
            const c = cmd as { groupId?: string; targetShipId?: string; rolls?: number[] };
            if (!c.groupId || !c.rolls?.length) return;
            const fighter = findFighter(position, c.groupId);
            if (!fighter) return;
            const target = c.targetShipId ? findShip(position, c.targetShipId) : undefined;
            const screens = target ? shipScreens(target) : 0;
            const wing = fighterWingFromObj(fighter);
            const profile = fighterProfileFor(wing);
            resolveFighterStrikeWithProfile(
                fighter.number ?? 6,
                screens as 0 | 1 | 2,
                profile,
                "ship",
                (fighter as { weaponMode?: "beam" | "cannon" }).weaponMode,
                arrayRollSource(c.rolls)
            );
            fighter.endurance = nextEnduranceAfterFighterAttack(fighter.endurance, wing);
            break;
        }
        case "gunboatShipStrike": {
            const c = cmd as { groupId?: string; targetShipId?: string; rolls?: number[] };
            if (!c.groupId || !c.rolls?.length) return;
            const gunboat = findGunboat(position, c.groupId);
            if (!gunboat) return;
            gunboat.endurance = Math.max(0, (gunboat.endurance ?? 6) - 1);
            break;
        }
    }
}
