import type { FullThrustGameObjects } from "@/schemas/position";
import type { FullThrustShip } from "ftlibship";
import type { MapViewportMu } from "@/stores/writeMapView";
import { fighterGroupLabel } from "@/lib/game/fighterLabel";
import { gunboatGroupLabel, formatGunboatComposition } from "@/lib/game/gunboatLabel";
import { isSalvoOrdnanceType, salvoMissileCount } from "@/lib/game/salvoOrdnance";
import { objectRefKey, type ObjectRef } from "./objectRef";

const CLICKABLE_TYPES = new Set(["ship", "fighters", "gunboats", "ordnance"]);

export interface ExploreListEntry {
    ref: ObjectRef;
    key: string;
    id: string;
    objType: ObjectRef["objType"];
    owner?: string;
    mass: number;
    position: { x: number; y: number };
    label: string;
    detail: string;
    /** Position, facing, course, and speed formatted for list display. */
    motionLine: string;
}

export function objectMass(obj: FullThrustGameObjects): number {
    if (obj.objType === "ship") {
        const mass = shipDesignMass(obj);
        return mass ?? 75;
    }
    return 0;
}

export function isShipOnMap(obj: FullThrustGameObjects): boolean {
    return obj.objType === "ship" && getMapObjectPosition(obj) !== undefined;
}

/** Mass from the as-placed design object, not runtime damage state. */
export function shipDesignMass(obj: FullThrustGameObjects): number | undefined {
    if (obj.objType !== "ship") return undefined;
    const mass = (obj.object as FullThrustShip | undefined)?.mass;
    return typeof mass === "number" && Number.isFinite(mass) ? mass : undefined;
}

export interface ShipDesignStats {
    mass?: number;
    cpv?: number;
    npv?: number;
}

/** NPV from the as-placed design: the ship's `points` value. */
export function shipNpv(obj: FullThrustGameObjects): number | undefined {
    if (obj.objType !== "ship") return undefined;
    const points = (obj.object as FullThrustShip | undefined)?.points;
    return typeof points === "number" && Number.isFinite(points) ? points : undefined;
}

/** Mass, CPV, and NPV from the as-placed design object. */
export function shipDesignStats(obj: FullThrustGameObjects): ShipDesignStats | undefined {
    if (obj.objType !== "ship") return undefined;
    return {
        mass: shipDesignMass(obj),
        cpv: shipCpv(obj),
        npv: shipNpv(obj),
    };
}

export function shipsOnMap(
    objects: FullThrustGameObjects[] | undefined
): FullThrustGameObjects[] {
    return (objects ?? []).filter(isShipOnMap);
}

export function shipCpv(obj: FullThrustGameObjects): number | undefined {
    if (obj.objType !== "ship") return undefined;
    const cpv = (obj.object as FullThrustShip | undefined)?.cpv;
    return typeof cpv === "number" && Number.isFinite(cpv) ? cpv : undefined;
}

export function getMapObjectPosition(
    obj: FullThrustGameObjects
): { x: number; y: number } | undefined {
    const pos = obj.position;
    if (pos == null || typeof pos !== "object" || !("x" in pos)) return undefined;
    const x = (pos as { x?: number }).x;
    const y = (pos as { y?: number }).y;
    if (typeof x !== "number" || typeof y !== "number") return undefined;
    return { x, y };
}

export function isObjectInViewport(
    obj: FullThrustGameObjects,
    viewport: MapViewportMu
): boolean {
    const pos = getMapObjectPosition(obj);
    if (!pos) return false;
    return (
        pos.x >= viewport.minX &&
        pos.x <= viewport.maxX &&
        pos.y >= viewport.minY &&
        pos.y <= viewport.maxY
    );
}

function exploreObjectOwner(obj: FullThrustGameObjects): string | undefined {
    if (obj.objType === "ship" || obj.objType === "fighters" || obj.objType === "gunboats") {
        return obj.owner;
    }
    if (
        obj.objType === "ordnance" &&
        "owner" in obj &&
        typeof obj.owner === "string"
    ) {
        return obj.owner;
    }
    return undefined;
}

const EXPLORE_TYPE_RANK: Record<"ship" | "fighters" | "gunboats" | "ordnance", number> = {
    ship: 0,
    fighters: 1,
    gunboats: 2,
    ordnance: 3,
};

function exploreTypeRank(obj: FullThrustGameObjects): number {
    if (obj.objType in EXPLORE_TYPE_RANK) {
        return EXPLORE_TYPE_RANK[obj.objType as keyof typeof EXPLORE_TYPE_RANK];
    }
    return 99;
}
function ownerSortOrder(
    owner: string | undefined,
    playerOrder: Map<string, number>,
    unownedOrder: number
): number {
    if (!owner) return unownedOrder + 1;
    return playerOrder.get(owner) ?? unownedOrder;
}

function formatExploreLabel(obj: FullThrustGameObjects): string {
    if (obj.objType === "fighters") {
        return fighterGroupLabel(obj);
    }
    if (obj.objType === "gunboats") {
        return gunboatGroupLabel(obj);
    }
    return obj.id;
}

