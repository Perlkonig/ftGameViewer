import type { FullThrustGameObjects, Position } from "@/schemas/position";
import { beacon } from "@/stores/writeBeacon";
import { clickMode } from "@/stores/writeClickMode";
import { annotations } from "@/stores/writeAnnotations";
import { focusMapOnPoint } from "@/stores/writeMapView";
import { selectObject } from "@/stores/writeSelectedObject";
import { objectRefKey } from "./objectRef";

export const DEFAULT_MAP_FOCUS_SIZE_MU = 24;
export const FIGHTER_MAP_FOCUS_SIZE_MU = 48;

type MapFocusObjType = "ship" | "fighters" | "ordnance";

/** Clear map overlays and interaction mode left by Act command forms. */
export function clearActMapInteraction(): void {
    clickMode.set(undefined);
    annotations.set([]);
    beacon.set(undefined);
}

function objectPosition(obj: FullThrustGameObjects): Position | undefined {
    const pos = obj.position;
    if (pos == null || typeof pos !== "object" || !("x" in pos)) return undefined;
    const x = pos.x;
    const y = pos.y;
    if (typeof x !== "number" || typeof y !== "number") return undefined;
    return { x, y };
}

function defaultFocusSizeMu(objType: MapFocusObjType): number {
    return objType === "fighters" ? FIGHTER_MAP_FOCUS_SIZE_MU : DEFAULT_MAP_FOCUS_SIZE_MU;
}

/** Pan/zoom the map to a game object and select it (Explore list behaviour). */
export function focusMapOnGameObject(
    obj: FullThrustGameObjects | undefined,
    options: { sizeMu?: number; select?: boolean } = {}
): boolean {
    if (!obj) return false;
    const pos = objectPosition(obj);
    if (!pos) return false;
    const sizeMu =
        options.sizeMu ??
        (obj.objType === "ship" || obj.objType === "fighters" || obj.objType === "ordnance"
            ? defaultFocusSizeMu(obj.objType)
            : DEFAULT_MAP_FOCUS_SIZE_MU);
    if (
        options.select !== false &&
        (obj.objType === "ship" || obj.objType === "fighters" || obj.objType === "ordnance")
    ) {
        selectObject(objectRefKey({ objType: obj.objType, objId: obj.id }));
    }
    focusMapOnPoint(pos.x, pos.y, sizeMu);
    return true;
}

/** Focus the map when an Act form object dropdown changes. */
export function focusMapOnObjectId(
    objId: string,
    objects: FullThrustGameObjects[] | undefined,
    options: { sizeMu?: number; select?: boolean; objType?: MapFocusObjType } = {}
): boolean {
    if (!objId || !objects?.length) return false;
    const obj = objects.find((o) => {
        if (o.id !== objId) return false;
        if (options.objType) return o.objType === options.objType;
        return o.objType === "ship" || o.objType === "fighters" || o.objType === "ordnance";
    });
    if (!obj) return false;
    const sizeMu = options.sizeMu ?? defaultFocusSizeMu(obj.objType as MapFocusObjType);
    return focusMapOnGameObject(obj, { ...options, sizeMu });
}

/** Focus the map when an Act form ship dropdown changes. */
export function focusMapOnShipId(
    shipId: string,
    objects: FullThrustGameObjects[] | undefined,
    options?: { sizeMu?: number; select?: boolean }
): boolean {
    return focusMapOnObjectId(shipId, objects, { ...options, objType: "ship" });
}

/** Focus the map when an Act form fighter group dropdown changes. */
export function focusMapOnFightersId(
    fighterId: string,
    objects: FullThrustGameObjects[] | undefined,
    options?: { sizeMu?: number; select?: boolean }
): boolean {
    return focusMapOnObjectId(fighterId, objects, { ...options, objType: "fighters" });
}

/** Focus the map when an Act form ordnance dropdown changes. */
export function focusMapOnOrdnanceId(
    ordnanceId: string,
    objects: FullThrustGameObjects[] | undefined,
    options?: { sizeMu?: number; select?: boolean }
): boolean {
    return focusMapOnObjectId(ordnanceId, objects, { ...options, objType: "ordnance" });
}
