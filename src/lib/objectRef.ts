import type { FullThrustGamePosition } from "@/schemas/position";

const OBJECT_PREFIXES = ["ship", "fighters", "gunboats", "ordnance"] as const;
export type ObjectPrefix = (typeof OBJECT_PREFIXES)[number];

export interface ObjectRef {
    objType: ObjectPrefix;
    objId: string;
}

/** Parse `ship_id`, `fighters_id`, or `ordnance_id` (id may contain underscores). */
export function parseObjectRef(ref: string): ObjectRef | undefined {
    for (const prefix of OBJECT_PREFIXES) {
        const head = `${prefix}_`;
        if (ref.startsWith(head)) {
            return { objType: prefix, objId: ref.slice(head.length) };
        }
    }
    return undefined;
}

export function objectRefKey(ref: ObjectRef): string {
    return `${ref.objType}_${ref.objId}`;
}

/** Resolve a bare object id or prefixed ref against the current object list. */
export function resolveObjectRef(
    ref: string,
    objects: FullThrustGamePosition["objects"]
): ObjectRef | undefined {
    const parsed = parseObjectRef(ref);
    if (parsed) return parsed;
    if (!objects) return undefined;
    const found = objects.find((o) => o.id === ref);
    if (
        found &&
        (found.objType === "ship" ||
            found.objType === "fighters" ||
            found.objType === "gunboats" ||
            found.objType === "ordnance")
    ) {
        return { objType: found.objType, objId: found.id };
    }
    return undefined;
}

/** Walk from a clicked DOM node to a map object ref. */
function parentElementChain(node: Element): Element | null {
    if (node.parentElement) return node.parentElement;
    const parent = node.parentNode;
    return parent instanceof Element ? parent : null;
}

export function resolveClickedElement(
    el: Element | undefined,
    objects: FullThrustGamePosition["objects"]
): ObjectRef | undefined {
    let node: Element | null | undefined = el;
    while (node) {
        const id = node.id;
        if (id) {
            const resolved = resolveObjectRef(id, objects);
            if (resolved) return resolved;
        }
        node = parentElementChain(node);
    }
    return undefined;
}

function resolveEventPath(
    e: Pick<MouseEvent, "target" | "composedPath">,
    objects: FullThrustGamePosition["objects"]
): ObjectRef | undefined {
    const path =
        typeof e.composedPath === "function"
            ? e.composedPath()
            : [e.target];
    for (const node of path) {
        if (!(node instanceof Element)) continue;
        const resolved = resolveObjectRef(node.id, objects);
        if (resolved) return resolved;
    }
    return undefined;
}

/** Resolve a map object from a click event (preferred over :hover). */
export function resolveClickEvent(
    e: Pick<MouseEvent, "target" | "composedPath">,
    objects: FullThrustGamePosition["objects"]
): ObjectRef | undefined {
    return resolveEventPath(e, objects);
}

/** Resolve the map object under the cursor (same path walk as click). */
export function resolveHoverEvent(
    e: Pick<MouseEvent, "target" | "composedPath">,
    objects: FullThrustGamePosition["objects"]
): ObjectRef | undefined {
    return resolveEventPath(e, objects);
}
