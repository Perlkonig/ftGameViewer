/** Map movement preview lines (phase 1–4 orders + drift). */

import { derived } from "svelte/store";
import { currentState, type IDerivedState } from "@/stores/derivedState";
import { showTrajectories, PIXELS_PER_MU } from "@/stores/writeMapView";
import {
    previewPathForShip,
    previewDriftPathForShip,
    pendingMoveForShip,
} from "@/lib/game/movementResolve";
import type { ShipGameState } from "@/lib/game/shipSystems";

export interface TrajectoryLine {
    key: string;
    points: string;
    endX: number;
    endY: number;
    stroke: string;
    strokeOpacity: number;
    strokeDasharray: string;
}

function hasShipPosition(
    o: NonNullable<IDerivedState["state"]>["objects"][number]
): o is ShipGameState & { position: { x: number; y: number } } {
    return (
        o.objType === "ship" &&
        o.position != null &&
        typeof o.position === "object" &&
        "x" in o.position &&
        "y" in o.position
    );
}

export function buildTrajectoryLines(
    cs: IDerivedState,
    visible: boolean,
    pixelsPerMU = PIXELS_PER_MU
): TrajectoryLine[] {
    if (!visible || !cs.state?.objects) return [];

    const phase = cs.meta?.phase ?? 99;

    return cs.state.objects.filter(hasShipPosition).flatMap((ship) => {
        const path =
            phase < 5
                ? previewPathForShip(ship, cs.pendingMoves)
                : previewDriftPathForShip(ship);
        if (path.length < 2) return [];

        const start = path[0];
        const end = path[path.length - 1];
        if (Math.hypot(end.x - start.x, end.y - start.y) < 0.001) return [];

        const hasOrder =
            phase < 5 && !!pendingMoveForShip(cs.pendingMoves, ship.id);

        return [
            {
                key: ship.id,
                points: path
                    .map((p) => `${p.x * pixelsPerMU},${p.y * pixelsPerMU}`)
                    .join(" "),
                endX: end.x * pixelsPerMU,
                endY: end.y * pixelsPerMU,
                stroke: phase < 5 ? (hasOrder ? "#6eb5ff" : "#88c999") : "#88c999",
                strokeOpacity: phase < 5 ? (hasOrder ? 0.9 : 0.55) : 0.55,
                strokeDasharray: phase < 5 ? (hasOrder ? "8 6" : "4 8") : "4 8",
            },
        ];
    });
}

export const trajectoryLines = derived(
    [currentState, showTrajectories],
    ([$cs, $show]) => buildTrajectoryLines($cs, $show)
);

export function defaultShowTrajectoriesForPhase(phase: number | undefined): boolean {
    const p = phase ?? 99;
    return p >= 1 && p <= 4;
}
