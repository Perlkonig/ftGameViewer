/** Reactor explosion area blast (phase 15, optional). */

import type { FullThrustGameCommand } from "@/schemas/commands";
import type { FullThrustGamePosition } from "@/schemas/position";
import type { RollSource } from "./dice";
import {
    applyAdvancedScreenReduction,
    screenLevelFromSystems,
    type ScreenLevel,
} from "./combat";
import { objectsInRadius } from "./ordnanceBlast";
import { distance, type Point } from "./movement";
import { isDeployedFighter } from "./fighterMove";
import { pushHullDamageCommands } from "./resolveCombat";
import { thresholdsCrossed, hullLayout } from "./thresholds";
import { makeLogDice } from "./rollResults";
import type { GameMeta } from "./types";
import { reactorBreachesEnabled } from "./types";

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

const BREACH_RADIUS_MU = 3;

export function reactorBreachDiceCount(mass: number): number {
    return Math.max(1, Math.floor(mass / 25));
}

export function shipMass(ship: { object?: { mass?: number }; mass?: number }): number {
    const fromObj = (ship.object as { mass?: number } | undefined)?.mass;
    if (typeof fromObj === "number") return fromObj;
    if (typeof ship.mass === "number") return ship.mass;
    return 50;
}

function mapPoint(obj: { position?: unknown }): Point | undefined {
    const pos = obj.position;
    if (!pos || typeof pos !== "object" || !("x" in pos)) return undefined;
    return pos as Point;
}

function shipAdvancedScreens(ship: ShipObj): 0 | 1 | 2 {
    const systems = (ship.object as { systems?: { name?: string; type?: string; level?: number }[] })
        ?.systems;
    const screens = screenLevelFromSystems(Array.isArray(systems) ? systems : []);
    return (screens > 1 ? 2 : screens) as 0 | 1 | 2;
}

function rollD6Pool(count: number, source: RollSource): number[] {
    const rolls: number[] = [];
    for (let i = 0; i < count; i++) rolls.push(source.next());
    return rolls;
}

function breachTargetsInRadius(
    position: FullThrustGamePosition,
    center: Point,
    excludeId: string
): Array<{ id: string; objType: "ship" | "fighters" | "ordnance"; dist: number }> {
    const out: Array<{ id: string; objType: "ship" | "fighters" | "ordnance"; dist: number }> = [];
    for (const obj of position.objects ?? []) {
        if (obj.id === excludeId) continue;
        if (obj.objType !== "ship" && obj.objType !== "fighters" && obj.objType !== "ordnance") {
            continue;
        }
        if (obj.objType === "fighters" && !isDeployedFighter(obj)) continue;
        const p = mapPoint(obj);
        if (!p) continue;
        const dist = distance(center, p);
        if (dist <= BREACH_RADIUS_MU + 1e-6) {
            out.push({ id: obj.id, objType: obj.objType, dist });
        }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
}

export interface ReactorBreachBlastResult {
    commands: FullThrustGameCommand[];
    rolls: number[];
    summary: string;
    pendingThresholdShips: string[];
}

/** SAP blast within 3 MU of exploding ship; standard screens ignored. */
export function resolveReactorBreachBlast(
    position: FullThrustGamePosition,
    centerShipId: string,
    explodingMass: number,
    source: RollSource,
    meta: GameMeta
): ReactorBreachBlastResult {
    if (!reactorBreachesEnabled(meta)) {
        return { commands: [], rolls: [], summary: "", pendingThresholdShips: [] };
    }

    const centerShip = position.objects?.find(
        (o) => o.id === centerShipId && o.objType === "ship"
    ) as ShipObj | undefined;
    const center = centerShip ? mapPoint(centerShip) : undefined;
    if (!center) {
        return {
            commands: [],
            rolls: [],
            summary: `Reactor breach ${centerShipId}: ship not on map`,
            pendingThresholdShips: [],
        };
    }

    const diceCount = reactorBreachDiceCount(explodingMass);
    const mark = source.mark();
    const cmds: FullThrustGameCommand[] = [];
    const hitLines: string[] = [];
    const pendingThresholdShips: string[] = [];
    const targets = breachTargetsInRadius(position, center, centerShipId);

    for (const t of targets) {
        const dice = rollD6Pool(diceCount, source);
        const obj = position.objects?.find((o) => o.id === t.id);
        if (!obj) continue;

        if (obj.objType === "ship") {
            const ship = obj as ShipObj;
            const reduced = applyAdvancedScreenReduction(dice, shipAdvancedScreens(ship));
            const total = reduced.reduce((a, b) => a + b, 0);
            if (total <= 0) {
                hitLines.push(`${t.id} ship 0 SAP (${dice.join(",")}→${reduced.join(",")})`);
                continue;
            }
            const dmgBefore = Number(ship.dmgHull ?? 0) || 0;
            const applied = pushHullDamageCommands(cmds, t.id, ship, total, 0, "SAP");
            if (applied) {
                const { hullBoxes, rows } = hullLayout(ship);
                const crossing = thresholdsCrossed(
                    hullBoxes,
                    rows,
                    dmgBefore,
                    dmgBefore + applied.hullDamage
                );
                if (
                    crossing.thresholdsCrossed > 0 &&
                    crossing.thresholdIndex > (ship.thresholdRowsResolved ?? 0)
                ) {
                    pendingThresholdShips.push(t.id);
                }
            }
            hitLines.push(`${t.id} ship ${total} SAP (${dice.join(",")})`);
        } else if (obj.objType === "fighters") {
            const reduced = applyAdvancedScreenReduction(dice, 0 as ScreenLevel);
            const total = reduced.reduce((a, b) => a + b, 0);
            const casualties = Math.min(obj.number ?? 6, total);
            if (casualties > 0) {
                cmds.push({
                    name: "adjustFighters",
                    id: t.id,
                    number: Math.max(0, (obj.number ?? 6) - casualties),
                } as FullThrustGameCommand);
            }
            hitLines.push(`${t.id} fighters ${casualties} killed (d6 pool=${dice.join(",")})`);
        } else if (obj.objType === "ordnance") {
            const reduced = applyAdvancedScreenReduction(dice, 0 as ScreenLevel);
            const total = reduced.reduce((a, b) => a + b, 0);
            if (total >= 1) {
                cmds.push({ name: "objDestroy", uuid: t.id } as FullThrustGameCommand);
                hitLines.push(`${t.id} ordnance destroyed (${total} damage)`);
            } else {
                hitLines.push(`${t.id} ordnance survives (${total} damage)`);
            }
        }
    }

    const rolls = source.consumedSince(mark);
    const summary =
        hitLines.length > 0
            ? `Reactor breach from ${centerShipId} (${diceCount}d6 SAP, ${BREACH_RADIUS_MU} MU): ${hitLines.join("; ")}`
            : `Reactor breach from ${centerShipId}: no targets within ${BREACH_RADIUS_MU} MU`;

    if (rolls.length > 0) {
        cmds.push(
            makeLogDice({
                purpose: `reactorBreach: ${centerShipId}`,
                rolls,
                source: "client",
                result: summary,
            })
        );
    }
    cmds.push({ name: "_custom", msg: summary } as FullThrustGameCommand);

    return { commands: cmds, rolls, summary, pendingThresholdShips };
}
