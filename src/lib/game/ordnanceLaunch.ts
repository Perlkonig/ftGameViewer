/** Phase 3 ordnance launch helpers. */

import type { FullThrustGamePosition } from "@/schemas/position";
import type { Position } from "@/schemas/position";
import type { FullThrustShip } from "ftlibship";
import type { Arc, Facing } from "@/lib/genArcs";
import genArcs from "@/lib/genArcs";
import type { IAnnotation } from "@/stores/writeAnnotations";
import {
    distance,
    bearingWeaponArc,
    launchClockFacing,
    movementClockFacing,
    normalizeFacing,
    type ClockFacing,
    type Point,
} from "@/lib/game/movement";
import { ammunitionSourceForLauncher, systemDesignCapacity } from "@/lib/ammunition";
import {
    ammoUses,
    isSystemDestroyed,
    listShipSystems,
    operationalFireControls,
    ORDNANCE_LAUNCHER,
    systemShotCapacity,
    type ShipGameState,
    type ShipSystemEntry,
} from "@/lib/game/shipSystems";
import type { ValidationIssue } from "@/lib/game/commandValidation";

export type OrdnanceGameType =
    | "missile"
    | "amt"
    | "salvo"
    | "salvoER"
    | "salvoMS"
    | "plasmaBolt"
    | "rocket";

export type OrdnanceModifier = "none" | "er" | "twostage";

export interface LaunchableSystem {
    systemId: string;
    label: string;
    gameType: OrdnanceGameType;
    modifier: OrdnanceModifier;
    remaining: number | undefined;
    leftArc?: string;
    numArcs?: number;
}

const ARC_ORDER: Arc[] = ["F", "FS", "AS", "A", "AP", "FP"];

function nextArc(a: Arc): Arc {
    const i = ARC_ORDER.indexOf(a);
    return ARC_ORDER[(i + 1) % ARC_ORDER.length];
}

function arcsCovered(leftArc: Arc, numArcs: number): Set<Arc> {
    const out = new Set<Arc>();
    let a: Arc = leftArc;
    for (let i = 0; i < numArcs; i++) {
        out.add(a);
        a = nextArc(a);
    }
    return out;
}

export function inferOrdnanceType(sys: ShipSystemEntry): {
    gameType: OrdnanceGameType;
    modifier: OrdnanceModifier;
} {
    const name = (sys.name ?? "").toLowerCase();
    const mod = (sys.modifier as OrdnanceModifier | undefined) ?? "none";
    if (name === "missile") return { gameType: "missile", modifier: mod };
    if (name === "salvo") {
        if (mod === "er") return { gameType: "salvoER", modifier: mod };
        if (mod === "twostage") return { gameType: "salvoMS", modifier: mod };
        return { gameType: "salvo", modifier: mod };
    }
    if (name === "salvolauncher") return { gameType: "salvo", modifier: mod };
    if (name === "amt") return { gameType: "amt", modifier: "none" };
    if (name === "rocketpod") return { gameType: "rocket", modifier: "none" };
    if (name === "pbl") return { gameType: "plasmaBolt", modifier: "none" };
    return { gameType: "missile", modifier: mod };
}

export function isOrdnanceLauncherSystem(sys: ShipSystemEntry): boolean {
    const name = (sys.name ?? "").toLowerCase();
    if (name === "boardingtorpedolauncher") return false;
    const label = `${sys.name ?? ""} ${sys.type ?? ""}`;
    if (/minelayer|mine/i.test(label)) return false;
    return ORDNANCE_LAUNCHER.test(label);
}

export function listLaunchableSystems(ship: ShipGameState): LaunchableSystem[] {
    const out: LaunchableSystem[] = [];
    for (const sys of listShipSystems(ship)) {
        if (!isOrdnanceLauncherSystem(sys)) continue;
        if (isSystemDestroyed(ship, sys.id)) continue;
        const { gameType, modifier } = inferOrdnanceType(sys);
        const ammoId = ammunitionSourceForLauncher(ship, sys.id);
        let cap = systemShotCapacity(sys);
        if (cap === undefined) cap = systemDesignCapacity(ship, ammoId);
        const used = ammoUses(ship, ammoId);
        if (cap !== undefined && used >= cap) continue;
        const remaining = cap === undefined ? undefined : cap - used;
        out.push({
            systemId: sys.id,
            label: sys.name ?? sys.id,
            gameType,
            modifier,
            remaining,
            leftArc: sys.leftArc as string | undefined,
            numArcs: typeof sys.numArcs === "number" ? sys.numArcs : undefined,
        });
    }
    return out;
}

