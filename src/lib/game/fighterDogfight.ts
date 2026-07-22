/** Furball / multi-group dogfight resolution — rules 8.10–8.11. */

import type { FullThrustGamePosition } from "@/schemas/position";
import type { FullThrustGameCommand } from "@/schemas/commands";
import { arrayRollSource, type RollSource } from "./dice";
import { nextEnduranceAfterCombat, resolveDogfightSideRolls } from "./fighterEndurance";
import { isDeployedFighter } from "./fighterMove";
import { clearGunboatAttachment } from "./gunboatAttachment";
import { isDeployedGunboat } from "./gunboatMove";
import { applyGunboatKills } from "./gunboatHull";
import { fighterDrmForTarget, fighterProfileFor } from "./fighterProfiles";
import { fighterWingFromObj } from "./fighterTypeCommand";

type GunboatObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "gunboats" }
>;

interface DogfightUnit {
    id: string;
    number: number;
    endurance?: number;
    objType: "fighters" | "gunboats";
    fighter?: FighterObj;
    gunboat?: GunboatObj;
}

function findDogfightUnit(
    position: FullThrustGamePosition,
    id: string
): DogfightUnit | undefined {
    const obj = position.objects?.find((o) => o.id === id);
    if (!obj) return undefined;
    if (obj.objType === "fighters" && isDeployedFighter(obj)) {
        return {
            id,
            number: obj.number ?? 6,
            endurance: obj.endurance,
            objType: "fighters",
            fighter: obj as FighterObj,
        };
    }
    if (obj.objType === "gunboats" && isDeployedGunboat(obj)) {
        return {
            id,
            number: obj.number ?? 6,
            endurance: obj.endurance,
            objType: "gunboats",
            gunboat: obj as GunboatObj,
        };
    }
    return undefined;
}

function isUnitExhausted(unit: DogfightUnit): boolean {
    return (unit.endurance ?? 6) <= 0;
}

function applyHullLosses(unit: DogfightUnit, kills: number): number {
    const before = unit.number;
    const after = Math.max(0, before - kills);
    if (unit.fighter) {
        unit.fighter.number = after;
        unit.fighter.endurance = nextEnduranceAfterCombat(unit.fighter.endurance);
    } else if (unit.gunboat) {
        applyGunboatKills(unit.gunboat, kills);
        unit.gunboat.endurance = nextEnduranceAfterCombat(unit.gunboat.endurance);
        return unit.gunboat.number ?? after;
    }
    return after;
}

export interface FurballGroupSide {
    id: string;
    targetIds: string[];
}

export interface FurballEngagement {
    attackers: FurballGroupSide[];
    defenders: FurballGroupSide[];
}

type FighterObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "fighters" }
>;

export interface FurballSideRoll {
    groupId: string;
    killsByTarget: Map<string, number>;
    diceUsed: number;
}

export interface FurballResolution {
    rolls: number[];
    incomingKills: Map<string, number>;
    sideRolls: FurballSideRoll[];
    notes: string;
}

/** Split kills as evenly as possible across targets (8.11). */
export function splitKillsEvenly(kills: number, targetIds: string[]): Map<string, number> {
    const out = new Map<string, number>();
    if (targetIds.length === 0 || kills <= 0) return out;
    const base = Math.floor(kills / targetIds.length);
    let remainder = kills % targetIds.length;
    for (const id of targetIds) {
        const extra = remainder > 0 ? 1 : 0;
        if (remainder > 0) remainder--;
        out.set(id, base + extra);
    }
    return out;
}

function findFighter(position: FullThrustGamePosition, id: string): FighterObj | undefined {
    const obj = position.objects?.find((o) => o.id === id);
    return obj?.objType === "fighters" ? (obj as FighterObj) : undefined;
}

function collectFiringSides(engagement: FurballEngagement): FurballGroupSide[] {
    const byId = new Map<string, FurballGroupSide>();
    for (const a of engagement.attackers) {
        byId.set(a.id, { id: a.id, targetIds: [...a.targetIds] });
    }
    for (const d of engagement.defenders) {
        const existing = byId.get(d.id);
        if (existing) {
            const merged = new Set([...existing.targetIds, ...d.targetIds]);
            existing.targetIds = [...merged];
        } else {
            byId.set(d.id, { id: d.id, targetIds: [...d.targetIds] });
        }
    }
    return [...byId.values()];
}

