/** Auto-adjust boarders when boarding torpedoes hit. */

import type { FullThrustGameCommand } from "@/schemas/commands";
import type { FullThrustGamePosition } from "@/schemas/position";
import { decodeFireDeclarationNotes } from "./resolveCombat";

function shipOwner(position: FullThrustGamePosition, shipId: string): string | undefined {
    const obj = position.objects?.find((o) => o.id === shipId && o.objType === "ship");
    return obj && "owner" in obj && typeof obj.owner === "string" ? obj.owner : undefined;
}

/**
 * Companion commands after boarding torpedo hit during phases 10–11.
 * Transporter delivery is handled separately via declareTransporterDelivery.
 */
export function boardingDeliveryCommands(
    declaration: FullThrustGameCommand,
    position: FullThrustGamePosition,
    hits: number
): FullThrustGameCommand[] {
    if (hits <= 0) return [];
    const c = declaration as { ship?: string; target?: string; weapon?: string; notes?: string };
    const targetId = c.target;
    const firerId = c.ship;
    if (!targetId || !firerId) return [];

    const meta = decodeFireDeclarationNotes(c.notes);
    if (meta.profile !== "boardingTorpedo") return [];

    const attackerOwner = shipOwner(position, firerId);
    if (!attackerOwner) return [];

    return [
        {
            name: "adjustBoarders",
            ship: targetId,
            owner: attackerOwner,
            marines: 2,
            fromShip: firerId,
        } as FullThrustGameCommand,
        {
            name: "_custom",
            msg: `Boarding torpedo placed 2 marines aboard ${targetId}.`,
        } as FullThrustGameCommand,
    ];
}