export function launchRange(
    gameType: OrdnanceGameType,
    modifier: OrdnanceModifier
): number {
    switch (gameType) {
        case "amt":
            return 18;
        case "plasmaBolt":
            return 30;
        case "rocket":
            return 18;
        case "salvoER":
        case "missile":
            return modifier === "er" ? 36 : 24;
        case "salvo":
        case "salvoMS":
            return modifier === "er" ? 36 : 24;
        default:
            return 24;
    }
}

export function rocketHitThreshold(rangeMu: number): number {
    if (rangeMu <= 6) return 2;
    if (rangeMu <= 12) return 3;
    return 4;
}

export function resolveRocketHits(
    rolls: [number, number],
    rangeMu: number
): [boolean, boolean] {
    const need = rocketHitThreshold(rangeMu);
    return [rolls[0] >= need, rolls[1] >= need];
}

export function rocketPlacementPositions(
    target: Point,
    count: number
): Point[] {
    const offsets = [
        { x: 0.4, y: 0 },
        { x: -0.4, y: 0.3 },
    ];
    return offsets.slice(0, count).map((o) => ({
        x: target.x + o.x,
        y: target.y + o.y,
    }));
}

export function bearingInSystemArc(
    shipPos: Point,
    facing: ClockFacing,
    target: Point,
    leftArc: string | undefined,
    numArcs: number | undefined
): boolean {
    if (!leftArc || !numArcs) return true;
    if (numArcs >= 6) return true;
    const arc = bearingWeaponArc(shipPos, facing, target);
    const covered = arcsCovered(leftArc as Arc, numArcs);
    return covered.has(arc);
}

export function launchAnnotationsForSystem(
    shipSrc: FullThrustShip,
    shipPosition: Position,
    shipFacing: Facing,
    system: LaunchableSystem
): IAnnotation[] {
    const out: IAnnotation[] = [];
    const c = shipPosition;
    const maxR = launchRange(system.gameType, system.modifier);
    const numArcs = system.numArcs ?? 6;
    const id = system.systemId;

    if (numArcs < 6 && system.leftArc) {
        const [left, right] = genArcs(
            shipSrc.orientation,
            shipFacing,
            system.leftArc as Arc,
            numArcs
        );
        out.push({
            type: "ARC",
            id: `launch_arc_${id}`,
            note: { left, right, c, r: maxR },
            opacity: 0.2,
        });
    } else {
        out.push({
            type: "CIRCLE",
            id: `launch_range_${id}`,
            note: { c, r: maxR },
            opacity: 0.15,
        });
    }
    return out;
}

export function nearestClockFacing(from: Point, to: Point): ClockFacing {
    return movementClockFacing(from, to);
}

export function ordnanceLaunchFacing(
    ship: { position?: Point; facing?: number },
    launchPos: Point
): ClockFacing {
    const shipPos = ship.position;
    const shipFacing = normalizeFacing(ship.facing ?? 12);
    if (!shipPos || !("x" in shipPos)) return shipFacing;
    return launchClockFacing(shipPos, shipFacing, launchPos);
}

export function multistageNeedingOrders(
    position: FullThrustGamePosition,
    turn: number
): string[] {
    const ids: string[] = [];
    for (const obj of position.objects ?? []) {
        if (obj.objType !== "ordnance") continue;
        const o = obj as {
            id: string;
            stage?: number;
            deployedTurn?: number;
            type?: string;
        };
        if (o.stage !== 1) continue;
        if (o.deployedTurn !== undefined && o.deployedTurn >= turn) continue;
        if (o.type === "salvoMS" || o.type === "missile") {
            ids.push(o.id);
        }
    }
    return ids;
}

export function shipHasPendingMovement(
    shipId: string,
    pendingMoves: { name: string; id?: string }[] | undefined
): boolean {
    return (pendingMoves ?? []).some(
        (c) => c.name === "moveShip" && c.id === shipId
    );
}

