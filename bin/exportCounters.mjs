import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const countersPath = path.join(__dirname, "../src/stores/counters.json");
const counters = JSON.parse(fs.readFileSync(countersPath, "utf8"));

const maxBase = Math.max(...counters.map(x => x.base));
const maxVar = Math.max(...counters.map(x => x.variant));
const baseLen = maxBase.toString().length;
const varLen = maxVar.toString().length;
const lpad = (s, l, c) => {
    let newstr = s;
    while (newstr.length < l) {
        newstr = c + newstr;
    }
    return newstr;
};

for (const c of counters) {
    let svg = c.svg;
    svg = svg.replace("<symbol ", "<svg ");
    svg = svg.replace("</symbol>", "</svg>");
    svg = svg.replace(`<svg `, `<?xml version="1.0" standalone="no"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg version="1.1" xmlns="http://www.w3.org/2000/svg" `);
    fs.writeFileSync(`dist/counters/ship-${lpad(c.base.toString(), baseLen, "0")}-${lpad(c.variant.toString(), varLen, "0")}.svg`, svg);
}
