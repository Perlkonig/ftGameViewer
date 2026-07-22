export const DEFAULT_MAP_WIDTH_MU = 72;
export const DEFAULT_MAP_HEIGHT_MU = 48;

export function mapPixelsFromMu(
    widthMu: number,
    heightMu: number,
    pixelsPerMU: number
): { mapWidthPx: number; mapHeightPx: number } {
    return {
        mapWidthPx: widthMu * pixelsPerMU,
        mapHeightPx: heightMu * pixelsPerMU,
    };
}

export function mapAspectRatio(mapWidthPx: number, mapHeightPx: number): number {
    if (mapWidthPx <= 0 || mapHeightPx <= 0) return 1;
    return mapWidthPx / mapHeightPx;
}

/** Convert screen (client) coordinates to SVG user units (map pixels). */
export function screenToSvgUser(
    svg: SVGSVGElement,
    clientX: number,
    clientY: number
): { x: number; y: number } {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
}

/** Snap viewport size to the board aspect ratio and fit within the map. */
export function fitViewportToMap(
    mapWidthPx: number,
    mapHeightPx: number,
    viewW: number,
    viewH: number
): { viewW: number; viewH: number } {
    if (mapWidthPx <= 0 || mapHeightPx <= 0) {
        return { viewW: Math.max(0, viewW), viewH: Math.max(0, viewH) };
    }
    const aspect = mapAspectRatio(mapWidthPx, mapHeightPx);
    let w = Math.max(viewW, 1);
    let h = w / aspect;
    const scale = Math.min(1, mapWidthPx / w, mapHeightPx / h);
    return { viewW: w * scale, viewH: h * scale };
}

/** Viewport size in map pixels matching the board aspect ratio. */
export function viewportPixelsForFocus(
    sizeMu: number,
    boardMinXPx: number,
    boardMinYPx: number,
    boardMaxXPx: number,
    boardMaxYPx: number,
    pixelsPerMU: number
): { viewW: number; viewH: number } {
    const boardWidthPx = boardMaxXPx - boardMinXPx;
    const boardHeightPx = boardMaxYPx - boardMinYPx;
    if (sizeMu <= 0 || boardWidthPx <= 0 || boardHeightPx <= 0) {
        return { viewW: boardWidthPx, viewH: boardHeightPx };
    }
    const sizePx = sizeMu * pixelsPerMU;
    const aspect = mapAspectRatio(boardWidthPx, boardHeightPx);
    let viewW: number;
    let viewH: number;
    if (aspect >= 1) {
        viewH = sizePx;
        viewW = viewH * aspect;
    } else {
        viewW = sizePx;
        viewH = viewW / aspect;
    }
    return fitViewportToMap(boardWidthPx, boardHeightPx, viewW, viewH);
}

/** Viewport covering bounds while preserving the board aspect ratio. */
export function viewportPixelsForBounds(
    minXPx: number,
    minYPx: number,
    maxXPx: number,
    maxYPx: number,
    padPx: number,
    boardMinXPx: number,
    boardMinYPx: number,
    boardMaxXPx: number,
    boardMaxYPx: number
): { viewW: number; viewH: number; originX: number; originY: number } {
    const boardWidthPx = boardMaxXPx - boardMinXPx;
    const boardHeightPx = boardMaxYPx - boardMinYPx;
    const cx = (minXPx + maxXPx) / 2;
    const cy = (minYPx + maxYPx) / 2;
    let viewW = Math.max(maxXPx - minXPx + padPx * 2, 1);
    let viewH = Math.max(maxYPx - minYPx + padPx * 2, 1);
    const aspect = mapAspectRatio(boardWidthPx, boardHeightPx);
    if (viewW / viewH > aspect) {
        viewH = viewW / aspect;
    } else {
        viewW = viewH * aspect;
    }
    const fitted = fitViewportToMap(boardWidthPx, boardHeightPx, viewW, viewH);
    return {
        viewW: fitted.viewW,
        viewH: fitted.viewH,
        originX: clampViewportOrigin(cx, fitted.viewW, boardMaxXPx, boardMinXPx),
        originY: clampViewportOrigin(cy, fitted.viewH, boardMaxYPx, boardMinYPx),
    };
}

/** Clamp a viewport origin so the focus point stays as centered as possible. */
export function clampViewportOrigin(
    focusPx: number,
    viewSize: number,
    maxPx: number,
    minPx = 0
): number {
    const span = maxPx - minPx;
    if (viewSize >= span) return minPx;
    const ideal = focusPx - viewSize / 2;
    return Math.max(minPx, Math.min(ideal, maxPx - viewSize));
}
