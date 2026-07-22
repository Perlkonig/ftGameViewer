/** Phase 12 boarding combat resolution (per-unit DCP + Marine model). */

import type { FullThrustGameCommand } from "@/schemas/commands";
import type { RollSource } from "./dice";
import {
    boarderUnitsOnShip,
    removeBoarderUnits,
    attackerOwnersOnShip,
    type BoarderUnit,
    type ShipWithBoarders,
} from "./boardingState";
import { boardingNotesFromCommand, BOARDING_STEP_LABELS, type BoardingOrdersV2 } from "./boardingOrders";
import { availableMarineIds } from "./crewDeployment";
import { formatBoardingCombatNotes } from "./rollResults";

export interface BoardingCombatResult {
    killedByDcp: number;
    killedByDefenderMarines: number;
    defenderMarinesKilled: number;
    hullDamage: number;
    notes: string[];
    removedUnitIds: string[];
    defenderMarineCasualtyIds: string[];
}

export interface BoardingCombatInput {
    defenderShip: ShipWithBoarders;
    attackerOrders: BoardingOrdersV2[];
    defenderOrders: BoardingOrdersV2[];
    dice: { dcp: number[]; combat: number[] };
}

function allocationForUnit(
    unitId: string,
    attackerOrders: BoardingOrdersV2[]
): "kill" | "raze" | undefined {
    for (const order of attackerOrders) {
        if (order.role !== "attacker") continue;
        const alloc = order.unitAllocations?.find((a) => a.unitId === unitId);
        if (alloc) return alloc.allocation;
    }
    return undefined;
}

export function boardingCombatDiceCount(
    defenderShip: ShipWithBoarders,
    attackerOrders: BoardingOrdersV2[],
    defenderOrders: BoardingOrdersV2[]
): { dcp: number; combat: number; total: number } {
    const units = boarderUnitsOnShip(defenderShip);
    if (units.length === 0) return { dcp: 0, combat: 0, total: 0 };

    const defender = defenderOrders[0];
    const dcpTargets = (defender?.dcpRepel ?? []).filter((a) => a.dcp > 0);
    const dcp = dcpTargets.length;

    const livingIds = new Set(units.map((u) => u.id));
    let combat = 0;
    for (const m of defender?.marineFight ?? []) {
        if (livingIds.has(m.boarderId)) combat += 1;
    }
    for (const u of units) {
        const alloc = allocationForUnit(u.id, attackerOrders);
        if (alloc === "kill") combat += 1;
    }
    return { dcp, combat, total: dcp + combat };
}