export interface PlacementValidationInput {
    ship: ShipGameState;
    system: LaunchableSystem;
    target: Point;
    turn: number;
    phase: number;
}

export function validatePlacement(
    input: PlacementValidationInput
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const { ship, system, target } = input;
    const shipPos = ship.position;
    if (!shipPos || !("x" in shipPos)) {
        issues.push({ message: "Ship has no position.", severity: "error" });
        return issues;
    }
    const dist = distance(shipPos, target);
    const maxR = launchRange(system.gameType, system.modifier);
    if (dist > maxR) {
        issues.push({
            message: `Target is ${dist.toFixed(1)} MU away (max ${maxR} MU).`,
            severity: "error",
        });
    }
    const facing = (ship.facing ?? 12) as ClockFacing;
    if (
        !bearingInSystemArc(
            shipPos,
            facing,
            target,
            system.leftArc,
            system.numArcs
        )
    ) {
        const arc = bearingWeaponArc(shipPos, facing, target);
        const arcLabel =
            system.leftArc && system.numArcs
                ? `${system.leftArc}×${system.numArcs}`
                : "full";
        issues.push({
            message: `Target is in arc ${arc} (launcher covers ${arcLabel}).`,
            severity: "error",
        });
    }
    if (
        (system.gameType === "missile" ||
            system.gameType === "salvo" ||
            system.gameType === "salvoER" ||
            system.gameType === "salvoMS") &&
        operationalFireControls(ship).length === 0
    ) {
        issues.push({
            message: "No operational fire control for missile/salvo launch.",
            severity: "warning",
        });
    }
    if (system.gameType === "plasmaBolt") {
        const pbl = (ship as { pblFiredTurn?: Record<string, number> })
            .pblFiredTurn;
        const last = pbl?.[system.systemId];
        if (last !== undefined && last >= input.turn - 1) {
            issues.push({
                message: "PBL may only fire every other turn.",
                severity: "warning",
            });
        }
    }
    issues.push({
        message: "Line of sight is not checked.",
        severity: "warning",
    });
    return issues;
}

export function validateRocketTarget(
    ship: ShipGameState,
    system: LaunchableSystem,
    targetShip: ShipGameState,
    turn: number
): ValidationIssue[] {
    const shipPos = ship.position;
    const tgtPos = targetShip.position;
    if (!shipPos || !("x" in shipPos) || !tgtPos || !("x" in tgtPos)) {
        return [{ message: "Ship or target has no position.", severity: "error" }];
    }
    const dist = distance(shipPos, tgtPos);
    if (dist > 18) {
        return [
            {
                message: `Target is ${dist.toFixed(1)} MU away (max 18 MU for rockets).`,
                severity: "error",
            },
        ];
    }
    const facing = (ship.facing ?? 12) as ClockFacing;
    if (
        !bearingInSystemArc(
            shipPos,
            facing,
            tgtPos,
            system.leftArc,
            system.numArcs
        )
    ) {
        const arc = bearingWeaponArc(shipPos, facing, tgtPos);
        const arcLabel =
            system.leftArc && system.numArcs
                ? `${system.leftArc}×${system.numArcs}`
                : "full";
        return [
            {
                message: `Target is in arc ${arc} (rocket pod covers ${arcLabel}).`,
                severity: "error",
            },
        ];
    }
    return [
        ...validatePlacement({
            ship,
            system,
            target: tgtPos,
            turn,
            phase: 3,
        }).filter((i) => !i.message.includes("Line of sight")),
        { message: "Line of sight is not checked.", severity: "warning" },
    ];
}

export function multistageIntermediatePoint(
    shipPos: Point,
    aim: Point,
    minDist = 16,
    maxDist = 24
): Point {
    const d = distance(shipPos, aim);
    const useDist = Math.min(maxDist, Math.max(minDist, Math.min(d, maxDist)));
    if (d < 0.001) return { x: shipPos.x, y: shipPos.y + useDist };
    const t = useDist / d;
    return {
        x: shipPos.x + (aim.x - shipPos.x) * t,
        y: shipPos.y + (aim.y - shipPos.y) * t,
    };
}
