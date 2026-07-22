import { writable } from "svelte/store";

export const PIXELS_PER_MU = 100;

export interface MapViewportMu {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

export interface MapFocusRequest {
    x: number;
    y: number;
    sizeMu?: number;
    /** When set, fit the viewport to these map bounds (MU) instead of a fixed square. */
    bounds?: {
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
        paddingMu?: number;
    };
}

export function focusMapOnBounds(
    bounds: { minX: number; minY: number; maxX: number; maxY: number },
    paddingMu = 2
): void {
    mapFocusRequest.set({
        x: (bounds.minX + bounds.maxX) / 2,
        y: (bounds.minY + bounds.maxY) / 2,
        bounds: { ...bounds, paddingMu },
    });
}

export const mapViewport = writable<MapViewportMu>({
    minX: 0,
    minY: 0,
    maxX: 72,
    maxY: 48,
});

export const mapFocusRequest = writable<MapFocusRequest | undefined>(undefined);

/** When true, map shows movement preview lines for all ships. */
export const showTrajectories = writable(true);

export function focusMapOnPoint(x: number, y: number, sizeMu = 24): void {
    mapFocusRequest.set({ x, y, sizeMu });
}
