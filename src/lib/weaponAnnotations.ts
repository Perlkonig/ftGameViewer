import type { FullThrustShip } from "ftlibship";
import type { Position } from "@/schemas/position";
import type { IAnnotation, IArc, ICircle } from "@/stores/writeAnnotations";
import genArcs, { type Arc, type Facing } from "@/lib/genArcs";
import type { ShipSystemEntry } from "@/lib/game/shipSystems";
import {
    defaultBeamClassForWeapon,
    inferShipFireProfile,
    type ShipFireProfileKey,
} from "@/lib/game/shipFireProfiles";
import { defaultPdsDiceForWeapon } from "@/lib/game/pointDefenseProfiles";

export type { ShipFireProfileKey };
export { inferShipFireProfile, defaultBeamClassForWeapon, defaultPdsDiceForWeapon };

export function weaponAnnotationsForSystem(
    shipSrc: FullThrustShip,
    shipPosition: Position,
    shipFacing: Facing,
    sys: ShipSystemEntry
): IAnnotation[] {
    const out: IAnnotation[] = [];
    const c = shipPosition;

    switch (sys.name) {
        case "mineSweeper":
            out.push({ type: "CIRCLE", id: sys.id, note: { c, r: 3 } });
            break;
        case "pds":
        case "adfc":
            out.push({ type: "CIRCLE", id: sys.id, note: { c, r: 6 } });
            break;
        case "ecm":
            if (sys.area) {
                out.push({ type: "CIRCLE", id: sys.id, note: { c, r: 6 } });
            }
            break;
        case "suicide":
            out.push({ type: "CIRCLE", id: sys.id, note: { c, r: 1 } });
            out.push({ type: "CIRCLE", id: sys.id, note: { c, r: 2, startR: 1 } });
            out.push({ type: "CIRCLE", id: sys.id, note: { c, r: 3, startR: 2 } });
            break;
        case "beam":
        case "emp":
        case "plasmaCannon":
        case "phaser":
        case "graser":
        case "transporter":
        case "needle":
        case "gravitic": {
            let str = 12;
            if (sys.name === "graser" && sys.heavy) {
                str = 18;
            }
            const cls = defaultBeamClassForWeapon(sys);
            for (let i = 0; i < cls; i++) {
                const numArcs = Number(sys.numArcs ?? 6);
                if (numArcs < 6) {
                    const [left, right] = genArcs(
                        shipSrc.orientation,
                        shipFacing,
                        sys.leftArc as Arc,
                        numArcs
                    );
                    out.push({
                        type: "ARC",
                        id: sys.id,
                        note: {
                            left,
                            right,
                            c,
                            r: str * (i + 1),
                            startR: str * i,
                        },
                    });
                } else {
                    out.push({
                        type: "CIRCLE",
                        id: sys.id,
                        note: { c, r: str * (i + 1), startR: str * i },
                    });
                }
            }
            break;
        }
        default:
            break;
    }
    return out;
}

export function boundsFromAnnotations(
    annotations: IAnnotation[]
): { minX: number; minY: number; maxX: number; maxY: number } | undefined {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const a of annotations) {
        const note = a.note as ICircle | IArc;
        if (!note?.c) continue;
        const r = note.r ?? 0;
        minX = Math.min(minX, note.c.x - r);
        minY = Math.min(minY, note.c.y - r);
        maxX = Math.max(maxX, note.c.x + r);
        maxY = Math.max(maxY, note.c.y + r);
    }

    if (!Number.isFinite(minX)) return undefined;
    return { minX, minY, maxX, maxY };
}
