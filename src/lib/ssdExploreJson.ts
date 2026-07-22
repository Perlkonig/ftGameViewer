/** Resolve SSD click targets to ship JSON for the Explore tab. */

import type { FullThrustShip } from "ftlibship";
import { resolveHangarOccupancy } from "ftlibship";
import type { FullThrustGameObjects } from "@/schemas/position";

const SSD_SPECIAL_IDS = new Set(["_hull", "_drive", "_core", "_ftl"]);

type ShipGameObj = FullThrustGameObjects & { objType: "ship" };

function systemLists(ship: FullThrustShip) {
    return [...(ship.systems ?? []), ...(ship.ordnance ?? []), ...(ship.weapons ?? [])];
}

export function collectShipSystemIds(ship: FullThrustShip): Set<string> {
    const ids = new Set<string>();
    for (const entry of systemLists(ship)) {
        const id = (entry as { id?: string }).id;
        if (id) ids.add(id);
    }
    return ids;
}

/** Walk from click target to an actionable SSD element id. */
export function findSsdClickId(
    target: EventTarget | null,
    container: Element,
    ship: FullThrustShip
): string | undefined {
    const systemIds = collectShipSystemIds(ship);
    let el = target instanceof Element ? target : null;
    while (el && el !== container) {
        const id = el.getAttribute("id");
        if (id && id.length > 0) {
            if (SSD_SPECIAL_IDS.has(id) || systemIds.has(id)) {
                return id;
            }
        }
        el = el.parentElement;
    }
    return undefined;
}

export function jsonForSsdTarget(
    shipSrc: FullThrustShip,
    shipObj: ShipGameObj,
    targetId: string
): unknown {
    switch (targetId) {
        case "_hull": {
            const hull: Record<string, unknown> = {};
            if (shipSrc.hull) hull.hull = shipSrc.hull;
            if (shipSrc.armour?.length) hull.armour = shipSrc.armour;
            if (shipObj.dmgHull !== undefined) hull.dmgHull = shipObj.dmgHull;
            if (shipObj.dmgArmour?.length) hull.dmgArmour = shipObj.dmgArmour;
            return hull;
        }
        case "_drive": {
            const drive = shipSrc.systems?.find((s) => s.name === "drive");
            if (!drive) return { note: "No drive system in this ship design." };
            const runtime = shipObj.systems?.find((s) => s.id === (drive as { id?: string }).id);
            return runtime ? { ...drive, state: runtime.state } : drive;
        }
        case "_ftl": {
            const ftl = shipSrc.systems?.find((s) => s.name === "ftl");
            if (!ftl) return { note: "No FTL drive in this ship design." };
            const runtime = shipObj.systems?.find((s) => s.id === (ftl as { id?: string }).id);
            return runtime ? { ...ftl, state: runtime.state } : ftl;
        }
        case "_core":
            return {
                note: "Bridge, life support, and reactor are game-state core systems (not separate SSD entries).",
                ids: {
                    bridge: "_coreBridge",
                    lifeSupport: "_coreLife",
                    reactor: "_corePower",
                },
                coreState: shipObj.coreState ?? null,
            };
        default: {
            const sys = systemLists(shipSrc).find((s) => (s as { id?: string }).id === targetId);
            if (!sys) return { message: `No matching entry for id '${targetId}'` };
            const runtime = shipObj.systems?.find((s) => s.id === targetId);
            const base = runtime ? { ...sys, state: runtime.state } : sys;
            if ((sys as { name?: string }).name === "hangar") {
                const hangars = (shipObj as { hangars?: import("ftlibship").HangarState }).hangars;
                return {
                    ...base,
                    occupancy: resolveHangarOccupancy(targetId, shipSrc, hangars),
                };
            }
            return base;
        }
    }
}

export function prettifyJson(value: unknown): string {
    return JSON.stringify(value, null, 2);
}
