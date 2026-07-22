import type { FullThrustGamePosition } from "@/schemas/position";
import type { GameMap } from "./package";

export const FLUID_DEFAULT_WIDTH = 72;
export const FLUID_DEFAULT_HEIGHT = 48;
export const FLUID_DEFAULT_BUFFER = 12;

export interface MapBoundsMu {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

export function isFluidDynamic(meta: { turn: number; phase: number }): boolean {
    return meta.turn > 1 || meta.phase > 1;
}

export function fluidStartingWidth(map: GameMap): number {
    if (map.mode === "fluid" && typeof map.width === "number") return map.width;
    if (map.mode === "fixed") return map.width;
    return FLUID_DEFAULT_WIDTH;
}

export function fluidStartingHeight(map: GameMap): number {
    if (map.mode === "fluid" && typeof map.height === "number") return map.height;
    if (map.mode === "fixed") return map.height;
    return FLUID_DEFAULT_HEIGHT;
}

export function fluidDefaultBuffer(map: GameMap): number {
    if (map.mode === "fluid" && typeof map.buffer === "number") return map.buffer;
    return FLUID_DEFAULT_BUFFER;
}

export function startingMapBounds(map: GameMap): MapBoundsMu {
    return {
        minX: 0,
        minY: 0,
        maxX: fluidStartingWidth(map),
        maxY: fluidStartingHeight(map),
    };
}

function featureExtents(
    feature: { x: number; y: number; width: number; height: number }
): MapBoundsMu {
    const halfW = feature.width / 2;
    const halfH = feature.height / 2;
    return {
        minX: feature.x - halfW,
        minY: feature.y - halfH,
        maxX: feature.x + halfW,
        maxY: feature.y + halfH,
    };
}

export function collectObjectExtents(
    position: FullThrustGamePosition | undefined
): MapBoundsMu | undefined {
    if (!position) return undefined;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let found = false;

    for (const obj of position.objects ?? []) {
        const pos = obj.position;
        if (pos == null || typeof pos !== "object" || !("x" in pos)) continue;
        const x = (pos as { x: number }).x;
        const y = (pos as { y: number }).y;
        if (typeof x !== "number" || typeof y !== "number") continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        found = true;
    }

    for (const feature of position.mapFeatures ?? []) {
        const ext = featureExtents(feature);
        minX = Math.min(minX, ext.minX);
        minY = Math.min(minY, ext.minY);
        maxX = Math.max(maxX, ext.maxX);
        maxY = Math.max(maxY, ext.maxY);
        found = true;
    }

    if (!found) return undefined;
    return { minX, minY, maxX, maxY };
}

export function expandBounds(bounds: MapBoundsMu, bufferMu: number): MapBoundsMu {
    const pad = Math.max(0, bufferMu);
    return {
        minX: bounds.minX - pad,
        minY: bounds.minY - pad,
        maxX: bounds.maxX + pad,
        maxY: bounds.maxY + pad,
    };
}

export function computeMapBounds(
    map: GameMap,
    position: FullThrustGamePosition | undefined,
    meta: { turn: number; phase: number },
    bufferMu: number
): MapBoundsMu {
    if (map.mode !== "fluid" || !isFluidDynamic(meta)) {
        return startingMapBounds(map);
    }

    const extents = collectObjectExtents(position);
    const base = extents ?? startingMapBounds(map);
    return expandBounds(base, bufferMu);
}
