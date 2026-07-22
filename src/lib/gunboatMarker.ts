/** Map / SSD symbols for gunboat squadrons. */

import { gunboatType2Abbrev, type GunboatType } from "ftlibship";

export const GUNBOAT_MAP_TOKEN_W_MU = 0.3;
export const GUNBOAT_MAP_TOKEN_H_MU = 0.25;

/** Rack / symbol insert labels (matches ftlibship type2initial). */
const GUNBOAT_TYPE_INITIAL = new Map<string, string>([
    ["beam", "B"],
    ["plasma", "Pl"],
    ["graser", "Gr"],
    ["needle", "N"],
    ["pointDefense", "PDS"],
    ["pulseTorpedo", "PT"],
    ["submunition", "Sub"],
    ["kGun", "K"],
    ["missile", "Ms"],
    ["rocket", "Rk"],
    ["ads", "ADS"],
    ["gatling", "Gt"],
    ["mkp", "MKP"],
    ["scatterpack", "Sp"],
    ["plasmaBomber", "PB"],
]);

function gunboatSquadronInsertSvg(types: string[]): string {
    const cols = 2;
    const rows = 3;
    const cellW = 128;
    const cellH = 88;
    const rectLeft = 329.4;
    const rectWidth = 301.2;
    const rectTop = 21;
    const rectHeight = 518.1;
    const centerX = rectLeft + rectWidth / 2;
    const gridW = cols * cellW;
    const gridH = rows * cellH;
    const gridLeft = centerX - gridW / 2;
    const gridAreaTop = 168;
    const gridAreaBottom = rectTop + rectHeight - 24;
    const gridTop = gridAreaTop + (gridAreaBottom - gridAreaTop - gridH) / 2;
    const defaultFontSize = 40;
    let out = "";
    for (let i = 0; i < Math.min(6, types.length); i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = gridLeft + col * cellW + cellW / 2;
        const y = gridTop + row * cellH + cellH / 2;
        const t = types[i];
        const label =
            GUNBOAT_TYPE_INITIAL.get(t) ??
            gunboatType2Abbrev.get(t as GunboatType) ??
            t.slice(0, 1);
        const fontSize =
            label.length <= 2 ? defaultFontSize : label.length === 3 ? 32 : 26;
        out += `<text x="${x}" y="${y}" dominant-baseline="middle" text-anchor="middle" font-size="${fontSize}" font-family="Roboto" font-weight="bold">${label}</text>`;
    }
    return out;
}

export function buildGunboatMapSymbol(
    tokenId: string,
    boatTypes: GunboatType[]
): { id: string; svg: string } {
    const inner = gunboatSquadronInsertSvg(boatTypes.slice(0, 6));
    const svg = `<symbol id="${tokenId}" viewBox="320 35.75 319 478.5"><rect x="329.4" y="21" width="301.2" height="518.1" fill="white" stroke="#000" stroke-width="8"/>${inner}</symbol>`;
    return { id: tokenId, svg };
}
