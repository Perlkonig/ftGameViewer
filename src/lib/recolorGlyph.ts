/** Recolor ftLibShip map glyph SVG for player ownership. */

export function recolorGlyphSvg(
    svg: string,
    fillColour: string,
    strokeColour = "#000000"
): string {
    return svg
        .replaceAll("#030303", fillColour)
        .replaceAll('fill="white"', `fill="${fillColour}"`)
        .replaceAll("fill='white'", `fill='${fillColour}'`)
        .replaceAll("fill:#ffffff", `fill:${fillColour}`)
        .replaceAll("fill:#FFFFFF", `fill:${fillColour}`)
        .replaceAll('stroke="#000000"', `stroke="${strokeColour}"`)
        .replaceAll('stroke="#000"', `stroke="${strokeColour}"`)
        .replaceAll('stroke="black"', `stroke="${strokeColour}"`)
        .replaceAll("stroke='black'", `stroke='${strokeColour}'`);
}

export function ownerColour(
    players: { id: string; colour?: string }[] | undefined,
    ownerId: string | undefined,
    fallback = "#ffffff"
): string {
    if (!ownerId) return fallback;
    return players?.find((p) => p.id === ownerId)?.colour ?? fallback;
}
