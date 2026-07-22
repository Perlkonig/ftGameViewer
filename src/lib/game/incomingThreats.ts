/** Phase 9 incoming threat detection after phase 8. */

import type { FullThrustGameCommand } from "@/schemas/commands";
import type { FullThrustGamePosition } from "@/schemas/position";
import {
    fighterAttackAllocations,
    type FighterAttackAlloc,
} from "./fighterEngagement";
import { declaredFurballsFromCommands } from "./fighterPhase8";
import {
    analyzeSkirmishCoverage,
    furballSkirmishes,
    screeningEngagementPlan,
} from "./fighterScreening";
import { isDeployedFighter } from "./fighterMove";
import { isDeployedGunboat } from "./gunboatMove";
import { gunboatAttackAllocations } from "./gunboatEngagement";
import { isSalvoOrdnanceType, salvoMissileCount } from "./salvoOrdnance";
import { distance } from "./movement";

type FighterObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "fighters" }
>;

type OrdnanceObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "ordnance" }
>;

const HOMING_ORDNANCE = new Set([
    "missile",
    "salvo",
    "salvoER",
    "salvoMS",
    "amt",
]);

export interface FighterThreat {
    groupId: string;
    targetShipId: string;
    number: number;
    kind: "shipAttack" | "unengaged";
}

export interface GunboatThreat {
    groupId: string;
    targetShipId: string;
    number: number;
}

export interface OrdnanceThreat {
    ordnanceId: string;
    targetShipId: string;
    type: string;
    salvoCount?: number;
}

export interface Phase9ThreatBoard {
    fighters: FighterThreat[];
    gunboats: GunboatThreat[];
    ordnance: OrdnanceThreat[];
    byProtectedShip: Map<
        string,
        { fighters: FighterThreat[]; gunboats: GunboatThreat[]; ordnance: OrdnanceThreat[] }
    >;
    /** Wings that fought screeners without bypass — not PD-eligible. */
    forfeitedShipAttackers: string[];
    /** Wings in mutual fighter-vs-fighter engagement — not PD-eligible. */
    mutuallyEngaged: string[];
}

function liveGunboatCount(position: FullThrustGamePosition, id: string): number {
    const obj = position.objects?.find((o) => o.objType === "gunboats" && o.id === id);
    if (!obj || !isDeployedGunboat(obj)) return 0;
    return obj.number ?? 6;
}

function findFighter(
    position: FullThrustGamePosition,
    id: string
): FighterObj | undefined {
    const obj = position.objects?.find((o) => o.id === id);
    return obj?.objType === "fighters" ? (obj as FighterObj) : undefined;
}

function liveFighterCount(position: FullThrustGamePosition, id: string): number {
    const f = findFighter(position, id);
    if (!f || !isDeployedFighter(f)) return 0;
    return f.number ?? 6;
}

export function protectedShipOwner(
    position: FullThrustGamePosition,
    shipId: string
): string | undefined {
    const ship = position.objects?.find((o) => o.id === shipId && o.objType === "ship");
    return (ship as { owner?: string } | undefined)?.owner;
}

/** True when the threat object is not owned by the protected ship's player. */
export function isHostileThreatToProtectedShip(
    position: FullThrustGamePosition,
    threatObjectId: string,
    protectedShipId: string
): boolean {
    const protectedOwner = protectedShipOwner(position, protectedShipId);
    if (!protectedOwner) return false;
    const threat = position.objects?.find((o) => o.id === threatObjectId);
    if (!threat) return false;
    const owner = (threat as { owner?: string }).owner;
    if (!owner) return true;
    return owner !== protectedOwner;
}

