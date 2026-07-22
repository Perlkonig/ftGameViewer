/** Build ftLibShip ordnance launcher glyphs for map tokens. */

import type { FullThrustShip } from "ftlibship";
import { systems } from "ftlibship";
import { findShipSystem, type ShipGameState, type ShipSystemEntry } from "@/lib/game/shipSystems";

export interface OrdnanceGlyphSpec {
    svg: string;
    widthMu: number;
    heightMu: number;
}

interface RawOrdnanceGlyph {
    svg: string;
    widthMu: number;
    heightMu: number;
    glyphId: string;
}

function magazineMissileGlyph(
    ship: ShipGameState,
    magazineId: string
): RawOrdnanceGlyph | undefined {
    const magEntry = findShipSystem(ship, magazineId);
    if (!magEntry || (magEntry.name ?? "").toLowerCase() !== "magazine") return undefined;
    const ssd = ship.object as FullThrustShip;
    const inst = systems.getSystem(
        { ...magEntry, id: magazineId, name: magEntry.name } as never,
        ssd
    );
    if (!inst || typeof (inst as { missileGlyph?: () => unknown }).missileGlyph !== "function") {
        return undefined;
    }
    const glyph = (
        inst as {
            missileGlyph: () => {
                id: string;
                svg: string;
                width?: number;
                height?: number;
            };
        }
    ).missileGlyph();
    if (!glyph) return undefined;
    return {
        svg: glyph.svg,
        widthMu: glyph.width ?? 1,
        heightMu: glyph.height ?? 1,
        glyphId: glyph.id,
    };
}

function launcherGlyph(
    ship: ShipGameState,
    sys: ShipSystemEntry,
    systemId: string
): RawOrdnanceGlyph | undefined {
    const ssd = ship.object as FullThrustShip;
    const data = { ...sys, id: systemId, name: sys.name } as Record<string, unknown>;
    const inst = systems.getSystem(data as never, ssd);
    if (!inst || typeof inst.glyph !== "function") return undefined;
    const glyph = inst.glyph();
    if (!glyph) return undefined;
    return {
        svg: glyph.svg,
        widthMu: glyph.width ?? 2,
        heightMu: glyph.height ?? 2,
        glyphId: glyph.id,
    };
}

function ordnanceGlyphFromLauncher(
    ship: ShipGameState,
    systemId: string
): RawOrdnanceGlyph | undefined {
    const sys = findShipSystem(ship, systemId);
    if (!sys) return undefined;
    const magazineId = (sys as { magazine?: string }).magazine;
    if (magazineId) {
        const fromMag = magazineMissileGlyph(ship, magazineId);
        if (fromMag) return fromMag;
    }
    return launcherGlyph(ship, sys, systemId);
}

export function ordnanceGlyphForSystem(
    ship: ShipGameState,
    systemId: string
): OrdnanceGlyphSpec | undefined {
    const base = ordnanceGlyphFromLauncher(ship, systemId);
    if (!base) return undefined;
    return {
        svg: base.svg,
        widthMu: base.widthMu,
        heightMu: base.heightMu,
    };
}

/** Map tokens reference #ordnanceId; ftLibShip glyph ids must be rewritten. */
export function buildOrdnanceSymbol(
    ship: ShipGameState,
    systemId: string,
    ordnanceId: string
): OrdnanceGlyphSpec | undefined {
    const base = ordnanceGlyphFromLauncher(ship, systemId);
    if (!base) return undefined;
    const svg = base.svg.replace(
        new RegExp(`id="${base.glyphId}"`),
        `id="${ordnanceId}"`
    );
    return {
        svg,
        widthMu: base.widthMu,
        heightMu: base.heightMu,
    };
}

export function systemEntryForLaunch(
    ship: ShipGameState,
    systemId: string
): ShipSystemEntry | undefined {
    return findShipSystem(ship, systemId);
}
