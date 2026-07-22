/**
 * Game object UIDs used as HTML/SVG element ids (e.g. `ship_{id}`, `href="#{id}"`).
 * HTML5: no whitespace; we also exclude characters that break CSS selectors.
 */

import type { FullThrustGamePosition } from "@/schemas/position";
import { listShipSystems, type ShipGameState } from "@/lib/game/shipSystems";

export const HTML_UID_PATTERN = /^[A-Za-z0-9_\-]+$/;

export const HTML_UID_CHAR = /[A-Za-z0-9_\-]/;

export const HTML_UID_HELP =
    "Letters, numbers, hyphens, and underscores only (no spaces).";

/** Strip characters that are not valid in HTML object ids. */
export function screenHtmlUid(value: string): string {
    return [...value].filter((ch) => HTML_UID_CHAR.test(ch)).join("");
}

export function isValidHtmlUid(value: string): boolean {
    return value.length > 0 && HTML_UID_PATTERN.test(value);
}

export function assertValidHtmlUid(id: string, context: string): void {
    if (!isValidHtmlUid(id)) {
        throw new Error(`${context}: Invalid ID (use letters, numbers, hyphens, underscores)`);
    }
}

/** Screen input and assign back to a bound variable. */
export function handleHtmlUidInput(
    e: Event,
    setValue: (value: string) => void
): void {
    const el = e.currentTarget as HTMLInputElement;
    const next = screenHtmlUid(el.value);
    setValue(next);
    if (el.value !== next) {
        el.value = next;
    }
}

/** Map reserved element ids on the map / UI (not in game JSON but must not collide). */
const RESERVED_DOM_UIDS = new Set(["_beacon", "xRuler", "yRuler"]);

/** Collect every id string already used in the live game position. */
export function collectGameUids(
    state: FullThrustGamePosition | undefined
): Map<string, string[]> {
    const byId = new Map<string, string[]>();
    const add = (id: string, where: string) => {
        const trimmed = id.trim();
        if (!trimmed) return;
        const list = byId.get(trimmed) ?? [];
        list.push(where);
        byId.set(trimmed, list);
    };

    for (const id of RESERVED_DOM_UIDS) {
        add(id, "reserved map element");
    }

    for (const player of state?.players ?? []) {
        add(player.id, `player "${player.id}"`);
    }

    for (const feature of state?.mapFeatures ?? []) {
        if (feature && typeof feature === "object" && "id" in feature) {
            const fid = (feature as { id?: string }).id;
            if (fid) add(fid, `map feature "${fid}"`);
        }
    }

    for (const obj of state?.objects ?? []) {
        add(obj.id, `${obj.objType} "${obj.id}"`);
        if (obj.objType === "ship") {
            const ship = obj as ShipGameState;
            for (const sys of listShipSystems(ship)) {
                add(sys.id, `SSD system on ship "${obj.id}"`);
            }
            for (const sys of ship.systems ?? []) {
                add(sys.id, `system state on ship "${obj.id}"`);
            }
            for (const ammoId of ship.ammo ?? []) {
                add(ammoId, `ammo on ship "${obj.id}"`);
            }
        }
    }

    return byId;
}

export function gameUidInUse(
    state: FullThrustGamePosition | undefined,
    id: string,
    opts: { excludeId?: string } = {}
): boolean {
    return gameUidCollision(state, id, opts) !== null;
}

/** Human-readable collision message, or null if the id is available. */
export function gameUidCollision(
    state: FullThrustGamePosition | undefined,
    id: string,
    opts: { excludeId?: string } = {}
): string | null {
    const trimmed = id.trim();
    if (!trimmed || trimmed === opts.excludeId) return null;
    const hits = collectGameUids(state).get(trimmed);
    if (!hits?.length) return null;
    const where =
        hits.length === 1 ? hits[0] : `${hits[0]} (+${hits.length - 1} more)`;
    return `ID "${trimmed}" is already used by ${where}.`;
}

export function assertGameUidAvailable(
    state: FullThrustGamePosition | undefined,
    id: string,
    context: string,
    opts: { excludeId?: string } = {}
): void {
    const collision = gameUidCollision(state, id, opts);
    if (collision) {
        throw new Error(`${context}: ${collision}`);
    }
}
