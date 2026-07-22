import type { FullThrustGamePosition } from "@/schemas/position";
import {
    bodyFrameOffset,
    mapPosition,
    targetFacing,
    worldPosFromBodyOffset,
    type FighterAttachmentKind,
} from "./fighterAttachment";
import { movementClockFacing, normalizeFacing, type ClockFacing } from "./movement";

export type GunboatAttachmentTargetType = "ship" | "fighters" | "gunboats";

export interface GunboatAttachment {
    kind: FighterAttachmentKind;
    targetType: GunboatAttachmentTargetType;
    targetId: string;
    offset: { dx: number; dy: number };
    screenFacing?: ClockFacing;
}

type GunboatObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "gunboats" }
>;

type AttachTarget = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "ship" | "fighters" | "gunboats" }
>;

export function findGunboatAttachmentTarget(
    position: FullThrustGamePosition,
    targetType: GunboatAttachmentTargetType,
    targetId: string
): AttachTarget | undefined {
    const obj = position.objects?.find((o) => o.id === targetId);
    if (!obj) return undefined;
    if (targetType === "ship" && obj.objType === "ship") return obj;
    if (targetType === "fighters" && obj.objType === "fighters") return obj;
    if (targetType === "gunboats" && obj.objType === "gunboats") return obj;
    return undefined;
}

export function clearGunboatAttachment(gunboat: GunboatObj): void {
    delete (gunboat as { gunboatAttachment?: GunboatAttachment }).gunboatAttachment;
}

export function applyGunboatAttachment(
    gunboat: GunboatObj,
    target: AttachTarget,
    kind: FighterAttachmentKind,
    targetType: GunboatAttachmentTargetType,
    opts?: { screenFacing?: ClockFacing }
): void {
    const gunboatPos = mapPosition(gunboat as Parameters<typeof mapPosition>[0]);
    const targetPos = mapPosition(target as Parameters<typeof mapPosition>[0]);
    if (!gunboatPos || !targetPos) {
        throw new Error("applyGunboatAttachment: missing map position");
    }
    const face = targetFacing(target as Parameters<typeof targetFacing>[0]);
    const offset = bodyFrameOffset(gunboatPos, targetPos, face);
    const attachment: GunboatAttachment = {
        kind,
        targetType,
        targetId: target.id,
        offset,
    };
    if (kind === "screen") {
        attachment.screenFacing = normalizeFacing(
            opts?.screenFacing ?? gunboat.facing ?? face
        );
        gunboat.facing = attachment.screenFacing;
    } else {
        gunboat.facing = movementClockFacing(gunboatPos, targetPos);
    }
    (gunboat as { gunboatAttachment?: GunboatAttachment }).gunboatAttachment = attachment;
}

export function syncGunboatToAttachment(
    position: FullThrustGamePosition,
    gunboat: GunboatObj
): boolean {
    const att = (gunboat as { gunboatAttachment?: GunboatAttachment }).gunboatAttachment;
    if (!att) return false;
    const target = findGunboatAttachmentTarget(position, att.targetType, att.targetId);
    if (!target) return false;
    const targetPos = mapPosition(target as Parameters<typeof mapPosition>[0]);
    if (!targetPos) return false;
    const face = targetFacing(target as Parameters<typeof targetFacing>[0]);
    gunboat.position = worldPosFromBodyOffset(targetPos, face, att.offset);
    if (att.kind === "screen") {
        gunboat.facing = att.screenFacing ?? normalizeFacing(gunboat.facing ?? face);
    } else {
        const gpos = mapPosition(gunboat as Parameters<typeof mapPosition>[0]);
        if (gpos) {
            gunboat.facing = movementClockFacing(gpos, targetPos);
        }
    }
    return true;
}
