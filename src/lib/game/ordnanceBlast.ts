/** AMT open-space / ship impact and PBL area blast resolution. */

import type { FullThrustGameCommand } from "@/schemas/commands";
import type { FullThrustGamePosition } from "@/schemas/position";
import type { RollSource } from "./dice";
import { arrayRollSource } from "./dice";
import {
    applyAdvancedScreenReduction,
    resolveBeamDieSplit,
    screenLevelFromSystems,
    type ScreenLevel,
} from "./combat";
import { distance, type Point } from "./movement";
import { listShipSystems, type ShipGameState } from "./shipSystems";
import { isDeployedFighter } from "./fighterMove";
import { pushRawHullDamageCommands } from "./resolveCombat";
import { makeLogDice } from "./rollResults";

type ShipObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "ship" }
>;
type FighterObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "fighters" }
>;
type OrdnanceObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "ordnance" }
>;

export interface BlastTargetHit {
    objectId: string;
    objectType: "ship" | "fighters";
    damageDice: number[];
    totalDamage: number;
    /** Beam-style split for ships. */
    normalDamage?: number;
    penetratingDamage?: number;
    /** Fighter casualties (1 per damage die for PBL). */
    fighterCasualties?: number;
}

export interface OrdnanceBlastResult {
    rolls: number[];
    hits: BlastTargetHit[];
    summary: string;
}

function mapPoint(obj: { position?: unknown }): Point | undefined {
    const pos = obj.position;
    if (!pos || typeof pos !== "object" || !("x" in pos)) return undefined;
    return pos as Point;
}

function shipScreens(ship: ShipObj): ScreenLevel {
    const systems = (ship.object as { systems?: { name?: string; type?: string; level?: number }[] })
        ?.systems;
    return screenLevelFromSystems(Array.isArray(systems) ? systems : []);
}

