/** Gunboat command handlers (imported by applyCommand). */

import type { FullThrustGamePosition } from "@/schemas/position";
import type { FullThrustGameCommand } from "@/schemas/commands";
import type { GameMeta } from "./types";
import type { FoldState } from "./applyCommand";
import {
    clearBoatBay,
    deploySquadronFromRack,
    recoverSquadronInBoatBay,
    recoverSquadronOnRack,
    boatsFromGunboatObj,
    type BoatBayState,
    type GunboatRackState,
} from "@/lib/gunboatRacks";
import { squadronFitsBoatBay } from "./gunboatMass";
import {
    applyGunboatAttachment,
    clearGunboatAttachment,
    findGunboatAttachmentTarget,
} from "./gunboatAttachment";
import {
    decrementGunboatEnduranceIfSecondary,
    GUNBOAT_PURSUE_NOT_ALLOWED,
    validateMoveGunboatsCommand,
} from "./gunboatMove";
import { fighterActionCostsEndurance } from "./fighterMove";
import type { FullThrustShip } from "ftlibship";
import type { GunboatAttackAllocation, GunboatAttackTargetType } from "./gunboatAttack";
import { normalizeCallsign } from "./fighterLabel";
import { movementClockFacing, type Point } from "./movement";
import { gunboatTypeLaunchesOrdnance } from "./gunboatWeapons";
import { nanoid } from "nanoid";
import { buildGunboatMapSymbol } from "@/lib/gunboatMarker";
import { GUNBOAT_MISSILE_SALVO_COUNT } from "./gunboatProfiles";
import type { GunboatType } from "ftlibship";

type ShipObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "ship" }
>;
type GunboatObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "gunboats" }
>;

function findShip(state: FullThrustGamePosition, id: string): ShipObj {
    const obj = state.objects?.find((o) => o.id === id);
    if (!obj || obj.objType !== "ship") throw new Error(`Ship not found: ${id}`);
    return obj;
}

function findObj(state: FullThrustGamePosition, id: string) {
    const obj = state.objects?.find((o) => o.id === id);
    if (!obj) throw new Error(`Object not found: ${id}`);
    return obj;
}

function ensureObjects(state: FullThrustGamePosition) {
    if (!state.objects) state.objects = [];
    return state.objects;
}

