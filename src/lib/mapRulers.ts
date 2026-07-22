export type RulerTickLevel = "major" | "half" | "quarter";

export interface RulerTick {
    /** Position along the axis in map pixels. */
    coordPx: number;
    level: RulerTickLevel;
}

/** How many divisions per MU to draw at the current zoom level. */
export function rulerSubdivisions(visibleSizePx: number, pixelsPerMU: number): number {
    if (visibleSizePx <= 0 || pixelsPerMU <= 0) return 1;
    const visibleMu = visibleSizePx / pixelsPerMU;
    if (visibleMu <= 6) return 4;
    if (visibleMu <= 18) return 2;
    return 1;
}

export function generateRulerTicks(
    viewStartPx: number,
    viewSizePx: number,
    pixelsPerMU: number
): RulerTick[] {
    if (viewSizePx <= 0 || pixelsPerMU <= 0) return [];

    const subdivisions = rulerSubdivisions(viewSizePx, pixelsPerMU);
    const stepPx = pixelsPerMU / subdivisions;
    const viewEnd = viewStartPx + viewSizePx;
    const first = Math.floor(viewStartPx / stepPx) * stepPx;
    const ticks: RulerTick[] = [];
    const seen = new Set<number>();

    for (let px = first; px <= viewEnd + stepPx * 0.001; px += stepPx) {
        const rounded = Math.round(px * 1000) / 1000;
        if (seen.has(rounded)) continue;
        seen.add(rounded);

        const mu = rounded / pixelsPerMU;
        const wholeMu = Math.abs(mu - Math.round(mu)) < 1e-6;
        const halfMu =
            subdivisions >= 2 &&
            !wholeMu &&
            Math.abs(mu * 2 - Math.round(mu * 2)) < 1e-6;

        let level: RulerTickLevel = "quarter";
        if (wholeMu) level = "major";
        else if (halfMu) level = "half";
        else if (subdivisions < 4) continue;

        ticks.push({
            coordPx: rounded,
            level,
        });
    }

    return ticks;
}

export function rulerTickLength(level: RulerTickLevel, rulerWidth: number): number {
    switch (level) {
        case "major":
            return rulerWidth;
        case "half":
            return rulerWidth / 2;
        case "quarter":
            return rulerWidth / 4;
    }
}

export function rulerTickStroke(level: RulerTickLevel, pixelsPerMU: number): number {
    const base = pixelsPerMU / 10;
    switch (level) {
        case "major":
            return base;
        case "half":
            return base / 2;
        case "quarter":
            return base / 4;
    }
}
