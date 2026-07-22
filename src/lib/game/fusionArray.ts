/** Fusion array hit/damage tables (§5.19). */

export type FusionMode = "flare" | "torpedo";

export function fusionHitThreshold(rangeMu: number, mode: FusionMode): number {
    const band = Math.min(5, Math.max(0, Math.floor(rangeMu / 6)));
    if (mode === "flare") return band + 1;
    return 6 - band;
}

export function fusionDamageDice(rangeMu: number, mode: FusionMode): number {
    const band = Math.min(5, Math.max(0, Math.floor(rangeMu / 6)));
    if (mode === "flare") return band + 1;
    return 6 - band;
}

export function fusionInRange(rangeMu: number): boolean {
    return rangeMu >= 0 && rangeMu <= 36;
}
