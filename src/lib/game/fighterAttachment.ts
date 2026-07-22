/** Fighter screening / pursuit attachment and phase-5 follow. */

import type { FullThrustGamePosition } from "@/schemas/position";
import { courseToDelta, facingToCourse } from "./coords";
import type { ClockFacing, Point } from "./movement";
import { movementClockFacing, normalizeFacing } from "./movement";

export const FIGHTER_SCREEN_RANGE_MU = 3;

export type FighterAttachmentKind = "screen" | "pursue";
export type FighterAttachmentTargetType = "ship" | "fighters" | "ordnance";

export interface BodyFrameOffset {
    dx: number;
    dy: number;
}

export interface FighterAttachment {
    kind: FighterAttachmentKind;
    targetType: FighterAttachmentTargetType;
    targetId: string;
    offset: BodyFrameOffset;
    /** Screening only: facing chosen at screen time; preserved when escort moves. */
    screenFacing?: ClockFacing;
}

type FighterObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "fighters" }
>;
type ShipObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "ship" }
>;

type MapObj = FighterObj | ShipObj;

function bowUnit(facing: ClockFacing): Point {
    return courseToDelta(facingToCourse(facing), 1);
}

function starboardUnit(facing: ClockFacing): Point {
    return courseToDelta(facingToCourse(facing) - 90, 1);
}

export function bodyFrameOffset(
    fighterPos: Point,
    targetPos: Point,
    targetFacing: ClockFacing
): BodyFrameOffset {
    const dxWorld = fighterPos.x - targetPos.x;
    const dyWorld = fighterPos.y - targetPos.y;
    const bow = bowUnit(targetFacing);
    const sb = starboardUnit(targetFacing);
    return {
        dx: dxWorld * bow.x + dyWorld * bow.y,
        dy: dxWorld * sb.x + dyWorld * sb.y,
    };
}

export function worldPosFromBodyOffset(
    targetPos: Point,
    targetFacing: ClockFacing,
    offset: BodyFrameOffset
): Point {
    const bow = bowUnit(targetFacing);
    const sb = starboardUnit(targetFacing);
    return {
        x: targetPos.x + offset.dx * bow.x + offset.dy * sb.x,
        y: targetPos.y + offset.dx * bow.y + offset.dy * sb.y,
    };
}

export function mapPosition(obj: MapObj): Point | undefined {
    const pos = obj.position;
    if (!pos || typeof pos !== "object" || !("x" in pos)) return undefined;
    return pos as Point;
}

export function targetFacing(obj: MapObj): ClockFacing {
    return normalizeFacing((obj as { facing?: number }).facing ?? 12);
}

export function findAttachmentTarget(
    position: FullThrustGamePosition,
    targetType: FighterAttachmentTargetType,
    targetId: string
): MapObj | undefined {
    const obj = position.objects?.find((o) => o.id === targetId);
    if (!obj) return undefined;
    if (targetType === "ship" && obj.objType === "ship") return obj;
    if (targetType === "fighters" && obj.objType === "fighters") return obj as FighterObj;
    return undefined;
}

export function clearFighterAttachment(fighter: FighterObj): void {
    delete (fighter as { fighterAttachment?: FighterAttachment }).fighterAttachment;
}

export function applyFighterAttachment(
    fighter: FighterObj,
    target: MapObj,
    kind: FighterAttachmentKind,
    targetType: FighterAttachmentTargetType,
    opts?: { screenFacing?: ClockFacing }
): void {
    const fighterPos = mapPosition(fighter);
    const targetPos = mapPosition(target);
    if (!fighterPos || !targetPos) {
        throw new Error("applyFighterAttachment: missing map position");
    }
    const face = targetFacing(target);
    const offset = bodyFrameOffset(fighterPos, targetPos, face);
    const attachment: FighterAttachment = {
        kind,
        targetType,
        targetId: target.id,
        offset,
    };
    if (kind === "screen") {
        attachment.screenFacing = normalizeFacing(
            opts?.screenFacing ?? fighter.facing ?? face
        );
        fighter.facing = attachment.screenFacing;
    } else {
        fighter.facing = movementClockFacing(fighterPos, targetPos);
    }
    (fighter as { fighterAttachment?: FighterAttachment }).fighterAttachment = attachment;
}

export function syncFighterToAttachment(
    position: FullThrustGamePosition,
    fighter: FighterObj
): boolean {
    const att = (fighter as { fighterAttachment?: FighterAttachment }).fighterAttachment;
    if (!att) return false;
    const target = findAttachmentTarget(position, att.targetType, att.targetId);
    if (!target) return false;
    const targetPos = mapPosition(target);
    if (!targetPos) return false;
    const face = targetFacing(target);
    fighter.position = worldPosFromBodyOffset(targetPos, face, att.offset);
    if (att.kind === "screen") {
        fighter.facing = att.screenFacing ?? normalizeFacing(fighter.facing ?? face);
    } else {
        const fpos = mapPosition(fighter);
        if (fpos) {
            fighter.facing = movementClockFacing(fpos, targetPos);
        }
    }
    return true;
}

export function syncFightersAttachedTo(
    position: FullThrustGamePosition,
    targetId: string,
    targetType: FighterAttachmentTargetType
): number {
    let count = 0;
    for (const obj of position.objects ?? []) {
        if (obj.objType !== "fighters") continue;
        const att = (obj as FighterObj & { fighterAttachment?: FighterAttachment })
            .fighterAttachment;
        if (!att || att.targetId !== targetId || att.targetType !== targetType) continue;
        if (syncFighterToAttachment(position, obj as FighterObj)) count++;
    }
    return count;
}

/** Cascade until no attached fighter moves (pursuers following screening groups). */
export function syncAllAttachedFighters(position: FullThrustGamePosition): void {
    for (let pass = 0; pass < 8; pass++) {
        let moved = false;
        for (const obj of position.objects ?? []) {
            if (obj.objType !== "fighters") continue;
            const fighter = obj as FighterObj;
            const att = (fighter as { fighterAttachment?: FighterAttachment }).fighterAttachment;
            if (!att) continue;
            const before = mapPosition(fighter);
            if (syncFighterToAttachment(position, fighter)) {
                const after = mapPosition(fighter);
                if (
                    before &&
                    after &&
                    (before.x !== after.x || before.y !== after.y)
                ) {
                    moved = true;
                }
            }
        }
        if (!moved) break;
    }
}

export interface LastAttack {
    turn: number;
    targetType: FighterAttachmentTargetType;
    targetId: string;
}

export function recordFighterAttackOnTarget(
    position: FullThrustGamePosition,
    groupId: string,
    targetType: FighterAttachmentTargetType,
    targetId: string,
    turn: number
): void {
    const fighter = position.objects?.find(
        (o) => o.objType === "fighters" && o.id === groupId
    ) as FighterObj | undefined;
    if (fighter) {
        (fighter as { lastAttack?: LastAttack }).lastAttack = {
            turn,
            targetType,
            targetId,
        };
    }
    if (targetType === "ship") {
        const ship = position.objects?.find(
            (o) => o.objType === "ship" && o.id === targetId
        ) as ShipObj | undefined;
        if (ship) {
            const engagements =
                (ship as { fighterEngagements?: { groupId: string; turn: number; kind?: string }[] })
                    .fighterEngagements ?? [];
            (ship as { fighterEngagements?: { groupId: string; turn: number; kind?: string }[] })
                .fighterEngagements = [
                ...engagements,
                { groupId, turn, kind: "attack" },
            ];
        }
    }
}