export function resolveBoardingCombat(input: BoardingCombatInput): BoardingCombatResult {
    const notes: string[] = [];
    let units = [...boarderUnitsOnShip(input.defenderShip)];
    const living = () => new Set(units.map((u) => u.id));
    const defenderOrder = input.defenderOrders[0];

    const removedUnitIds: string[] = [];
    let killedByDcp = 0;
    let dcpRollIdx = 0;

    for (const repel of defenderOrder?.dcpRepel ?? []) {
        if (repel.dcp <= 0) continue;
        if (!living().has(repel.boarderId)) continue;
        const roll = input.dice.dcp[dcpRollIdx++] ?? 0;
        if (roll <= repel.dcp) {
            units = units.filter((u) => u.id !== repel.boarderId);
            removedUnitIds.push(repel.boarderId);
            killedByDcp += 1;
        }
    }
    const dcpAttempts = (defenderOrder?.dcpRepel ?? []).filter((a) => a.dcp > 0).length;
    if (dcpAttempts > 0) {
        notes.push(
            `${BOARDING_STEP_LABELS.dcpRepel}: ${dcpAttempts} roll(s) → ${killedByDcp} boarder(s) removed`
        );
    }

    const boarderHits = new Map<string, number>();
    let defenderMarinesKilled = 0;
    let killedByDefenderMarines = 0;
    let combatRollIdx = 0;
    const aliveAfterDcp = living();

    for (const fight of defenderOrder?.marineFight ?? []) {
        if (!aliveAfterDcp.has(fight.boarderId)) continue;
        const roll = input.dice.combat[combatRollIdx++] ?? 0;
        if (roll >= 4) {
            boarderHits.set(fight.boarderId, (boarderHits.get(fight.boarderId) ?? 0) + 1);
        }
    }

    let attackerKillHits = 0;
    for (const u of units) {
        const alloc = allocationForUnit(u.id, input.attackerOrders);
        if (alloc !== "kill") continue;
        const roll = input.dice.combat[combatRollIdx++] ?? 0;
        if (roll >= 4) attackerKillHits += 1;
    }

    const defenderMarineIds = availableMarineIds(input.defenderShip);
    defenderMarinesKilled = Math.min(attackerKillHits, defenderMarineIds.length);
    const defenderMarineCasualtyIds = defenderMarineIds.slice(0, defenderMarinesKilled);

    for (const [boarderId, hits] of boarderHits) {
        if (hits >= 1 && units.some((u) => u.id === boarderId)) {
            units = units.filter((u) => u.id !== boarderId);
            if (!removedUnitIds.includes(boarderId)) removedUnitIds.push(boarderId);
            killedByDefenderMarines += 1;
        }
    }

    if (
        (defenderOrder?.marineFight ?? []).some((m) => aliveAfterDcp.has(m.boarderId)) ||
        attackerKillHits > 0
    ) {
        notes.push(
            `${BOARDING_STEP_LABELS.resolveCombat}: defender marines killed ${killedByDefenderMarines} boarder(s); attackers killed ${defenderMarinesKilled} defender marine(s)`
        );
    }

    let hullDamage = 0;
    for (const u of units) {
        const alloc = allocationForUnit(u.id, input.attackerOrders);
        if (alloc === "raze") hullDamage += 1;
    }
    notes.push(
        `${BOARDING_STEP_LABELS.raze}: ${hullDamage} hull box(es) from raze-assigned survivors`
    );

    return {
        killedByDcp,
        killedByDefenderMarines,
        defenderMarinesKilled,
        hullDamage,
        notes,
        removedUnitIds,
        defenderMarineCasualtyIds,
    };
}

function captureOwnerForShip(
    ship: ShipWithBoarders,
    attackerOrders: BoardingOrdersV2[]
): string | undefined {
    const owners = attackerOwnersOnShip(ship);
    if (owners.length === 1) return owners[0];
    const fromOrders = [
        ...new Set(
            attackerOrders
                .filter((o) => o.role === "attacker")
                .map((o) => o.attackerOwner)
                .filter((id): id is string => Boolean(id))
        ),
    ];
    if (fromOrders.length === 1) return fromOrders[0];
    if (owners.length > 0) return owners[0];
    return attackerOrders.find((o) => o.role === "attacker")?.attackerOwner;
}

