import type { IAnnotation, IPoint, IArc, ICircle, ILine } from "@/stores/writeAnnotations";

const generateSVG = (a: IAnnotation, defaultColour: string, ppmu: number): string => {
    if (a.type === "CIRCLE") {
        return genCircle(a, defaultColour, ppmu);
    } else if (a.type === "ARC") {
        return genArc(a, defaultColour, ppmu);
    } else if (a.type === "LINE") {
        return genLine(a, defaultColour, ppmu);
    }
    return "";
}

const genCircle = (a: IAnnotation, defaultColour: string, ppmu: number): string => {
    const note = a.note as ICircle;
    let {x: cx, y: cy} = note.c;
    cx *= ppmu;
    cy *= ppmu
    const r = note.r * ppmu;
    let startR: number|undefined;
    if (note.startR !== undefined) {
        startR = note.startR * ppmu;
    }
    let colour = defaultColour;
    if (a.color !== undefined) {
        colour = a.color;
    }
    let opacity = 0.25;
    if (a.opacity !== undefined) {
        opacity = a.opacity;
    }
    let width = 5;
    if (a.strokeWidth !== undefined) {
        width = a.strokeWidth;
    }

    if (startR === undefined) {
        return `<circle id="_annotation_${a.id}" cx="${cx}" cy="${cy}" r="${r}" fill="${colour}" fill-opacity="${opacity}" stroke="${colour}" stroke-width="${width}" />`
    } else {
        return `<path d="M ${cx},${cy} m 0,-${r} a ${r},${r},0,1,0,1,0 Z m 0,${r - startR} a ${startR},${startR},0,1,1,-1,0 Z" fill="${colour}" fill-opacity="${opacity}" stroke="${colour}" stroke-width="${width}" />`;
    }
}

const deg2rad = (deg: number) => { return deg * Math.PI / 180; }

const arcpt = (cx: number, cy: number, r: number, angle: number): IPoint => {
    const x = cx + (r * Math.cos(angle));
    const y = cy + (r * Math.sin(angle));
    return {x, y};
}

const genArc = (a: IAnnotation, defaultColour: string, ppmu: number): string => {
    const note = a.note as IArc;
    let {x: cx, y: cy} = note.c;
    cx *= ppmu;
    cy *= ppmu
    const r = note.r * ppmu;
    let startR = 0;
    if (note.startR !== undefined) {
        startR = note.startR * ppmu;
    }
    let leftDeg = note.left;
    let rightDeg = note.right;
    if (leftDeg > rightDeg) {
        rightDeg += 360;
    }
    let large = 0;
    if (Math.abs(leftDeg - rightDeg) > 180) {
        large = 1;
    }
    const leftRad = deg2rad(leftDeg);
    const rightRad = deg2rad(rightDeg);
    const leftOuter = arcpt(cx, cy, r, leftRad);
    const rightOuter = arcpt(cx, cy, r, rightRad);
    const leftInner = arcpt(cx, cy, startR, leftRad);
    const rightInner = arcpt(cx, cy, startR, rightRad);
    let colour = defaultColour;
    if (a.color !== undefined) {
        colour = a.color;
    }
    let opacity = 0.25;
    if (a.opacity !== undefined) {
        opacity = a.opacity;
    }
    let width = 5;
    if (a.strokeWidth !== undefined) {
        width = a.strokeWidth;
    }
    let path: string;
    if (startR > 0) {
        path = `<path d="M ${leftOuter.x} ${leftOuter.y} A ${r} ${r} 0 ${large} 1 ${rightOuter.x} ${rightOuter.y} L ${rightInner.x} ${rightInner.y} A ${startR} ${startR} 0 ${large} 0 ${leftInner.x} ${leftInner.y} Z" fill="${colour}" fill-opacity="${opacity}" stroke="${colour}" stroke-width="${width}" />`;
    } else {
        path = `<path d="M ${cx} ${cy} L ${leftOuter.x} ${leftOuter.y} A ${r} ${r} 0 ${large} 1 ${rightOuter.x} ${rightOuter.y} Z" fill="${colour}" fill-opacity="${opacity}" stroke="${colour}" stroke-width="${width}" />`;
    }
    return path;
}

export default generateSVG;

/*
M cx, cy // Move to center of ring
m 0, -outerRadius // Move to top of ring
a outerRadius, outerRadius, 0, 1, 0, 1, 0 // Draw outer arc, but don't close it
Z // default fill-rule:even-odd will help create the empty innards
m 0 outerRadius-innerRadius // Move to top point of inner radius
a innerRadius, innerRadius, 0, 1, 1, -1, 0 // Draw inner arc, but don't close it
Z // Close the inner ring. Actually will still work without, but inner ring will have one unit missing in stroke
*/

const genLine = (a: IAnnotation, defaultColour: string, ppmu: number): string => {
    const note = a.note as ILine;
    const {x: x1, y: y1} = note.p1;
    const {x: x2, y: y2} = note.p2;
    let colour = defaultColour;
    if (a.color !== undefined) {
        colour = a.color;
    }
    let opacity = 1;
    if (a.opacity !== undefined) {
        opacity = a.opacity;
    }
    let width = 5;
    if (a.strokeWidth !== undefined) {
        width = a.strokeWidth;
    }

    return `<line id="_annotation_${a.id}" x1="${x1*ppmu}" y1="${y1*ppmu}" x2="${x2*ppmu}" y2="${y2*ppmu}" fill="${colour}" fill-opacity="${opacity}" stroke="${colour}" stroke-width="${width}" stroke-opacity="${opacity}" />`;
}
