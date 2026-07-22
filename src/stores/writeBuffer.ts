import { writable } from "svelte/store";
import { FLUID_DEFAULT_BUFFER } from "@/lib/game/fluidMapBounds";
import type { GameMap } from "@/lib/game/package";

/** Live cosmetic buffer for fluid maps (MU). Not logged to commands. */
export const fluidMapBuffer = writable(FLUID_DEFAULT_BUFFER);

export function initFluidMapBuffer(map: GameMap | undefined): void {
    if (map?.mode === "fluid" && typeof map.buffer === "number") {
        fluidMapBuffer.set(map.buffer);
        return;
    }
    fluidMapBuffer.set(FLUID_DEFAULT_BUFFER);
}
