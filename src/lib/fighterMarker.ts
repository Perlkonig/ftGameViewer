/** Build ftLibShip fighter triangle map symbols. */

import type { FullThrustShip } from "ftlibship";
import { systems, type FighterSkill, type FighterType } from "ftlibship";
import type { Hangar } from "ftlibship/dist/lib/systems/hangar.js";

const STUB_SHIP = { systems: [], orientation: "alpha" } as FullThrustShip;

export interface FighterSymbolSpec {
    id: string;
    svg: string;
    widthMu: number;
    heightMu: number;
}

export interface FighterWingVisual {
    type: string;
    number?: number;
    skill?: FighterSkill;
}

/** Tactical-map token size (MU). Glyph art is authored at ~2×3 MU. */
export const FIGHTER_MAP_TOKEN_W_MU = 0.25;
export const FIGHTER_MAP_TOKEN_H_MU = 0.375;
/** Fallback circle marker when no SVG is available. */
export const FIGHTER_MAP_TOKEN_RADIUS_MU = 0.14;

export function buildFighterSymbol(
    wingId: string,
    wing: FighterWingVisual
): FighterSymbolSpec {
    const hangar = systems.getSystem(
        { name: "hangar", id: `map_${wingId}` },
        STUB_SHIP
    ) as Hangar | undefined;
    if (!hangar?.glyph) {
        return {
            id: wingId,
            svg: `<symbol id="${wingId}" viewBox="320 35.75 319 478.5"><polygon fill="white" stroke="#000000" stroke-width="12" points="480,63.6 553.4,280 626.8,496.4 480,496.4 333.2,496.4 406.6,280"/></symbol>`,
            widthMu: 2,
            heightMu: 3,
        };
    }
    hangar.occupancy = {
        hangarId: hangar.id,
        occupied: true,
        deployed: false,
        type: (wing.type as FighterType) ?? "standard",
        number: wing.number ?? 6,
        capacity: 6,
        isPartial: (wing.number ?? 6) < 6,
        skill: wing.skill ?? "standard",
    };
    const glyph = hangar.glyph();
    const svg = glyph.svg.replace(
        new RegExp(`id="${glyph.id}"`),
        `id="${wingId}"`
    );
    return {
        id: wingId,
        svg,
        widthMu: glyph.width ?? 2,
        heightMu: glyph.height ?? 3,
    };
}
