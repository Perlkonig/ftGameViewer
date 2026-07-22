/** Phase 13 threshold target enumeration and resolution. */

import type { FullThrustGameCommand } from "@/schemas/commands";
import type { FullThrustGamePosition } from "@/schemas/position";
import type { GameMeta } from "./types";
import { coreSystemsInThresholdEnabled } from "./types";
import type { ShipWithBoarders } from "./boardingState";
import { listShipSystems, isSingleUseOrdnanceRack, type ShipSystemEntry } from "./shipSystems";
import {
    pendingThresholdList,
    systemFailsThreshold,
    type PendingThreshold,
} from "./thresholds";
import {
    buildFragileSensorThresholdCommands,
    fragileSensorEntries,
    resolveFragileSensorThresholds,
    type FragileSensorOutcome,
} from "./needleFire";
import { resolveAmtRackThresholdExplosion } from "./ordnanceBlast";
import { createDiceFromPolicy, type RollSource } from "./dice";

export interface ThresholdTarget {
    id: string;
    label: string;
    kind: "drive" | "weapon" | "system" | "magazine" | "hangar" | "core" | "boarder";
    permanent?: boolean;
}

type ShipObj = FullThrustGamePosition["objects"][number] & {
    objType: "ship";
    pendingThreshold?: PendingThreshold;
    pendingThresholds?: PendingThreshold[];
    thresholdRowsResolved?: number;
    systems?: { id: string; state?: string }[];
    coreState?: {
        powerless?: boolean;
        lifeless?: number;
        uncontrolled?: number;
    };
    boarders?: ShipWithBoarders["boarders"];
};

function isDestroyed(ship: ShipObj, id: string): boolean {
    return ship.systems?.find((s) => s.id === id)?.state === "destroyed";
}

function isDamagedOrDestroyed(ship: ShipObj, id: string): boolean {
    const state = ship.systems?.find((s) => s.id === id)?.state;
    return state === "damaged" || state === "destroyed";
}

function coreKnockedOut(ship: ShipObj, coreId: string): boolean {
    const cs = ship.coreState;
    if (!cs) return false;
    if (coreId === "_corePower") return !!cs.powerless;
    if (coreId === "_coreBridge") return (cs.uncontrolled ?? 0) > 0;
    if (coreId === "_coreLife") return (cs.lifeless ?? 0) > 0;
    return false;
}

function entryLabel(entry: ShipSystemEntry): string {
    return entry.name || entry.id;
}

function classifyKind(entry: ShipSystemEntry): ThresholdTarget["kind"] {
    const n = (entry.name ?? "").toLowerCase();
    if (n === "drive") return "drive";
    if (n === "magazine") return "magazine";
    if (n === "hangar") return "hangar";
    if (n === "marines" || n === "marine") return "system";
    if (n === "damagecontrol" || n === "damage control") return "system";
    if (entry.type === "weapon" || entry.type === "ordnance") return "weapon";
    return "system";
}

function isPermanentTarget(entry: ShipSystemEntry): boolean {
    const n = (entry.name ?? "").toLowerCase();
    return (
        n === "magazine" ||
        n === "hangar" ||
        n === "marines" ||
        n === "marine" ||
        n === "damagecontrol" ||
        n === "damage control" ||
        isSingleUseOrdnanceRack(entry)
    );
}

function isAmtRackTarget(ship: ShipObj, targetId: string): boolean {
    const entry = listShipSystems(ship).find((e) => e.id === targetId);
    return (entry?.name ?? "").toLowerCase() === "amt";
}

/** Invader boarder units eligible for threshold (not boarded this turn). */
export function boarderTargetsForShip(ship: ShipObj, turn: number): ThresholdTarget[] {
    const targets: ThresholdTarget[] = [];
    for (const unit of ship.boarders?.units ?? []) {
        if (unit.boardedTurn === turn) continue;
        const typeLabel = unit.type === "marine" ? "Marine" : "DCP";
        targets.push({
            id: unit.id,
            label: `${typeLabel} invader (${unit.owner})`,
            kind: "boarder",
            permanent: true,
        });
    }
    return targets;
}

