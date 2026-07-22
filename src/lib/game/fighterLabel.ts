/** Display labels for fighter groups (callsign vs internal id). */

import type { FullThrustGamePosition } from "@/schemas/position";
import type { ResolvedHangarOccupancy } from "ftlibship";

export const FIGHTER_CALLSIGN_MAX_LENGTH = 32;

type FighterObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "fighters" }
>;

export function normalizeCallsign(raw: string | undefined): string | undefined {
    if (raw === undefined) return undefined;
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    return trimmed.slice(0, FIGHTER_CALLSIGN_MAX_LENGTH);
}

export function fighterGroupLabel(f: { id: string; callsign?: string }): string {
    const name = normalizeCallsign(
        (f as { callsign?: string }).callsign
    );
    return name ?? f.id;
}

export function fighterGroupOptionLabel(f: FighterObj): string {
    const base = fighterGroupLabel(f);
    const n = f.number ?? 6;
    return `${base} (${f.type ?? "standard"} ×${n})`;
}

export function wingLaunchRowLabel(
    hangarId: string,
    w: ResolvedHangarOccupancy,
    fighterObj?: FighterObj
): string {
    const type = w.type ?? "standard";
    const number = w.number ?? 6;
    let skill = "";
    if (w.skill && w.skill !== "standard") skill = ` (${w.skill})`;
    if (fighterObj) {
        const name = normalizeCallsign((fighterObj as { callsign?: string }).callsign);
        if (name) return `${name} — ${type} ×${number}${skill}`;
    }
    return `${hangarId}: ${type} ×${number}${skill}`;
}

export function dockedFighterForHangar(
    position: FullThrustGamePosition | undefined,
    shipId: string,
    hangarId: string
): FighterObj | undefined {
    const wingId = `${shipId}_${hangarId}`;
    const obj = position?.objects?.find(
        (o) => o.objType === "fighters" && o.id === wingId
    );
    return obj as FighterObj | undefined;
}
