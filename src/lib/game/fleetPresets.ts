import type { FullThrustShip } from "ftlibship";

export interface FleetFaction {
    name: string;
    ships: FullThrustShip[];
}

const FLEETS_URL = "/presets/fleets.json";

export function fleetShipLabel(ship: FullThrustShip): string {
    const name = typeof ship.name === "string" && ship.name.trim() ? ship.name.trim() : "Unnamed";
    const cls = typeof ship.class === "string" && ship.class.trim() ? ship.class.trim() : undefined;
    const mass = typeof ship.mass === "number" ? ship.mass : undefined;
    const bits = [name];
    if (cls) bits.push(cls);
    if (mass !== undefined) bits.push(`mass ${mass}`);
    return bits.join(" · ");
}

export async function loadFleetPresets(): Promise<FleetFaction[]> {
    try {
        const res = await fetch(FLEETS_URL);
        if (!res.ok) return [];
        const raw = (await res.json()) as unknown;
        if (!Array.isArray(raw)) return [];
        const factions: FleetFaction[] = [];
        for (const entry of raw) {
            if (!entry || typeof entry !== "object") continue;
            const name = (entry as { name?: unknown }).name;
            const ships = (entry as { ships?: unknown }).ships;
            if (typeof name !== "string" || !Array.isArray(ships)) continue;
            factions.push({
                name,
                ships: ships.filter(
                    (s): s is FullThrustShip => s !== null && typeof s === "object"
                ),
            });
        }
        return factions.sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
        );
    } catch {
        return [];
    }
}

/** Update the design `name` field inside ship JSON text. */
export function renameShipJson(shipJSON: string, newName: string): string {
    const trimmed = newName.trim();
    if (!trimmed) throw new Error("Name cannot be empty");
    const obj = JSON.parse(shipJSON) as FullThrustShip;
    obj.name = trimmed;
    return JSON.stringify(obj, null, 2);
}