export function applyGunboatCommand(
    cmd: FullThrustGameCommand,
    position: FullThrustGamePosition,
    meta: GameMeta,
    fold: FoldState,
    warnings: string[]
): { handled: true; warnings?: string[] } | { handled: false } {
    switch (cmd.name) {
        case "launchGunboats": {
            const lc = cmd as {
                ship?: string;
                id?: string;
                position?: { x: number; y: number };
                facing?: GunboatObj["facing"];
                source?: "rack" | "bay";
                rackId?: string;
                bayId?: string;
                callsign?: string;
            };
            const ship = findShip(position, lc.ship!);
            const gunboat = findObj(position, lc.id!) as GunboatObj;
            if (gunboat.objType !== "gunboats") throw new Error("launchGunboats: not gunboats");
            if (lc.source === "rack") {
                if (!lc.rackId) throw new Error("launchGunboats: missing rackId");
                const racks =
                    (ship as { gunboatRacks?: GunboatRackState }).gunboatRacks ?? {};
                (ship as { gunboatRacks?: GunboatRackState }).gunboatRacks =
                    deploySquadronFromRack(racks, lc.rackId);
            } else if (lc.source === "bay") {
                if (!lc.bayId) throw new Error("launchGunboats: missing bayId");
                const bays = (ship as { boatBays?: BoatBayState }).boatBays ?? {};
                (ship as { boatBays?: BoatBayState }).boatBays = clearBoatBay(bays, lc.bayId);
            } else {
                throw new Error("launchGunboats: missing source");
            }
            gunboat.position = lc.position!;
            gunboat.facing = lc.facing ?? ship.facing;
            const next = normalizeCallsign(lc.callsign);
            if (next && !normalizeCallsign((gunboat as { callsign?: string }).callsign)) {
                (gunboat as { callsign?: string }).callsign = next;
            }
            return { handled: true };
        }
        case "moveGunboats": {
            const obj = findObj(position, cmd.id!) as GunboatObj;
            if (obj.objType !== "gunboats") throw new Error("moveGunboats: not gunboats");
            const oldPos = obj.position;
            const newPos = cmd.position as GunboatObj["position"];
            const wasDeployed =
                oldPos && typeof oldPos === "object" && "x" in oldPos;
            const toRack =
                newPos && typeof newPos === "object" && "rack" in newPos;
            const toBay = newPos && typeof newPos === "object" && "bay" in newPos;
            clearGunboatAttachment(obj);
            obj.position = newPos;
            const mc = cmd as {
                facing?: GunboatObj["facing"];
                recoverEndurance?: number;
            };
            if (mc.facing !== undefined) {
                obj.facing = mc.facing;
            } else if (
                wasDeployed &&
                !toRack &&
                !toBay &&
                newPos &&
                typeof newPos === "object" &&
                "x" in newPos &&
                oldPos &&
                "x" in oldPos
            ) {
                obj.facing = movementClockFacing(oldPos as Point, newPos as Point);
            }
            if (cmd.vectors) {
                if (!obj.vectors) obj.vectors = [];
                obj.vectors.unshift(
                    cmd.vectors as [
                        { x: number; y: number },
                        { x: number; y: number },
                        ...{ x: number; y: number }[],
                    ]
                );
            }
            decrementGunboatEnduranceIfSecondary(obj, meta.phase);
            if (toRack && wasDeployed) {
                const carrier = findShip(position, newPos.ship);
                const racks =
                    (carrier as { gunboatRacks?: GunboatRackState }).gunboatRacks ?? {};
                (carrier as { gunboatRacks?: GunboatRackState }).gunboatRacks =
                    recoverSquadronOnRack(
                        carrier.object as FullThrustShip,
                        racks,
                        newPos.rack,
                        obj.squadronKey,
                        boatsFromGunboatObj(obj)
                    );
            }
            if (toBay && wasDeployed) {
                const carrier = findShip(position, newPos.ship);
                const bays = (carrier as { boatBays?: BoatBayState }).boatBays ?? {};
                const boats = boatsFromGunboatObj(obj);
                const ftl = (obj as { ftl?: boolean }).ftl ?? false;
                if (
                    !squadronFitsBoatBay(carrier.object as FullThrustShip, newPos.bay, boats, ftl)
                ) {
                    throw new Error("moveGunboats: squadron does not fit boat bay");
                }
                (carrier as { boatBays?: BoatBayState }).boatBays = recoverSquadronInBoatBay(
                    carrier.object as FullThrustShip,
                    bays,
                    newPos.bay,
                    obj.squadronKey,
                    boats
                );
                if (mc.recoverEndurance !== undefined) {
                    obj.endurance = mc.recoverEndurance;
                    const bayState = (carrier as { boatBays?: BoatBayState }).boatBays!;
                    const occ = bayState[newPos.bay];
                    if (occ && typeof occ === "object") {
                        occ.endurance = mc.recoverEndurance;
                    }
                }
            }
            const moveWarnings = validateMoveGunboatsCommand(fold, cmd)
                .filter((i) => i.severity === "warning")
                .map((i) => i.message);
            if (moveWarnings.length) warnings.push(...moveWarnings);
            return { handled: true, warnings: warnings.length ? warnings : undefined };
        }
        case "screenGunboats": {
            const c = cmd as {
                id?: string;
                targetType?: "ship" | "fighters" | "gunboats";
                targetId?: string;
                facing?: number;
            };
            if (!c.id || !c.targetType || !c.targetId) {
                throw new Error("screenGunboats: incomplete");
            }
            const obj = findObj(position, c.id) as GunboatObj;
            if (obj.objType !== "gunboats") throw new Error("screenGunboats: not gunboats");
            const target = findGunboatAttachmentTarget(position, c.targetType, c.targetId);
            if (!target) {
                throw new Error(`screenGunboats: target not found ${c.targetType} ${c.targetId}`);
            }
            applyGunboatAttachment(obj, target, "screen", c.targetType, {
                screenFacing:
                    c.facing !== undefined
                        ? (c.facing as import("./movement").ClockFacing)
                        : undefined,
            });
            if (fighterActionCostsEndurance(meta.phase)) {
                obj.endurance = Math.max(0, (obj.endurance ?? 6) - 1);
            }
            return { handled: true };
        }
        case "pursueGunboats":
            throw new Error(GUNBOAT_PURSUE_NOT_ALLOWED);
        case "adjustGunboats": {
            const obj = findObj(position, cmd.id!);
            if (obj.objType !== "gunboats") throw new Error("adjustGunboats: not gunboats");
            const ac = cmd as {
                number?: number;
                endurance?: number;
                skill?: GunboatObj["skill"];
                boats?: GunboatObj["boats"];
            };
            if (ac.number !== undefined) obj.number = ac.number;
            if (ac.endurance !== undefined) obj.endurance = ac.endurance;
            if (ac.skill !== undefined) obj.skill = ac.skill;
            if (ac.boats !== undefined) {
                (obj as GunboatObj).boats = ac.boats;
                obj.number = ac.boats.length;
                const types = ac.boats.map((b) => b.type as GunboatType);
                obj.svg = buildGunboatMapSymbol(obj.id, types).svg;
            }
            return { handled: true };
        }
        case "declareGunboatAttack": {
            const c = cmd as {
                id?: string;
                targetType?: GunboatAttackTargetType;
                targetId?: string;
            };
            if (!c.id || !c.targetType || !c.targetId) {
                throw new Error("declareGunboatAttack: incomplete");
            }
            const gunboat = findObj(position, c.id) as GunboatObj;
            const allocation: GunboatAttackAllocation = {
                turn: meta.turn,
                targetType: c.targetType,
                targetId: c.targetId,
            };
            (gunboat as { attackAllocation?: GunboatAttackAllocation }).attackAllocation =
                allocation;
            (gunboat as { lastAttack?: typeof allocation & { turn: number } }).lastAttack = {
                turn: meta.turn,
                targetType: c.targetType,
                targetId: c.targetId,
            };
            return { handled: true };
        }
        case "setGunboatCallsign": {
            const gunboat = findObj(position, (cmd as { id: string }).id) as GunboatObj;
            const next = normalizeCallsign((cmd as { callsign?: string }).callsign);
            if (next) {
                (gunboat as { callsign?: string }).callsign = next;
            } else {
                delete (gunboat as { callsign?: string }).callsign;
            }
            return { handled: true };
        }
        case "launchGunboatOrdnance": {
            const c = cmd as {
                id?: string;
                ordnanceType?: string;
                count?: number;
                enduranceCost?: number;
                targetId?: string;
                position?: { x: number; y: number };
                facing?: number;
            };
            const gunboat = findObj(position, c.id!) as GunboatObj;
            const cost = c.enduranceCost ?? 1;
            gunboat.endurance = Math.max(0, (gunboat.endurance ?? 6) - cost);
            const gbType = gunboat.type ?? gunboat.boats?.[0]?.type ?? "missile";
            const ordType = c.ordnanceType ?? gbType;
            if (!gunboatTypeLaunchesOrdnance(ordType) && !gunboatTypeLaunchesOrdnance(gbType)) {
                warnings.push(`Gunboat type may not launch ordnance (${ordType}).`);
            }
            const launchPos =
                c.position ??
                (gunboat.position && typeof gunboat.position === "object" && "x" in gunboat.position
                    ? (gunboat.position as { x: number; y: number })
                    : undefined);
            if (launchPos && c.targetId) {
                const ordId = `gbord_${nanoid(8)}`;
                if (!position.objects) position.objects = [];
                const gameOrdType =
                    ordType === "plasmaBomber" ? "plasmaBolt" : ordType === "rocket" ? "rocket" : "missile";
                const ordPayload: Record<string, unknown> = {
                    objType: "ordnance",
                    id: ordId,
                    owner: gunboat.owner,
                    type: gameOrdType,
                    position: launchPos,
                    facing: (c.facing ?? gunboat.facing ?? 12) as GunboatObj["facing"],
                    targetShip: c.targetId,
                    deployedTurn: meta.turn,
                    range: gameOrdType === "plasmaBolt" ? 6 : 12,
                };
                if (gameOrdType === "missile" || ordType === "missile") {
                    ordPayload.salvoCount = GUNBOAT_MISSILE_SALVO_COUNT;
                    ordPayload.type = "salvo";
                }
                position.objects.push(
                    ordPayload as NonNullable<FullThrustGamePosition["objects"]>[number]
                );
            }
            return { handled: true, warnings: warnings.length ? warnings : undefined };
        }
        default:
            return { handled: false };
    }
}