/** Enumerate one d6 target per surviving system (magazine deduped) plus invaders. */
export function thresholdTargetsForShip(
    ship: ShipObj,
    meta: GameMeta,
    turn = meta.turn
): ThresholdTarget[] {
    const targets: ThresholdTarget[] = [];
    const seenMagazines = new Set<string>();
    const entries = listShipSystems(ship);

    for (const entry of entries) {
        if (isDestroyed(ship, entry.id)) continue;

        const kind = classifyKind(entry);
        const magazineRef = (entry as { magazine?: string }).magazine;

        if ((entry.name ?? "").toLowerCase() === "sensors") continue;

        if (kind === "magazine") {
            if (seenMagazines.has(entry.id)) continue;
            seenMagazines.add(entry.id);
            targets.push({
                id: entry.id,
                label: entryLabel(entry),
                kind: "magazine",
                permanent: true,
            });
            continue;
        }

        if (magazineRef) {
            if (!seenMagazines.has(magazineRef) && !isDestroyed(ship, magazineRef)) {
                seenMagazines.add(magazineRef);
                const magEntry = entries.find((e) => e.id === magazineRef);
                targets.push({
                    id: magazineRef,
                    label: magEntry ? entryLabel(magEntry) : magazineRef,
                    kind: "magazine",
                    permanent: true,
                });
            }
            continue;
        }

        targets.push({
            id: entry.id,
            label: entryLabel(entry),
            kind,
            permanent: isPermanentTarget(entry),
        });
    }

    if (coreSystemsInThresholdEnabled(meta)) {
        for (const core of [
            { id: "_coreBridge", label: "Bridge" },
            { id: "_coreLife", label: "Life support" },
            { id: "_corePower", label: "Reactor" },
        ]) {
            if (!coreKnockedOut(ship, core.id)) {
                targets.push({ id: core.id, label: core.label, kind: "core" });
            }
        }
    }

    targets.push(...boarderTargetsForShip(ship, turn));

    return targets;
}

export interface ThresholdCheckDice {
    shipId: string;
    dice: number;
    systemDice: number;
    sensorDice: number;
    failOn: number;
    rollBonus: number;
    thresholdIndex: number;
    pending: PendingThreshold;
    targets: ThresholdTarget[];
}

export interface ThresholdDiceSummary {
    total: number;
    checks: ThresholdCheckDice[];
    /** @deprecated Use checks — kept for hints that grouped per ship. */
    perShip: {
        shipId: string;
        dice: number;
        failOn: number;
        rollBonus: number;
        pending: PendingThreshold;
        targets: ThresholdTarget[];
    }[];
}

export function shipsPendingThreshold(position: FullThrustGamePosition): ShipObj[] {
    return position.objects.filter(
        (o): o is ShipObj =>
            o.objType === "ship" && pendingThresholdList(o as ShipObj).length > 0
    );
}

export function thresholdDiceCount(
    position: FullThrustGamePosition,
    meta: GameMeta
): ThresholdDiceSummary {
    const checks: ThresholdCheckDice[] = [];
    for (const ship of shipsPendingThreshold(position)) {
        for (const pending of pendingThresholdList(ship)) {
            const targets = thresholdTargetsForShip(ship, meta);
            const sensorDice = fragileSensorEntries(ship).length;
            const systemDice = targets.length;
            checks.push({
                shipId: ship.id,
                dice: systemDice + sensorDice,
                systemDice,
                sensorDice,
                failOn: pending.failOnOrAbove,
                rollBonus: pending.rollBonus,
                thresholdIndex: pending.thresholdIndex,
                pending,
                targets,
            });
        }
    }
    const perShipMap = new Map<string, ThresholdCheckDice>();
    for (const check of checks) {
        const prev = perShipMap.get(check.shipId);
        if (!prev) perShipMap.set(check.shipId, { ...check, dice: check.dice });
        else prev.dice += check.dice;
    }
    return {
        total: checks.reduce((n, s) => n + s.dice, 0),
        checks,
        perShip: [...perShipMap.values()],
    };
}

export interface ThresholdRollOutcome {
    target: ThresholdTarget;
    roll: number;
    effectiveRoll: number;
    failed: boolean;
    outcome: string;
}

function driveThrust(entry: ShipSystemEntry): number {
    return (entry as { thrust?: number }).thrust ?? 2;
}

function driveFailState(ship: ShipObj, driveId: string): "damaged" | "destroyed" {
    const thrust = driveThrust(
        listShipSystems(ship).find((e) => e.id === driveId) ?? { id: driveId, name: "drive" }
    );
    if (isDamagedOrDestroyed(ship, driveId)) return "destroyed";
    if (thrust <= 1) return "destroyed";
    return "damaged";
}

export function resolveThresholdRolls(
    ship: ShipObj,
    meta: GameMeta,
    rolls: number[],
    failOn: number,
    rollBonus: number
): ThresholdRollOutcome[] {
    const targets = thresholdTargetsForShip(ship, meta);
    const outcomes: ThresholdRollOutcome[] = [];
    for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        const roll = rolls[i] ?? 1;
        const effectiveRoll = Math.min(6, roll + rollBonus);
        const failed = systemFailsThreshold(roll, failOn, rollBonus);
        let outcome = "pass";
        if (failed) {
            if (target.kind === "boarder") {
                outcome = "invader removed";
            } else if (target.kind === "drive") {
                outcome = driveFailState(ship, target.id) === "destroyed" ? "destroyed" : "damaged (half thrust)";
            } else if (target.permanent || target.kind === "magazine" || target.kind === "hangar") {
                outcome = "destroyed";
            } else if (target.kind === "core") {
                outcome = "core knocked out";
            } else {
                outcome = "damaged";
            }
            if (target.kind === "hangar") {
                outcome += " (fighters — moderator adjudicates)";
            }
        }
        outcomes.push({ target, roll, effectiveRoll, failed, outcome });
    }
    return outcomes;
}

export interface ThresholdResolveContext {
    position: FullThrustGamePosition;
    rollSource: RollSource;
}