export function resolveBoardingCombatCommands(
    defenderShipId: string,
    ship: ShipWithBoarders,
    orderDecls: FullThrustGameCommand[],
    source: RollSource
): FullThrustGameCommand[] {
    const attackerOrders: BoardingOrdersV2[] = [];
    const defenderOrders: BoardingOrdersV2[] = [];
    for (const cmd of orderDecls) {
        const notes = boardingNotesFromCommand(cmd);
        if (!notes) continue;
        if (notes.role === "attacker") attackerOrders.push(notes);
        else defenderOrders.push(notes);
    }

    const diceCount = boardingCombatDiceCount(ship, attackerOrders, defenderOrders);
    const mark = source.mark();
    const dcpRolls: number[] = [];
    for (let i = 0; i < diceCount.dcp; i++) dcpRolls.push(source.next());
    const combatRolls: number[] = [];
    for (let i = 0; i < diceCount.combat; i++) combatRolls.push(source.next());
    const consumed = source.consumedSince(mark);

    const result = resolveBoardingCombat({
        defenderShip: ship,
        attackerOrders,
        defenderOrders,
        dice: { dcp: dcpRolls, combat: combatRolls },
    });

    const hullBoxes =
        (ship.object as { hull?: { points?: number } })?.hull?.points ?? 12;
    const hullLeft = Math.max(0, hullBoxes - (Number(ship.dmgHull ?? 0) || 0));
    const hullApplied = Math.min(result.hullDamage, hullLeft);
    const resultNotes = formatBoardingCombatNotes(result, hullApplied);

    const cmds: FullThrustGameCommand[] = [
        {
            name: "logDice",
            purpose: `boarding→${defenderShipId}`,
            rolls: consumed,
            source: "client",
            result: resultNotes,
        } as FullThrustGameCommand,
        {
            name: "_custom",
            msg: `Boarding ${defenderShipId}: ${resultNotes}`,
        } as FullThrustGameCommand,
    ];

    if (result.removedUnitIds.length > 0) {
        cmds.push({
            name: "removeBoarders",
            ship: defenderShipId,
            unitIds: result.removedUnitIds,
        } as FullThrustGameCommand);
    }

    if (hullApplied > 0) {
        cmds.push({
            name: "dmgShip",
            ship: defenderShipId,
            hull: hullApplied,
        } as FullThrustGameCommand);
    }

    for (const system of result.defenderMarineCasualtyIds) {
        cmds.push({
            name: "sysDisable",
            ship: defenderShipId,
            system,
            state: "destroyed",
        } as FullThrustGameCommand);
    }

    if (result.hullDamage >= hullLeft && hullLeft > 0) {
        const capturedBy = captureOwnerForShip(ship, attackerOrders);
        if (capturedBy) {
            cmds.push({
                name: "setShipCaptured",
                ship: defenderShipId,
                capturedBy,
            } as FullThrustGameCommand);
        }
        cmds.push({
            name: "_custom",
            msg: `Ship ${defenderShipId} CAPTURED by boarding (not destroyed).`,
        } as FullThrustGameCommand);
    }

    if (hullApplied > 0) {
        cmds.push({
            name: "_custom",
            msg: `Threshold tests may be required in phase 13 for ${defenderShipId} hull damage.`,
        } as FullThrustGameCommand);
    }

    cmds.push({
        name: "resolveBoardingCombat",
        ship: defenderShipId,
        rolls: consumed,
    } as FullThrustGameCommand);

    return cmds;
}

/** Apply boarding combat result to a cloned ship (for tests). */
export function applyBoardingCombatToShip(
    ship: ShipWithBoarders,
    result: BoardingCombatResult
): void {
    if (result.removedUnitIds.length) {
        removeBoarderUnits(ship, result.removedUnitIds);
    }
}

/** @deprecated Legacy helper — DCP repel uses roll ≤ assigned count in per-unit model. */
export function dcpKillOnOrAbove(_dcp: number): number {
    return 7;
}

/** @deprecated Legacy aggregate resolver — use resolveBoardingCombat. */
export function resolveBoarding(_input: {
    attackers: number;
    defenderDcp: number;
    defenderMarines: number;
    dcpRolls: number[];
    marineRolls: number[];
}): {
    killedByDcp: number;
    killedByMarines: number;
    survivors: number;
    hullDamage: number;
    notes: string[];
} {
    return {
        killedByDcp: 0,
        killedByMarines: 0,
        survivors: 0,
        hullDamage: 0,
        notes: ["Use resolveBoardingCombat for per-unit boarding"],
    };
}

export function defenderMarineCasualtyIds(
    ship: ShipWithBoarders,
    killed: number
): string[] {
    return availableMarineIds(ship).slice(0, Math.max(0, Math.floor(killed)));
}

export type { BoarderUnit };
