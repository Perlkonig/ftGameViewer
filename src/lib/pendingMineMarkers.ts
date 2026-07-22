/** Map / Explore markers for layMine commands queued before phase 5 resolve. */

import type { FullThrustGameCommand } from "@/schemas/commands";
import type { FullThrustGamePosition } from "@/schemas/position";
import type { ExploreListEntry } from "@/lib/exploreObjects";
import { formatCoordinatePair } from "@/lib/exploreObjects";
import { objectRefKey } from "@/lib/objectRef";

export interface PendingMineMarker {
    key: string;
    shipId: string;
    systemId: string;
    owner?: string;
    position: { x: number; y: number };
}

function layMineCmd(
    cmd: FullThrustGameCommand
): cmd is FullThrustGameCommand & {
    ship: string;
    systemId: string;
    position: { x: number; y: number };
} {
    return (
        cmd.name === "layMine" &&
        typeof (cmd as { ship?: string }).ship === "string" &&
        typeof (cmd as { systemId?: string }).systemId === "string" &&
        !!(cmd as { position?: { x: number; y: number } }).position &&
        typeof (cmd as { position: { x: number } }).position.x === "number" &&
        typeof (cmd as { position: { y: number } }).position.y === "number"
    );
}

function shipOwner(
    position: FullThrustGamePosition | undefined,
    shipId: string
): string | undefined {
    return position?.objects?.find((o) => o.objType === "ship" && o.id === shipId)?.owner;
}

export function buildPendingMineMarkers(
    pendingLayMines: FullThrustGameCommand[] | undefined,
    position: FullThrustGamePosition | undefined
): PendingMineMarker[] {
    const markers: PendingMineMarker[] = [];
    let index = 0;
    for (const cmd of pendingLayMines ?? []) {
        if (!layMineCmd(cmd)) continue;
        markers.push({
            key: `pending_mine_${cmd.ship}_${cmd.systemId}_${index}`,
            shipId: cmd.ship,
            systemId: cmd.systemId,
            owner: shipOwner(position, cmd.ship),
            position: { x: cmd.position.x, y: cmd.position.y },
        });
        index += 1;
    }
    return markers;
}

export function listPendingLayMineExploreEntries(
    pendingLayMines: FullThrustGameCommand[] | undefined,
    position: FullThrustGamePosition | undefined
): ExploreListEntry[] {
    return buildPendingMineMarkers(pendingLayMines, position).map((m) => {
        const ref = { objType: "ordnance" as const, objId: m.key };
        return {
            ref,
            key: objectRefKey(ref),
            id: m.key,
            objType: "ordnance" as const,
            owner: m.owner,
            mass: 0,
            position: m.position,
            label: `${m.shipId} mine`,
            detail: `Pending · layer ${m.systemId}`,
            motionLine: formatCoordinatePair(m.position.x, m.position.y),
        };
    });
}