export function resolveFurballEngagement(
    position: FullThrustGamePosition,
    engagement: FurballEngagement,
    source: RollSource
): FurballResolution {
    const mark = source.mark();
    const incomingKills = new Map<string, number>();
    const sideRolls: FurballSideRoll[] = [];
    const notes: string[] = [];

    const addKills = (targetId: string, n: number) => {
        if (n <= 0) return;
        incomingKills.set(targetId, (incomingKills.get(targetId) ?? 0) + n);
    };

    for (const side of collectFiringSides(engagement)) {
        const unit = findDogfightUnit(position, side.id);
        if (!unit) continue;
        const count = unit.number;
        const exhausted = isUnitExhausted(unit);
        let drm = 0;
        if (unit.objType === "fighters" && unit.fighter) {
            const profile = fighterProfileFor(fighterWingFromObj(unit.fighter));
            drm = fighterDrmForTarget(profile, "fighters");
        }
        const { killsDealt, diceUsed } = resolveDogfightSideRolls(
            count,
            exhausted,
            source,
            drm
        );
        const killsByTarget = splitKillsEvenly(killsDealt, side.targetIds);
        for (const [tid, k] of killsByTarget) addKills(tid, k);
        sideRolls.push({ groupId: side.id, killsByTarget, diceUsed });
        notes.push(
            `${side.id}: ${count} dice${exhausted ? " (exhausted)" : ""} → ${killsDealt} kills`
        );
    }

    return {
        rolls: source.consumedSince(mark),
        incomingKills,
        sideRolls,
        notes: notes.join("; "),
    };
}

export function applyFurballToPosition(
    position: FullThrustGamePosition,
    engagement: FurballEngagement,
    resolution: FurballResolution
): { destroyed: string[]; updated: string[] } {
    const participantIds = new Set<string>();
    for (const a of engagement.attackers) participantIds.add(a.id);
    for (const d of engagement.defenders) participantIds.add(d.id);

    const destroyed: string[] = [];
    const updated: string[] = [];

    for (const id of participantIds) {
        const unit = findDogfightUnit(position, id);
        if (!unit) continue;
        const kills = resolution.incomingKills.get(id) ?? 0;
        const after = applyHullLosses(unit, kills);
        updated.push(id);
        if (after === 0) {
            destroyed.push(id);
            if (unit.fighter) clearFighterAttachment(unit.fighter);
            if (unit.gunboat) clearGunboatAttachment(unit.gunboat);
        }
    }

    if (destroyed.length > 0) {
        position.objects = (position.objects ?? []).filter((o) => !destroyed.includes(o.id));
    }
    return { destroyed, updated };
}

export function previewFurballUpdates(
    position: FullThrustGamePosition,
    engagement: FurballEngagement,
    resolution: FurballResolution
): Array<{ id: string; number: number; endurance: number; destroyed: boolean }> {
    const participantIds = new Set<string>();
    for (const a of engagement.attackers) participantIds.add(a.id);
    for (const d of engagement.defenders) participantIds.add(d.id);

    const updates: Array<{ id: string; number: number; endurance: number; destroyed: boolean }> =
        [];
    for (const id of participantIds) {
        const unit = findDogfightUnit(position, id);
        if (!unit) continue;
        const kills = resolution.incomingKills.get(id) ?? 0;
        const after = Math.max(0, unit.number - kills);
        updates.push({
            id,
            number: after,
            endurance: nextEnduranceAfterCombat(unit.endurance),
            destroyed: after === 0,
        });
    }
    return updates;
}

export function buildFurballCommands(
    engagement: FurballEngagement,
    resolution: FurballResolution,
    position: FullThrustGamePosition,
    diceSource: "client" | "moderatorSequence" = "client"
): FullThrustGameCommand[] {
    void position;
    return [
        {
            name: "logDice",
            purpose: "resolveFurball",
            rolls: resolution.rolls,
            source: diceSource,
            result: resolution.notes,
        } as FullThrustGameCommand,
        {
            name: "resolveFurball",
            engagement,
            rolls: resolution.rolls,
        } as FullThrustGameCommand,
        {
            name: "_custom",
            msg: `Furball: ${resolution.notes}`,
        } as FullThrustGameCommand,
    ];
}

export function resolveFurballFromRolls(
    position: FullThrustGamePosition,
    engagement: FurballEngagement,
    rolls: number[]
): FurballResolution {
    const source = arrayRollSource(rolls);
    return resolveFurballEngagement(position, engagement, source);
}
