/** Phase 11→12 hull-destruction cleanup (simultaneous fire — removal deferred to phase transition). */

import type { FullThrustGameCommand } from "@/schemas/commands";
import type { FullThrustGamePosition } from "@/schemas/position";
import { pushShipDestroyedCommands } from "./resolveCombat";
import { shipsForPhase11HullDestruction } from "./thresholds";

/** Commands to remove hull-depleted ships before advancing to phase 12. */
export function buildPhase11HullDestructionCommands(
    position: FullThrustGamePosition
): FullThrustGameCommand[] {
    const cmds: FullThrustGameCommand[] = [];
    for (const shipId of shipsForPhase11HullDestruction(position)) {
        pushShipDestroyedCommands(cmds, shipId);
    }
    if (cmds.length > 0) {
        cmds.push({
            name: "resolvePhase11HullDestruction",
            count: cmds.filter((c) => c.name === "objDestroy").length,
        } as FullThrustGameCommand);
    }
    return cmds;
}
