/** Phase 8 furball skirmishes involving gunboat squadrons. */

import type { FullThrustGamePosition } from "@/schemas/position";
import { gunboatGroupLabel } from "./gunboatLabel";
import type { GunboatAttackAlloc } from "./gunboatEngagement";
import type { FurballEngagement } from "./fighterDogfight";
import { fighterGroupLabel } from "./fighterLabel";
import { isDeployedFighter } from "./fighterMove";
import { isDeployedGunboat } from "./gunboatMove";
import type { FurballSkirmish } from "./fighterScreening";

type FighterObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "fighters" }
>;

type GunboatObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "gunboats" }
>;

function dogfightParticipantLabel(
    position: FullThrustGamePosition,
    id: string
): string {
    const obj = position.objects?.find((o) => o.id === id);
    if (obj?.objType === "fighters") return fighterGroupLabel(obj as FighterObj);
    if (obj?.objType === "gunboats") return gunboatGroupLabel(obj as GunboatObj);
    return id;
}

function isDogfightParticipant(
    position: FullThrustGamePosition,
    id: string
): boolean {
    const obj = position.objects?.find((o) => o.id === id);
    if (!obj) return false;
    if (obj.objType === "fighters") return isDeployedFighter(obj);
    if (obj.objType === "gunboats") return isDeployedGunboat(obj);
    return false;
}

/** Dogfight skirmishes from phase-7 gunboat attack declarations. */
export function gunboatDogfightSkirmishes(
    position: FullThrustGamePosition,
    allocations: GunboatAttackAlloc[]
): FurballSkirmish[] {
    const skirmishes: FurballSkirmish[] = [];
    const seen = new Set<string>();

    for (const alloc of allocations) {
        if (alloc.targetType !== "fighters" && alloc.targetType !== "gunboats") continue;
        if (!isDogfightParticipant(position, alloc.groupId)) continue;
        if (!isDogfightParticipant(position, alloc.targetId)) continue;

        const key = `gb-dogfight:${alloc.groupId}:${alloc.targetId}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const aLabel = dogfightParticipantLabel(position, alloc.groupId);
        const dLabel = dogfightParticipantLabel(position, alloc.targetId);
        skirmishes.push({
            id: key,
            kind: "dogfight",
            label: `Gunboat dogfight: ${aLabel} vs ${dLabel}`,
            hint: `${alloc.groupId} declared attack on ${alloc.targetId} in phase 7`,
            attackerIds: [alloc.groupId],
            defenderIds: [alloc.targetId],
            suggested: [
                {
                    attackers: [{ id: alloc.groupId, targetIds: [alloc.targetId] }],
                    defenders: [{ id: alloc.targetId, targetIds: [alloc.groupId] }],
                },
            ],
        });
    }

    return skirmishes;
}

export function gunboatOrdnanceInterceptAllocations(
    allocations: GunboatAttackAlloc[]
): GunboatAttackAlloc[] {
    return allocations.filter((a) => a.targetType === "ordnance");
}

export function furballParticipantLabel(
    position: FullThrustGamePosition,
    id: string
): string {
    return dogfightParticipantLabel(position, id);
}

export function isFurballParticipant(
    position: FullThrustGamePosition,
    id: string
): boolean {
    return isDogfightParticipant(position, id);
}

export function suggestedEngagementFromGunboatSkirmish(
    skirmish: FurballSkirmish
): FurballEngagement | undefined {
    return skirmish.suggested[0];
}
