/** EMP banking and phase-13 resolution (§5.4). */

import type { FullThrustGameCommand } from "@/schemas/commands";
import type { ThresholdTarget } from "./thresholdSystems";
import { listShipSystems, type ShipGameState } from "./shipSystems";

export interface BankedEmpHits {
    totalHits: number;
    contributors: { shipId: string; weaponId: string; hits: number }[];
}

export type BankedEmpState = Record<string, BankedEmpHits>;

export interface EmpContributorRef {
    targetShip: string;
    firerShip: string;
    weapon: string;
    hits: number;
}

export function empFailThreshold(totalEmpHitsOnTarget: number): number {
    if (totalEmpHitsOnTarget <= 1) return 6;
    if (totalEmpHitsOnTarget === 2) return 5;
    return 4;
}

const EMP_TARGET_NAMES =
    /^(drive|ftl|firecontrol|screen|turret|ecm|stealth|holofield|holofields|cloak)/i;

export function empValidTargets(ship: ShipGameState): ThresholdTarget[] {
    const out: ThresholdTarget[] = [];
    for (const entry of listShipSystems(ship)) {
        const state = ship.systems?.find((s) => s.id === entry.id)?.state;
        if (state === "destroyed") continue;
        const n = (entry.name ?? "").toLowerCase();
        if (!EMP_TARGET_NAMES.test(n) && n !== "areaecm") continue;
        if (entry.area && n === "ecm") {
            out.push({ id: entry.id, label: entry.name ?? entry.id, kind: "system" });
            continue;
        }
        if (n === "drive") out.push({ id: entry.id, label: entry.name ?? entry.id, kind: "drive" });
        else out.push({ id: entry.id, label: entry.name ?? entry.id, kind: "system" });
    }
    return out;
}

export function bankEmpHitsOnTarget(
    state: BankedEmpState | undefined,
    targetShipId: string,
    firerShipId: string,
    weaponId: string,
    hits: number
): BankedEmpState {
    const next = { ...(state ?? {}) };
    const prev = next[targetShipId] ?? { totalHits: 0, contributors: [] };
    next[targetShipId] = {
        totalHits: prev.totalHits + hits,
        contributors: [...prev.contributors, { shipId: firerShipId, weaponId, hits }],
    };
    return next;
}

export interface EmpAllocation {
    systemId: string;
    hitCount: number;
}

export function empContributorKey(firerShip: string, weapon: string): string {
    return `${firerShip}|${weapon}`;
}

export function hasBankedEmp(banked?: BankedEmpState): boolean {
    return !!banked && Object.keys(banked).length > 0;
}

export function declaredEmpContributorKeys(
    targetShip: string,
    phase13Commands: FullThrustGameCommand[]
): Set<string> {
    const declared = new Set<string>();
    for (const cmd of phase13Commands) {
        if (cmd.name !== "declareEmpAllocation") continue;
        const c = cmd as { targetShip?: string; firerShip?: string; weapon?: string };
        if (c.targetShip === targetShip && c.firerShip && c.weapon) {
            declared.add(empContributorKey(c.firerShip, c.weapon));
        }
    }
    return declared;
}

export function empContributorsNeedingAllocation(
    banked: BankedEmpState,
    phase13Commands: FullThrustGameCommand[]
): EmpContributorRef[] {
    const need: EmpContributorRef[] = [];
    for (const [targetShip, entry] of Object.entries(banked)) {
        const declared = declaredEmpContributorKeys(targetShip, phase13Commands);
        for (const c of entry.contributors) {
            if (!declared.has(empContributorKey(c.shipId, c.weaponId))) {
                need.push({
                    targetShip,
                    firerShip: c.shipId,
                    weapon: c.weaponId,
                    hits: c.hits,
                });
            }
        }
    }
    return need;
}

export function mergedEmpAllocationsForTarget(
    targetShip: string,
    banked: BankedEmpHits,
    phase13Commands: FullThrustGameCommand[]
): EmpAllocation[] {
    const merged: EmpAllocation[] = [];
    const declaresByKey = new Map<string, EmpAllocation[]>();

    for (const cmd of phase13Commands) {
        if (cmd.name !== "declareEmpAllocation") continue;
        const c = cmd as {
            targetShip?: string;
            firerShip?: string;
            weapon?: string;
            allocations?: EmpAllocation[];
        };
        if (c.targetShip !== targetShip || !c.firerShip || !c.weapon) continue;
        declaresByKey.set(empContributorKey(c.firerShip, c.weapon), c.allocations ?? []);
    }

    for (const contrib of banked.contributors) {
        const allocs = declaresByKey.get(empContributorKey(contrib.shipId, contrib.weaponId)) ?? [];
        for (const a of allocs) {
            const existing = merged.find((m) => m.systemId === a.systemId);
            if (existing) existing.hitCount += a.hitCount;
            else merged.push({ systemId: a.systemId, hitCount: a.hitCount });
        }
    }
    return merged;
}

export function empHullRowDrmForShip(ship: ShipGameState): number {
    return Number((ship as { empHullRowDrm?: number }).empHullRowDrm ?? 0) || 0;
}

export function resolveEmpThresholdRoll(
    roll: number,
    failOn: number,
    hullRowDrm: number
): boolean {
    return roll + hullRowDrm >= failOn;
}

/** Resolve phase-13 EMP allocation before normal threshold checks. */
export function resolveBankedEmp(
    targetShipId: string,
    totalBankedHits: number,
    allocations: EmpAllocation[],
    hullRowDrm: number,
    source: import("./dice").RollSource,
    targetLabels?: Map<string, string>
): { cmds: FullThrustGameCommand[]; rolls: number[] } {
    const cmds: FullThrustGameCommand[] = [];
    const rolls: number[] = [];
    const allocated = allocations.reduce((s, a) => s + a.hitCount, 0);
    if (allocated !== totalBankedHits) {
        throw new Error(
            `EMP allocation must assign all ${totalBankedHits} hit(s); got ${allocated}.`
        );
    }
    const failOn = empFailThreshold(totalBankedHits);
    const lines: string[] = [];

    for (const alloc of allocations) {
        const label = targetLabels?.get(alloc.systemId) ?? alloc.systemId;
        for (let i = 0; i < alloc.hitCount; i++) {
            const roll = source.next();
            rolls.push(roll);
            const effective = roll + hullRowDrm;
            const failed = resolveEmpThresholdRoll(roll, failOn, hullRowDrm);
            const tag = failed ? "FAIL" : "pass";
            lines.push(`${label}: d6=${roll}${hullRowDrm ? `+${hullRowDrm}` : ""}→${effective} ${tag}`);
            if (failed) {
                cmds.push({
                    name: "sysDisable",
                    ship: targetShipId,
                    system: alloc.systemId,
                    state: "damaged",
                } as FullThrustGameCommand);
            }
        }
    }

    cmds.push({
        name: "logDice",
        purpose: `empAllocation→${targetShipId}`,
        rolls,
        result: `EMP ${totalBankedHits} hit(s), fail ${failOn}+${hullRowDrm ? `, DRM +${hullRowDrm}` : ""}`,
    } as FullThrustGameCommand);

    cmds.push({
        name: "_custom",
        msg: `EMP ${targetShipId}: ${lines.join("; ")}`,
    } as FullThrustGameCommand);

    return { cmds, rolls };
}