export function buildThresholdResolveCommands(
    ship: ShipObj,
    outcomes: ThresholdRollOutcome[],
    rolls: number[],
    thresholdIndex: number,
    ctx?: ThresholdResolveContext,
    sensorOutcomes?: FragileSensorOutcome[],
    sensorRolls?: number[]
): FullThrustGameCommand[] {
    const cmds: FullThrustGameCommand[] = [];
    const lines: string[] = [];
    const shipId = ship.id;

    for (const o of outcomes) {
        const tag = o.failed ? "FAIL" : "pass";
        lines.push(`${o.target.label} (${o.target.id}): d6=${o.roll}→${o.effectiveRoll} ${tag} — ${o.outcome}`);
        if (!o.failed) continue;

        if (o.target.kind === "boarder") {
            cmds.push({
                name: "removeBoarders",
                ship: shipId,
                unitIds: [o.target.id],
            } as FullThrustGameCommand);
            continue;
        }

        if (o.target.kind === "core") {
            if (o.target.id === "_corePower") {
                cmds.push({ name: "setCoreState", ship: shipId, powerless: true } as FullThrustGameCommand);
            } else if (o.target.id === "_coreBridge") {
                cmds.push({ name: "setCoreState", ship: shipId, uncontrolled: 1 } as FullThrustGameCommand);
            } else if (o.target.id === "_coreLife") {
                cmds.push({ name: "setCoreState", ship: shipId, lifeless: 1 } as FullThrustGameCommand);
            }
            continue;
        }

        const state =
            o.target.kind === "drive"
                ? driveFailState(ship, o.target.id)
                : o.target.permanent || o.target.kind === "magazine" || o.target.kind === "hangar"
                  ? "destroyed"
                  : "damaged";

        cmds.push({
            name: "sysDisable",
            ship: shipId,
            system: o.target.id,
            state,
        } as FullThrustGameCommand);

        if (ctx && isAmtRackTarget(ship, o.target.id)) {
            const blast = resolveAmtRackThresholdExplosion(
                ctx.position,
                shipId,
                o.target.id,
                ctx.rollSource
            );
            cmds.push(...blast.commands);
            if (blast.summary) lines.push(`AMT explosion: ${blast.summary}`);
        }
    }

    if (sensorOutcomes?.length) {
        cmds.push(...buildFragileSensorThresholdCommands(shipId, sensorOutcomes));
        for (const so of sensorOutcomes) {
            const tag = so.failed ? "FAIL" : "pass";
            const detail = so.state ? ` — ${so.state}` : "";
            lines.push(
                `Sensor ${so.label} (${so.sensorId}): d6=${so.roll}→${so.effectiveRoll} ${tag}${detail}`
            );
        }
    }

    const allRolls = [...rolls, ...(sensorRolls ?? [])];
    cmds.push({
        name: "logDice",
        purpose: `threshold→${shipId}`,
        rolls: allRolls,
    } as FullThrustGameCommand);

    cmds.push({
        name: "_custom",
        text: `Threshold check ${shipId} (row ${thresholdIndex}): ${lines.join("; ")}`,
    } as FullThrustGameCommand);

    cmds.push({
        name: "resolveThresholdCheck",
        ship: shipId,
        rolls: allRolls,
        thresholdIndex,
    } as FullThrustGameCommand);

    return cmds;
}

export function buildAllThresholdResolveCommands(
    position: FullThrustGamePosition,
    meta: GameMeta,
    allRolls: number[]
): FullThrustGameCommand[] {
    const summary = thresholdDiceCount(position, meta);
    const cmds: FullThrustGameCommand[] = [];
    let offset = 0;
    const fallback = createDiceFromPolicy(meta.dicePolicy, { seed: meta.diceSeed });

    const explosionSource: RollSource = {
        mark: () => offset,
        next: () => {
            if (offset < allRolls.length) return allRolls[offset++];
            return fallback.roll(1).rolls[0] ?? 1;
        },
        consumedSince: (mark) => allRolls.slice(mark, Math.min(offset, allRolls.length)),
    };

    for (const check of summary.checks) {
        const ship = position.objects.find(
            (o) => o.objType === "ship" && o.id === check.shipId
        ) as ShipObj | undefined;
        if (!ship) continue;

        const systemRolls = allRolls.slice(offset, offset + check.systemDice);
        offset += check.systemDice;
        const sensorRolls = allRolls.slice(offset, offset + check.sensorDice);
        offset += check.sensorDice;

        const outcomes = resolveThresholdRolls(
            ship,
            meta,
            systemRolls,
            check.failOn,
            check.rollBonus
        );
        const sensorOutcomes = resolveFragileSensorThresholds(
            ship,
            sensorRolls,
            check.failOn,
            check.rollBonus
        );
        cmds.push(
            ...buildThresholdResolveCommands(
                ship,
                outcomes,
                systemRolls,
                check.thresholdIndex,
                { position, rollSource: explosionSource },
                sensorOutcomes,
                sensorRolls
            )
        );
    }

    return cmds;
}