/** Wings still in mutual fighter-vs-fighter allocation with a live opponent. */
export function mutuallyEngagedFighterIds(
    position: FullThrustGamePosition,
    allocations: FighterAttackAlloc[]
): Set<string> {
    const engaged = new Set<string>();
    const fighterAllocs = allocations.filter((a) => a.targetType === "fighters");
    for (const a of fighterAllocs) {
        if (liveFighterCount(position, a.groupId) <= 0) continue;
        if (liveFighterCount(position, a.targetId) <= 0) continue;
        const reverse = fighterAllocs.some(
            (b) =>
                b.groupId === a.targetId &&
                b.targetId === a.groupId &&
                b.groupId !== a.groupId
        );
        if (reverse) {
            engaged.add(a.groupId);
            engaged.add(a.targetId);
        }
    }
    return engaged;
}

/**
 * Wings qualified for a phase-10 ship attack run (and therefore PD-eligible as threats).
 * Screening furball wins alone do not qualify — only no-screening path or explicit strike-through.
 */
export function shipAttackQualifiedWingIds(
    position: FullThrustGamePosition,
    allocations: FighterAttackAlloc[],
    declarations: import("./fighterDogfight").FurballEngagement[]
): { qualified: Map<string, string>; forfeited: Set<string> } {
    const qualified = new Map<string, string>();
    const forfeited = new Set<string>();
    const skirmishes = furballSkirmishes(position, allocations);
    const screeningSkirmishes = skirmishes.filter(
        (s) => s.kind === "screening" && s.protectedTarget?.targetType === "ship"
    );

    const shipAttackers = allocations.filter((a) => a.targetType === "ship");
    for (const alloc of shipAttackers) {
        if (liveFighterCount(position, alloc.groupId) <= 0) continue;

        const relevantScreening = screeningSkirmishes.filter((sk) =>
            sk.attackerIds.includes(alloc.groupId) &&
            sk.protectedTarget?.targetId === alloc.targetId
        );

        if (relevantScreening.length === 0) {
            const inScreeningSituation = screeningEngagementPlan(position, allocations).some(
                (sit) =>
                    sit.target.targetType === "ship" &&
                    sit.target.targetId === alloc.targetId &&
                    sit.attackers.some((a) => a.groupId === alloc.groupId)
            );
            if (!inScreeningSituation) {
                qualified.set(alloc.groupId, alloc.targetId);
            } else {
                forfeited.add(alloc.groupId);
            }
            continue;
        }

        let strikeThrough = false;
        let foughtScreenersOnly = false;
        for (const sk of relevantScreening) {
            const cov = analyzeSkirmishCoverage(sk, position, declarations, skirmishes);
            if (cov.shipStrikeThroughAttackers.has(alloc.groupId)) {
                strikeThrough = true;
            }
            if (cov.furballAttackers.has(alloc.groupId)) {
                foughtScreenersOnly = true;
            }
        }

        if (strikeThrough) {
            qualified.set(alloc.groupId, alloc.targetId);
        } else if (foughtScreenersOnly) {
            forfeited.add(alloc.groupId);
        }
    }

    return { qualified, forfeited };
}

function isHomingOrdnanceThreat(ord: OrdnanceObj): boolean {
    if (!ord.type || !HOMING_ORDNANCE.has(ord.type)) return false;
    if (isSalvoOrdnanceType(ord.type)) {
        return (salvoMissileCount(ord) ?? 0) > 0;
    }
    return true;
}