function formatExploreDetail(obj: FullThrustGameObjects): string {
    if (obj.objType === "ship") {
        return `Ship · mass ${objectMass(obj)}`;
    }
    if (obj.objType === "fighters") {
        const label = fighterGroupLabel(obj);
        const base = `Fighters · ${obj.type ?? "standard"} ×${obj.number ?? "?"} · endurance ${obj.endurance ?? "?"}`;
        return label !== obj.id ? `${base} · ${obj.id}` : base;
    }
    if (obj.objType === "gunboats") {
        const label = gunboatGroupLabel(obj);
        const mix = formatGunboatComposition(obj, "abbrev");
        const mixPart = mix ? ` (${mix})` : "";
        const base = `Gunboats · ×${obj.number ?? "?"}${mixPart} · endurance ${obj.endurance ?? "?"}`;
        return label !== obj.id ? `${base} · ${obj.id}` : base;
    }
    return `Ordnance · ${obj.type}${salvoSuffix(obj)}`;
}

function salvoSuffix(obj: { type?: string; salvoCount?: number }): string {
    if (!isSalvoOrdnanceType(obj.type)) return "";
    return ` · ×${salvoMissileCount(obj)}`;
}

export function formatCoordinatePair(x: number, y: number, digits = 1): string {
    return `${x.toFixed(digits)}, ${y.toFixed(digits)}`;
}

/** Human-readable position and movement state for object list rows. */
export function formatObjectMotionLine(
    obj: FullThrustGameObjects,
    position: { x: number; y: number }
): string {
    const parts: string[] = [formatCoordinatePair(position.x, position.y)];

    if (obj.objType === "ship") {
        if (typeof obj.facing === "number") {
            parts.push(`facing ${obj.facing}`);
        }
        if (typeof obj.course === "number") {
            parts.push(`course ${obj.course}°`);
        }
        if (typeof obj.speed === "number") {
            parts.push(`speed ${obj.speed}`);
        }
    } else if (obj.objType === "fighters" && typeof obj.facing === "number") {
        parts.push(`facing ${obj.facing}`);
    } else if (obj.objType === "gunboats" && typeof obj.facing === "number") {
        parts.push(`facing ${obj.facing}`);
    }

    return parts.join(" · ");
}

export type ExploreListScope = "all" | "visible";

export interface ListExploreObjectsOptions {
    scope?: ExploreListScope;
    viewport?: MapViewportMu;
}

function normalizePlayerIds(playerIds: unknown): string[] {
    if (Array.isArray(playerIds)) {
        return playerIds.filter((id): id is string => typeof id === "string");
    }
    return [];
}

export function listExploreObjects(
    objects: FullThrustGameObjects[] | undefined,
    playerIds: unknown,
    options: ListExploreObjectsOptions = {}
): ExploreListEntry[] {
    if (!objects?.length) return [];

    const scope = options.scope ?? "all";
    const viewport = options.viewport;
    const orderedPlayerIds = normalizePlayerIds(playerIds);
    const playerOrder = new Map(orderedPlayerIds.map((id, i) => [id, i]));
    const unownedOrder = orderedPlayerIds.length;

    const listed = objects.filter((o) => {
        if (!CLICKABLE_TYPES.has(o.objType)) return false;
        if (!getMapObjectPosition(o)) return false;
        if (scope === "visible") {
            if (!viewport) return false;
            return isObjectInViewport(o, viewport);
        }
        return true;
    });

    const launchOrder = new Map(objects.map((o, i) => [o.id, i]));

    listed.sort((a, b) => {
        const aOrder = ownerSortOrder(exploreObjectOwner(a), playerOrder, unownedOrder);
        const bOrder = ownerSortOrder(exploreObjectOwner(b), playerOrder, unownedOrder);
        if (aOrder !== bOrder) return aOrder - bOrder;

        const typeDiff = exploreTypeRank(a) - exploreTypeRank(b);
        if (typeDiff !== 0) return typeDiff;

        if (a.objType === "ship" && b.objType === "ship") {
            const massDiff = objectMass(b) - objectMass(a);
            if (massDiff !== 0) return massDiff;
            return a.id.localeCompare(b.id, undefined, { sensitivity: "base" });
        }

        if (a.objType === "fighters" && b.objType === "fighters") {
            const labelCmp = fighterGroupLabel(a).localeCompare(fighterGroupLabel(b), undefined, {
                sensitivity: "base",
                numeric: true,
            });
            if (labelCmp !== 0) return labelCmp;
            return a.id.localeCompare(b.id, undefined, { sensitivity: "base" });
        }

        if (a.objType === "gunboats" && b.objType === "gunboats") {
            const labelCmp = gunboatGroupLabel(a).localeCompare(gunboatGroupLabel(b), undefined, {
                sensitivity: "base",
                numeric: true,
            });
            if (labelCmp !== 0) return labelCmp;
            return a.id.localeCompare(b.id, undefined, { sensitivity: "base" });
        }

        if (a.objType === "ordnance" && b.objType === "ordnance") {
            return (launchOrder.get(a.id) ?? 0) - (launchOrder.get(b.id) ?? 0);
        }

        return a.id.localeCompare(b.id, undefined, { sensitivity: "base" });
    });

    return listed.map((obj) => {
        const ref = { objType: obj.objType as ObjectRef["objType"], objId: obj.id };
        const position = getMapObjectPosition(obj)!;
        const owner =
            obj.objType === "ship" ||
            obj.objType === "fighters" ||
            obj.objType === "gunboats"
                ? obj.owner
                : "owner" in obj && typeof obj.owner === "string"
                  ? obj.owner
                  : undefined;
        return {
            ref,
            key: objectRefKey(ref),
            id: obj.id,
            objType: ref.objType,
            owner,
            mass: objectMass(obj),
            position,
            label: formatExploreLabel(obj),
            detail: formatExploreDetail(obj),
            motionLine: formatObjectMotionLine(obj, position),
        };
    });
}
