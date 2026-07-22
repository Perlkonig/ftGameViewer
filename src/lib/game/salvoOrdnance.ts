/** Salvo missile markers — one board token represents up to six missiles. */

export const SALVO_ORDNANCE_TYPES = ["salvo", "salvoER", "salvoMS"] as const;
export type SalvoOrdnanceType = (typeof SALVO_ORDNANCE_TYPES)[number];

export const DEFAULT_SALVO_MISSILE_COUNT = 6;

const SALVO_SET = new Set<string>(SALVO_ORDNANCE_TYPES);

export function isSalvoOrdnanceType(type: string | undefined): type is SalvoOrdnanceType {
    return !!type && SALVO_SET.has(type);
}

export function salvoMissileCount(ord: { type?: string; salvoCount?: number }): number | undefined {
    if (!isSalvoOrdnanceType(ord.type)) return undefined;
    const n = ord.salvoCount;
    if (typeof n === "number" && Number.isFinite(n)) return Math.max(0, Math.round(n));
    return DEFAULT_SALVO_MISSILE_COUNT;
}

export function initialSalvoFields(type: string | undefined): { salvoCount?: number } {
    if (isSalvoOrdnanceType(type)) return { salvoCount: DEFAULT_SALVO_MISSILE_COUNT };
    return {};
}

export function applySalvoMissileKills(
    ord: { salvoCount?: number; type?: string },
    kills: number
): { remaining: number; depleted: boolean } {
    const before = salvoMissileCount(ord) ?? 0;
    const remaining = Math.max(0, before - Math.max(0, kills));
    if (isSalvoOrdnanceType(ord.type)) {
        (ord as { salvoCount?: number }).salvoCount = remaining;
    }
    return { remaining, depleted: remaining <= 0 };
}
