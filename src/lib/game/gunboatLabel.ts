import type { FullThrustGamePosition } from "@/schemas/position";
import { gunboatType2Abbrev, gunboatType2Name } from "ftlibship";
import type { GunboatType } from "ftlibship";
import { normalizeCallsign } from "./fighterLabel";
import { liveGunboatBoats } from "./gunboatProfiles";

type GunboatObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "gunboats" }
>;

export type GunboatLike = {
    id?: string;
    type?: string;
    number?: number;
    boats?: { type: string; id?: string }[];
};

export function gunboatBoatTypeCounts(gunboat: GunboatLike): Map<string, number> {
    const counts = new Map<string, number>();
    for (const boat of liveGunboatBoats(gunboat)) {
        counts.set(boat.type, (counts.get(boat.type) ?? 0) + 1);
    }
    return counts;
}

function gunboatTypeAbbrev(type: string): string {
    return (
        gunboatType2Abbrev.get(type as GunboatType) ??
        (type.length <= 3 ? type : type.slice(0, 2))
    );
}

export type GunboatCompositionStyle = "abbrev" | "full";

/** Human-readable boat mix, e.g. "Bm×2, Pl×1" or "Beam ×2, Plasma ×1". */
export function formatGunboatComposition(
    gunboat: GunboatLike,
    style: GunboatCompositionStyle = "abbrev"
): string {
    const counts = gunboatBoatTypeCounts(gunboat);
    if (counts.size === 0) return "";

    const entries = [...counts.entries()].sort((a, b) => {
        const la = style === "full" ? gunboatTypeLabel(a[0]) : gunboatTypeAbbrev(a[0]);
        const lb = style === "full" ? gunboatTypeLabel(b[0]) : gunboatTypeAbbrev(b[0]);
        return la.localeCompare(lb, undefined, { sensitivity: "base" });
    });

    return entries
        .map(([type, n]) => {
            const label = style === "full" ? gunboatTypeLabel(type) : gunboatTypeAbbrev(type);
            return `${label}×${n}`;
        })
        .join(", ");
}

export function gunboatGroupLabel(g: { id: string; callsign?: string }): string {
    const name = normalizeCallsign(g.callsign);
    return name ?? g.id;
}

export function gunboatGroupOptionLabel(g: GunboatObj): string {
    const base = gunboatGroupLabel(g);
    const n = g.number ?? 6;
    return `${base} (${g.type ?? "gunboat"} ×${n})`;
}

export function gunboatTypeLabel(type: string): string {
    return gunboatType2Name.get(type as GunboatType) ?? type;
}
