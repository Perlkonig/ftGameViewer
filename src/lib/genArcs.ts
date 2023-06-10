export type Facing = 1|2|3|4|5|6|7|8|9|10|11|12;
export type Arc = "F"|"FS"|"AS"|"A"|"AP"|"FP";

// delta of arc relative to 12 = 0 degrees, increasing clockwise
const leftDeltas = new Map<Arc,number>([
    ["F",-30],
    ["FS",30],
    ["AS",90],
    ["A",150],
    ["AP",-150],
    ["FP",-90],
]);
let rightDeltas = new Map<Arc,number>();
for (const [k,v] of leftDeltas.entries()) {
    rightDeltas.set(k, v + 60);
}

export const lefts = new Map<Arc, number>([
    ["F", 240],
    ["FS", 300],
    ["AS", 0],
    ["A", 60],
    ["AP", 120],
    ["FP", 180]
]);
export const rights = new Map<Arc, number>([
    ["F", 300],
    ["FS", 0],
    ["AS", 60],
    ["A", 120],
    ["AP", 180],
    ["FP", 240]
]);

// // Convert facing to "proper" plane where 0 is direct starboard and increases counterclockwise
// const facing2deg = (f: Facing): number => {
//     return (360 - (f * 30) + 90) % 360;
// }

// Convert facing to SVG plane where 0 is direct starboard and increases clockwise
const facing2deg = (f: Facing): number => {
    return ((f * 30) - 90) % 360;
}

const nextArc = (start: Arc): Arc => {
    switch (start) {
        case "F":
            return "FS";
        case "FS":
            return "AS";
        case "AS":
            return "A";
        case "A":
            return "AP";
        case "AP":
            return "FP";
        case "FP":
            return "F";
    }
}

const addArcs = (start: Arc, dist: number): Arc => {
    let next = start;
    while (dist > 0) {
        next = nextArc(next);
        dist--;
    }
    return next;
}

const genArcs = (orientation: "alpha"|"beta"|undefined, facing: Facing, leftArc: Arc, numArcs: number): [number,number] => {
    const rightArc = addArcs(leftArc, numArcs - 1);
    let deg = facing2deg(facing as Facing);
    let left = deg + leftDeltas.get(leftArc)!;
    let right = deg + rightDeltas.get(rightArc)!;
    if ( (orientation !== undefined) && (orientation === "beta") ) {
        left += 30;
        right += 30;
    }
    return [left, right];
    // console.log(`Facing: ${facing}, leftArc: ${leftArc}, rightArc: ${rightArc}, Degrees: ${left},${right}`);
}

export default genArcs;