export function incomingThreatsForPhase9(
    position: FullThrustGamePosition,
    commands: FullThrustGameCommand[],
    turn: number,
    foldFurballDeclarations?: import("./fighterDogfight").FurballEngagement[]
): Phase9ThreatBoard {
    const allocations = fighterAttackAllocations(position, commands, turn);
    const declarations =
        foldFurballDeclarations && foldFurballDeclarations.length > 0
            ? foldFurballDeclarations
            : declaredFurballsFromCommands(commands, turn);

    const mutual = mutuallyEngagedFighterIds(position, allocations);
    const { qualified, forfeited } = shipAttackQualifiedWingIds(
        position,
        allocations,
        declarations
    );

    const fighters: FighterThreat[] = [];
    for (const [groupId, targetShipId] of qualified) {
        if (mutual.has(groupId)) continue;
        const n = liveFighterCount(position, groupId);
        if (n <= 0) continue;
        fighters.push({ groupId, targetShipId, number: n, kind: "shipAttack" });
    }

    const shipAttackAllocIds = new Set(
        allocations.filter((a) => a.targetType === "ship").map((a) => a.groupId)
    );

    for (const obj of position.objects ?? []) {
        if (obj.objType !== "fighters" || !isDeployedFighter(obj)) continue;
        const id = obj.id;
        if (shipAttackAllocIds.has(id) || mutual.has(id)) continue;
        if ((obj.number ?? 6) <= 0) continue;
        if (allocations.some((a) => a.groupId === id)) continue;
        fighters.push({
            groupId: id,
            targetShipId: "",
            number: obj.number ?? 6,
            kind: "unengaged",
        });
    }

    const gunboats: GunboatThreat[] = [];
    const gbAllocs = gunboatAttackAllocations(position, commands, turn);
    for (const alloc of gbAllocs) {
        if (alloc.targetType !== "ship") continue;
        const n = liveGunboatCount(position, alloc.groupId);
        if (n <= 0) continue;
        gunboats.push({
            groupId: alloc.groupId,
            targetShipId: alloc.targetId,
            number: n,
        });
    }

    const ordnance: OrdnanceThreat[] = [];
    for (const obj of position.objects ?? []) {
        if (obj.objType !== "ordnance") continue;
        const ord = obj as OrdnanceObj;
        const targetShipId = (ord as { targetShip?: string }).targetShip;
        if (!targetShipId || !isHomingOrdnanceThreat(ord)) continue;
        ordnance.push({
            ordnanceId: ord.id,
            targetShipId,
            type: ord.type ?? "missile",
            salvoCount: isSalvoOrdnanceType(ord.type)
                ? salvoMissileCount(ord)
                : undefined,
        });
    }

    const byProtectedShip = new Map<
        string,
        { fighters: FighterThreat[]; gunboats: GunboatThreat[]; ordnance: OrdnanceThreat[] }
    >();
    const ensure = (shipId: string) => {
        if (!byProtectedShip.has(shipId)) {
            byProtectedShip.set(shipId, { fighters: [], gunboats: [], ordnance: [] });
        }
        return byProtectedShip.get(shipId)!;
    };
    for (const f of fighters) {
        if (f.kind === "shipAttack" && f.targetShipId) {
            ensure(f.targetShipId).fighters.push(f);
        }
    }
    for (const g of gunboats) {
        ensure(g.targetShipId).gunboats.push(g);
    }
    for (const o of ordnance) {
        ensure(o.targetShipId).ordnance.push(o);
    }

    return {
        fighters,
        gunboats,
        ordnance,
        byProtectedShip,
        forfeitedShipAttackers: [...forfeited],
        mutuallyEngaged: [...mutual],
    };
}

export function threatWithinRangeMu(
    position: FullThrustGamePosition,
    fromShipId: string,
    threatId: string,
    rangeMu: number
): boolean {
    const from = position.objects?.find((o) => o.id === fromShipId);
    const target = position.objects?.find((o) => o.id === threatId);
    if (!from?.position || !target?.position) return false;
    if (
        typeof from.position !== "object" ||
        typeof target.position !== "object" ||
        !("x" in from.position) ||
        !("x" in target.position)
    ) {
        return false;
    }
    return distance(from.position, target.position) <= rangeMu;
}

export function pdKillsFromPhase9Log(
    commands: FullThrustGameCommand[],
    turn: number
): Record<string, number> {
    const out: Record<string, number> = {};
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
        if (cmd.name !== "resolvePhase9PointDefense" && cmd.name !== "resolvePhase9Complete") continue;
        if (cmdTurn !== turn || phase !== 9) continue;
        const kills = (cmd as { pdKillsByOrdnance?: Record<string, number> }).pdKillsByOrdnance;
        if (kills) Object.assign(out, kills);
    }
    return out;
}