export function objectsInRadius(
    position: FullThrustGamePosition,
    center: Point,
    radiusMu: number
): Array<{ id: string; objType: "ship" | "fighters"; dist: number }> {
    const out: Array<{ id: string; objType: "ship" | "fighters"; dist: number }> = [];
    for (const obj of position.objects ?? []) {
        if (obj.objType !== "ship" && obj.objType !== "fighters") continue;
        const p = mapPoint(obj);
        if (!p) continue;
        const dist = distance(center, p);
        if (dist <= radiusMu + 1e-6) {
            out.push({ id: obj.id, objType: obj.objType, dist });
        }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
}

function rollD6Pool(count: number, source: RollSource): number[] {
    const rolls: number[] = [];
    for (let i = 0; i < count; i++) rolls.push(source.next());
    return rolls;
}

function applyScreenToDice(dice: number[], screens: ScreenLevel): number[] {
    if (screens <= 0) return dice.map((d) => Math.max(1, d));
    return dice.map((d) => Math.max(1, d - screens));
}

/** AMT open-space: warhead strength d6 to each unit within blast radius. */
export function resolveAmtOpenSpaceBlast(
    position: FullThrustGamePosition,
    ordnanceId: string,
    source: RollSource
): OrdnanceBlastResult {
    const ord = position.objects?.find((o) => o.id === ordnanceId) as OrdnanceObj | undefined;
    if (!ord || ord.objType !== "ordnance" || ord.type !== "amt") {
        throw new Error(`resolveAmtOpenSpaceBlast: AMT ${ordnanceId} not found`);
    }
    const center = mapPoint(ord);
    if (!center) throw new Error("resolveAmtOpenSpaceBlast: no position");
    const strength = Math.max(0, (ord as { amtWarheadStrength?: number }).amtWarheadStrength ?? 6);
    const radius = (ord as { amtBlastRadius?: number }).amtBlastRadius ?? 3;
    const mark = source.mark();
    const targets = objectsInRadius(position, center, radius);
    const hits: BlastTargetHit[] = [];
    for (const t of targets) {
        const dice = rollD6Pool(strength, source);
        const obj = position.objects?.find((o) => o.id === t.id);
        if (!obj) continue;
        if (obj.objType === "ship") {
            const screens = shipScreens(obj as ShipObj);
            const reduced = applyScreenToDice(dice, screens);
            const total = reduced.reduce((a, b) => a + b, 0);
            hits.push({
                objectId: t.id,
                objectType: "ship",
                damageDice: reduced,
                totalDamage: total,
                normalDamage: total,
                penetratingDamage: 0,
            });
        } else if (obj.objType === "fighters" && isDeployedFighter(obj)) {
            const screens = 0 as ScreenLevel;
            const reduced = applyScreenToDice(dice, screens);
            const total = reduced.reduce((a, b) => a + b, 0);
            hits.push({
                objectId: t.id,
                objectType: "fighters",
                damageDice: reduced,
                totalDamage: total,
                fighterCasualties: Math.min(obj.number ?? 6, total),
            });
        }
    }
    const rolls = source.consumedSince(mark);
    return {
        rolls,
        hits,
        summary: `AMT ${ordnanceId} open-space: ${hits.length} target(s)`,
    };
}

/** AMT ship impact: 3d6 at target + 2d6@2MU + 1d6@3MU (degraded by intercept state). */
export function resolveAmtShipImpactBlast(
    position: FullThrustGamePosition,
    ordnanceId: string,
    targetShipId: string,
    source: RollSource
): OrdnanceBlastResult {
    const ord = position.objects?.find((o) => o.id === ordnanceId) as OrdnanceObj | undefined;
    if (!ord) throw new Error(`resolveAmtShipImpactBlast: ordnance ${ordnanceId} not found`);
    const target = position.objects?.find((o) => o.id === targetShipId && o.objType === "ship") as
        | ShipObj
        | undefined;
    if (!target?.position) throw new Error(`resolveAmtShipImpactBlast: target ${targetShipId} not found`);
    const center = mapPoint(target);
    if (!center) throw new Error("resolveAmtShipImpactBlast: target has no position");

    const interceptHits = (ord as { interceptHits?: number }).interceptHits ?? 0;
    const baseStrength = Math.max(0, (ord as { amtWarheadStrength?: number }).amtWarheadStrength ?? 6);
    const degraded = Math.max(0, baseStrength - interceptHits);

    const tiers: { radius: number; dice: number }[] = [
        { radius: 0, dice: Math.min(3, degraded) },
        { radius: 2, dice: degraded >= 4 ? 2 : degraded > 3 ? degraded - 3 : 0 },
        { radius: 3, dice: degraded >= 6 ? 1 : 0 },
    ];

    const mark = source.mark();
    const hits: BlastTargetHit[] = [];
    for (const tier of tiers) {
        if (tier.dice <= 0) continue;
        const inTier = objectsInRadius(position, center, tier.radius === 0 ? 0.01 : tier.radius);
        for (const t of inTier) {
            if (t.objType !== "ship") continue;
            const dice = rollD6Pool(tier.dice, source);
            const ship = position.objects?.find((o) => o.id === t.id) as ShipObj;
            const screens = shipScreens(ship);
            const reduced = applyAdvancedScreenReduction(dice, screens > 1 ? 2 : screens);
            const total = reduced.reduce((a, b) => a + b, 0);
            const existing = hits.find((h) => h.objectId === t.id);
            if (existing) {
                existing.damageDice.push(...reduced);
                existing.totalDamage += total;
                existing.normalDamage = (existing.normalDamage ?? 0) + total;
            } else {
                hits.push({
                    objectId: t.id,
                    objectType: "ship",
                    damageDice: reduced,
                    totalDamage: total,
                    normalDamage: total,
                    penetratingDamage: 0,
                });
            }
        }
    }
    const rolls = source.consumedSince(mark);
    return {
        rolls,
        hits,
        summary: `AMT ${ordnanceId} impact on ${targetShipId}: ${hits.length} ship(s)`,
    };
}

/** PBL detonation: beamClass d6 per class to each target in blast radius. */
export function resolvePblDetonationBlast(
    position: FullThrustGamePosition,
    ordnanceId: string,
    source: RollSource
): OrdnanceBlastResult {
    const ord = position.objects?.find((o) => o.id === ordnanceId) as OrdnanceObj | undefined;
    if (!ord || ord.type !== "plasmaBolt") {
        throw new Error(`resolvePblDetonationBlast: PBL ${ordnanceId} not found`);
    }
    const center = mapPoint(ord);
    if (!center) throw new Error("resolvePblDetonationBlast: no position");
    const beamClass = (ord as { beamClass?: number }).beamClass ?? 1;
    const radius = ord.range ?? 6;
    const mark = source.mark();
    const targets = objectsInRadius(position, center, radius);
    const hits: BlastTargetHit[] = [];
    for (const t of targets) {
        const obj = position.objects?.find((o) => o.id === t.id);
        if (!obj) continue;
        if (obj.objType === "ship") {
            const screens = shipScreens(obj as ShipObj);
            let normal = 0;
            let penetrating = 0;
            for (let i = 0; i < beamClass; i++) {
                const { result } = resolveBeamDieSplit(source, screens);
                normal += result.normalDamage;
                penetrating += result.penetratingDamage;
            }
            hits.push({
                objectId: t.id,
                objectType: "ship",
                damageDice: source.consumedSince(mark).slice(-beamClass),
                totalDamage: normal + penetrating,
                normalDamage: normal,
                penetratingDamage: penetrating,
            });
        } else if (obj.objType === "fighters" && isDeployedFighter(obj)) {
            const dice = rollD6Pool(beamClass, source);
            const casualties = Math.min(obj.number ?? 6, dice.length);
            hits.push({
                objectId: t.id,
                objectType: "fighters",
                damageDice: dice,
                totalDamage: casualties,
                fighterCasualties: casualties,
            });
        }
    }
    const rolls = source.consumedSince(mark);
    return {
        rolls,
        hits,
        summary: `PBL ${ordnanceId}: ${hits.length} target(s)`,
    };
}

export function inferPblBeamClassFromLauncher(
    ship: ShipGameState,
    systemId: string | undefined
): number {
    if (!systemId) return 1;
    const sys = listShipSystems(ship).find((s) => s.id === systemId);
    const cls = (sys as { class?: number } | undefined)?.class;
    if (typeof cls === "number" && cls >= 1 && cls <= 5) return cls;
    return 1;
}

export function resolveAmtOpenSpaceBlastFromRolls(
    position: FullThrustGamePosition,
    ordnanceId: string,
    rolls: number[]
): OrdnanceBlastResult {
    return resolveAmtOpenSpaceBlast(position, ordnanceId, arrayRollSource(rolls));
}

export function resolvePblDetonationBlastFromRolls(
    position: FullThrustGamePosition,
    ordnanceId: string,
    rolls: number[]
): OrdnanceBlastResult {
    return resolvePblDetonationBlast(position, ordnanceId, arrayRollSource(rolls));
}

export function resolveAmtShipImpactBlastFromRolls(
    position: FullThrustGamePosition,
    ordnanceId: string,
    targetShipId: string,
    rolls: number[]
): OrdnanceBlastResult {
    return resolveAmtShipImpactBlast(position, ordnanceId, targetShipId, arrayRollSource(rolls));
}

export interface AmtRackExplosionResult {
    commands: FullThrustGameCommand[];
    rolls: number[];
    summary: string;
}

/** AMT rack fails threshold: 1d6 hull-only to carrier + 1d6 per other unit within 1 MU (no screens/armour). */
export function resolveAmtRackThresholdExplosion(
    position: FullThrustGamePosition,
    carrierShipId: string,
    rackId: string,
    source: RollSource
): AmtRackExplosionResult {
    const carrier = position.objects?.find(
        (o) => o.id === carrierShipId && o.objType === "ship"
    ) as ShipObj | undefined;
    const center = carrier ? mapPoint(carrier) : undefined;
    if (!center) {
        return { commands: [], rolls: [], summary: `AMT rack ${rackId}: carrier not on map` };
    }

    const mark = source.mark();
    const cmds: FullThrustGameCommand[] = [];
    const hitLines: string[] = [];

    const carrierRoll = source.next();
    pushRawHullDamageCommands(cmds, carrierShipId, carrier, carrierRoll);
    hitLines.push(`${carrierShipId} carrier ${carrierRoll} hull`);

    const nearby = objectsInRadius(position, center, 1);
    for (const t of nearby) {
        if (t.id === carrierShipId) continue;
        const roll = source.next();
        const obj = position.objects?.find((o) => o.id === t.id);
        if (!obj) continue;
        if (obj.objType === "ship") {
            pushRawHullDamageCommands(cmds, t.id, obj as ShipObj, roll);
            hitLines.push(`${t.id} ship ${roll} hull`);
        } else if (obj.objType === "fighters" && isDeployedFighter(obj)) {
            const casualties = Math.min(obj.number ?? 6, roll);
            if (casualties > 0) {
                cmds.push({
                    name: "adjustFighters",
                    uuid: t.id,
                    delta: -casualties,
                } as FullThrustGameCommand);
            }
            hitLines.push(`${t.id} fighters ${casualties} killed (d6=${roll})`);
        }
    }

    const rolls = source.consumedSince(mark);
    const summary = `AMT rack ${rackId} on ${carrierShipId}: ${hitLines.join("; ")}`;
    cmds.push(
        makeLogDice({
            purpose: `amtRackExplosion: ${carrierShipId}/${rackId}`,
            rolls,
            source: "client",
            result: summary,
        })
    );
    cmds.push({ name: "_custom", msg: summary } as FullThrustGameCommand);

    return { commands: cmds, rolls, summary };
}
