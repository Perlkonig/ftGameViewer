<script lang="ts">
    import { onMount } from 'svelte';
    // import { nanoid } from "nanoid";
    import { tweened } from "svelte/motion";
    import { sineOut } from 'svelte/easing';
    import { mousePos } from "@/stores/writeMousePos";
    import { beacon } from '@/stores/writeBeacon';
    import { get } from "svelte/store";
    import { currentState, type IDerivedState } from '@/stores/derivedState';
    import { commands } from '@/stores/writeCommands';
    import { headOffset } from '@/stores/writeHeadOffset';
    import { clickMode } from '@/stores/writeClickMode';
    import { selectObject, selectedObject } from "@/stores/writeSelectedObject";
    import { resolveClickEvent, resolveClickedElement, resolveHoverEvent, objectRefKey } from "@/lib/objectRef";
    import { initialState } from '@/stores/writeInitialState';
    import RenderCounter from './RenderCounter.svelte';
    import type { FullThrustShip } from 'ftlibship';
    import { userSettings } from '@/stores/writeUserSettings';
    import { annotations } from '@/stores/writeAnnotations';
    import genAnnotation from '@/lib/genAnnotation';
    import { ownerColour, recolorGlyphSvg } from '@/lib/recolorGlyph';
    import { gunboatGroupLabel } from "@/lib/game/gunboatLabel";
    import { fighterGroupLabel } from "@/lib/game/fighterLabel";
    import {
        GUNBOAT_MAP_TOKEN_H_MU,
        GUNBOAT_MAP_TOKEN_W_MU,
    } from "@/lib/gunboatMarker";
    import {
        FIGHTER_MAP_TOKEN_H_MU,
        FIGHTER_MAP_TOKEN_RADIUS_MU,
        FIGHTER_MAP_TOKEN_W_MU,
    } from "@/lib/fighterMarker";
    import { isSalvoOrdnanceType, salvoMissileCount } from "@/lib/game/salvoOrdnance";
    import { mapViewport, mapFocusRequest, showTrajectories, PIXELS_PER_MU } from '@/stores/writeMapView';
    import type { MapFocusRequest } from '@/stores/writeMapView';
    import {
        clampViewportOrigin,
        DEFAULT_MAP_HEIGHT_MU,
        DEFAULT_MAP_WIDTH_MU,
        fitViewportToMap,
        screenToSvgUser,
        viewportPixelsForBounds,
        viewportPixelsForFocus,
    } from '@/lib/mapScreenCoords';
    import {
        generateRulerTicks,
        rulerTickLength,
        rulerTickStroke,
    } from '@/lib/mapRulers';
    import {
        trajectoryLines,
        defaultShowTrajectoriesForPhase,
    } from '@/lib/mapTrajectories';
    import { buildPendingMineMarkers } from '@/lib/pendingMineMarkers';
    import { computeMapBounds } from '@/lib/game/fluidMapBounds';
    import { fluidMapBuffer } from '@/stores/writeBuffer';
    import type { GameMap } from '@/lib/game/package';

    const pixelsPerMU = PIXELS_PER_MU;
    const defaultMap: GameMap = { mode: "fixed", width: DEFAULT_MAP_WIDTH_MU, height: DEFAULT_MAP_HEIGHT_MU };
    let boardMinMu = 0;
    let boardMaxMu = DEFAULT_MAP_WIDTH_MU;
    let boardMinMuY = 0;
    let boardMaxMuY = DEFAULT_MAP_HEIGHT_MU;
    $: boardMinPx = boardMinMu * pixelsPerMU;
    $: boardMaxPx = boardMaxMu * pixelsPerMU;
    $: boardMinPy = boardMinMuY * pixelsPerMU;
    $: boardMaxPy = boardMaxMuY * pixelsPerMU;
    $: boardWidthPx = boardMaxPx - boardMinPx;
    $: boardHeightPx = boardMaxPy - boardMinPy;
    const currX = tweened(0, {
        duration: 1000,
        easing: sineOut
    });
    const currY = tweened(0, {
        duration: 1000,
        easing: sineOut
    });
    const currWidth = tweened(0, {
        duration: 1000,
        easing: sineOut
    });
    const currHeight = tweened(0, {
        duration: 1000,
        easing: sineOut
    });

    let innerSvg: SVGSVGElement;
    let outerSvg: SVGSVGElement;

    const applyMapFocus = (req: MapFocusRequest) => {
        if (req.bounds) {
            const pad = (req.bounds.paddingMu ?? 2) * pixelsPerMU;
            const bMinX = req.bounds.minX * pixelsPerMU;
            const bMinY = req.bounds.minY * pixelsPerMU;
            const bMaxX = req.bounds.maxX * pixelsPerMU;
            const bMaxY = req.bounds.maxY * pixelsPerMU;
            const { viewW, viewH, originX, originY } = viewportPixelsForBounds(
                bMinX,
                bMinY,
                bMaxX,
                bMaxY,
                pad,
                boardMinPx,
                boardMinPy,
                boardMaxPx,
                boardMaxPy
            );
            currWidth.set(viewW);
            currHeight.set(viewH);
            currX.set(originX);
            currY.set(originY);
            return;
        }

        const sizeMu = req.sizeMu ?? 24;
        const { viewW, viewH } = viewportPixelsForFocus(
            sizeMu,
            boardMinPx,
            boardMinPy,
            boardMaxPx,
            boardMaxPy,
            pixelsPerMU
        );
        const cx = req.x * pixelsPerMU;
        const cy = req.y * pixelsPerMU;
        currWidth.set(viewW);
        currHeight.set(viewH);
        currX.set(clampViewportOrigin(cx, viewW, boardMaxPx, boardMinPx));
        currY.set(clampViewportOrigin(cy, viewH, boardMaxPy, boardMinPy));
    };

    const applyBoardBounds = (bounds: {
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
    }) => {
        boardMinMu = bounds.minX;
        boardMinMuY = bounds.minY;
        boardMaxMu = bounds.maxX;
        boardMaxMuY = bounds.maxY;
        return {
            minPx: bounds.minX * pixelsPerMU,
            minPy: bounds.minY * pixelsPerMU,
            widthPx: (bounds.maxX - bounds.minX) * pixelsPerMU,
            heightPx: (bounds.maxY - bounds.minY) * pixelsPerMU,
        };
    };

    onMount(() => {
        resetMap(get(currentState), get(fluidMapBuffer));
        window.addEventListener("mouseup", endPan);
        let trajectoryPhaseBound: number | undefined;
        const unsubPhase = currentState.subscribe((cs) => {
            const phase = cs.meta?.phase;
            if (trajectoryPhaseBound !== phase) {
                trajectoryPhaseBound = phase;
                showTrajectories.set(defaultShowTrajectoriesForPhase(phase));
            }
        });
        const unsubBoard = currentState.subscribe((cs) =>
            resetMap(cs, get(fluidMapBuffer))
        );
        const unsubBuffer = fluidMapBuffer.subscribe((bufferMu) =>
            resetMap(get(currentState), bufferMu)
        );
        const unsubInitial = initialState.subscribe(() =>
            resetMap(get(currentState), get(fluidMapBuffer))
        );
        const unsubFocus = mapFocusRequest.subscribe((req) => {
            if (req) {
                applyMapFocus(req);
                mapFocusRequest.set(undefined);
            }
        });
        return () => {
            window.removeEventListener("mouseup", endPan);
            unsubPhase();
            unsubBoard();
            unsubBuffer();
            unsubInitial();
            unsubFocus();
        };
    });

    /** Stroke width in viewBox units so lines stay ~3–4px on screen at any zoom. */
    $: trajectoryStrokeWidth = Math.max(3, $currWidth / 200);
    $: pendingMineMarkers = buildPendingMineMarkers(
        $currentState.pendingLayMines,
        $currentState.state
    );
    /** Bumps when the folded board changes so object layers re-render reliably. */
    $: boardKey = `${$commands.length}-${$headOffset}`;

    $: mapViewport.set({
        minX: $currX / pixelsPerMU,
        minY: $currY / pixelsPerMU,
        maxX: ($currX + $currWidth) / pixelsPerMU,
        maxY: ($currY + $currHeight) / pixelsPerMU,
    });

    const instantTween = { duration: 0 };

    const resetMap = (cs: IDerivedState, bufferMu: number) => {
        const map = cs.state?.map ?? defaultMap;
        const meta = cs.meta ?? { turn: 1, phase: 1 };
        const bounds = computeMapBounds(map, cs.state, meta, bufferMu);
        const px = applyBoardBounds(bounds);
        $mousePos = { x: bounds.minX, y: bounds.minY };
        currX.set(px.minPx, instantTween);
        currY.set(px.minPy, instantTween);
        currWidth.set(px.widthPx, instantTween);
        currHeight.set(px.heightPx, instantTween);
    };

    const handleWheel = (e: WheelEvent) => {
        e.preventDefault();
        const speed = 0.5;
        const offsetX = $currWidth * speed;
        const offsetY = $currHeight * speed;
        const mousePt = getInnerMousePosition(e);

        let newWidth = $currWidth;
        let newHeight = $currHeight;
        // zoom in
        if (e.deltaY < 0) {
            // minx += offsetX / 2;
            // miny += offsetY / 2;
            newWidth -= offsetX;
            newHeight -= offsetY;

        // zoom out
        } else if (e.deltaY > 0) {
            newWidth += offsetX;
            newHeight += offsetY;
            const fitted = fitViewportToMap(boardWidthPx, boardHeightPx, newWidth, newHeight);
            newWidth = fitted.viewW;
            newHeight = fitted.viewH;
        }
        currWidth.set(newWidth);
        currHeight.set(newHeight);

        // now try to center on the mouse point
        const originX = clampViewportOrigin(mousePt.x, newWidth, boardMaxPx, boardMinPx);
        const originY = clampViewportOrigin(mousePt.y, newHeight, boardMaxPy, boardMinPy);
        currX.set(originX);
        currY.set(originY);
    }

    interface IPoint {
        x: number;
        y: number;
    }

    const clientPointFromEvent = (e: WheelEvent | MouseEvent | TouchEvent): IPoint => {
        if ("touches" in e) {
            const touch = (e as TouchEvent).touches[0];
            return { x: touch.clientX, y: touch.clientY };
        }
        const me = e as MouseEvent | WheelEvent;
        return { x: me.clientX, y: me.clientY };
    };

    /** Map pixel coordinates from a screen point over the inner map. */
    const clientToMapPixels = (clientX: number, clientY: number): IPoint => {
        if (!innerSvg) return { x: 0, y: 0 };
        return screenToSvgUser(innerSvg, clientX, clientY);
    };

    const getInnerMousePosition = (e: WheelEvent | MouseEvent | TouchEvent): IPoint => {
        const { x, y } = clientPointFromEvent(e);
        return clientToMapPixels(x, y);
    };

    const getOuterMousePosition = (e: WheelEvent | MouseEvent | TouchEvent): IPoint => {
        const CTM = outerSvg.getScreenCTM();
        if (CTM === null) {
            return { x: 0, y: 0 };
        }
        let realE: WheelEvent | MouseEvent | Touch;
        if ("touches" in e) {
            realE = (e as TouchEvent).touches[0];
        } else {
            realE = e as (MouseEvent | WheelEvent);
        }
        return {
            x: (realE.clientX - CTM.e) / CTM.a,
            y: (realE.clientY - CTM.f) / CTM.d
        };
    }

    let panning = false;

    const endPan = () => {
        panning = false;
    };

    const dragStart = (e: MouseEvent | TouchEvent) => {
        const mode = get(clickMode);
        if (e instanceof MouseEvent && mode === "beacon") {
            panning = false;
            return;
        }
        if (e instanceof MouseEvent && mode === "select") {
            const objects = get(currentState).state?.objects;
            const ref =
                resolveClickEvent(e, objects) ??
                resolveClickedElement(
                    e.target instanceof Element ? e.target : undefined,
                    objects
                );
            if (ref) {
                panning = false;
                return;
            }
        }
        panning = true;
    }

    const dragEnd = (_e: MouseEvent | TouchEvent) => {
        endPan();
    }

    const updateMouseStatus = (e: MouseEvent, point: IPoint) => {
        const objects = get(currentState).state?.objects;
        const ref =
            resolveHoverEvent(e, objects) ??
            resolveClickedElement(
                e.target instanceof Element ? e.target : undefined,
                objects
            );
        mousePos.update((pos) => {
            if (pos === undefined) return pos;
            return {
                x: point.x / pixelsPerMU,
                y: point.y / pixelsPerMU,
                id: ref?.objId,
            };
        });
    };

    const clearHoveredId = () => {
        mousePos.update((pos) => {
            if (pos === undefined) return pos;
            return { ...pos, id: undefined };
        });
    };

    const dragMouse = (e: MouseEvent) => {
        // Speed is relative to viewBox. You should move slower the more zoomed in you are.
        const speed = (($currWidth + $currHeight) / 2) * 0.1;
        if (panning) {
            e.preventDefault();
            const newX = $currX + (e.movementX * -1 * speed);
            if (newX < boardMinPx) {
                currX.set(boardMinPx);
            } else if (newX > boardMaxPx - $currWidth) {
                currX.set(boardMaxPx - $currWidth);
            } else {
                currX.set(newX);
            }
            const newY = $currY + (e.movementY * -1 * speed);
            if (newY < boardMinPy) {
                currY.set(boardMinPy);
            } else if (newY > boardMaxPy - $currHeight) {
                currY.set(boardMaxPy - $currHeight);
            } else {
                currY.set(newY);
            }
            return;
        }

        currMouse = getInnerMousePosition(e);
        if (currMouse.x < boardMinPx) {
            currMouse.x = boardMinPx;
        } else if (currMouse.x > boardMaxPx) {
            currMouse.x = boardMaxPx;
        }
        if (currMouse.y < boardMinPy) {
            currMouse.y = boardMinPy;
        } else if (currMouse.y > boardMaxPy) {
            currMouse.y = boardMaxPy;
        }
        updateMouseStatus(e, currMouse);
    }

    const clampMapPoint = (point: IPoint): IPoint => ({
        x: Math.max(boardMinPx, Math.min(point.x, boardMaxPx)),
        y: Math.max(boardMinPy, Math.min(point.y, boardMaxPy)),
    });

    const outerMove = (e: MouseEvent) => {
        if (innerSvg) {
            const rect = innerSvg.getBoundingClientRect();
            const overMapX = e.clientX >= rect.left && e.clientX <= rect.right;
            const overMapY = e.clientY >= rect.top && e.clientY <= rect.bottom;
            if (overMapX && overMapY) {
                return;
            }
            if (overMapX || overMapY) {
                const clientX = overMapX
                    ? e.clientX
                    : Math.max(rect.left, Math.min(e.clientX, rect.right));
                const clientY = overMapY
                    ? e.clientY
                    : Math.max(rect.top, Math.min(e.clientY, rect.bottom));
                currMouse = clampMapPoint(clientToMapPixels(clientX, clientY));
                updateMouseStatus(e, currMouse);
                return;
            }
        }

        currMouse = getOuterMousePosition(e);
        currMouse.x -= mapInset;
        currMouse.y -= mapInset;
        currMouse = clampMapPoint(currMouse);
        updateMouseStatus(e, currMouse);
    }

    const handleLeftClick = (e: MouseEvent) => {
        currMouse = clampMapPoint(getInnerMousePosition(e));

        if (get(clickMode) !== undefined) {
            switch (get(clickMode)) {
                case "beacon":
                    $beacon = { x: currMouse.x / pixelsPerMU, y: currMouse.y / pixelsPerMU};
                    break;
                case "select": {
                    const objects = get(currentState).state?.objects;
                    const ref =
                        resolveClickEvent(e, objects) ??
                        resolveClickedElement(
                            e.target instanceof Element ? e.target : undefined,
                            objects
                        );
                    if (ref) {
                        selectObject(objectRefKey(ref));
                    }
                    break;
                }
                default:
                    throw new Error(`Unrecognized click mode: ${$clickMode}`);
            }
        }
    }

    const handleRightClick = (e: MouseEvent) => {
        if (get(clickMode) !== undefined) {
            e.preventDefault();
            $beacon = undefined;
            selectedObject.set(undefined);
        }
    }

    const rulerWidth = pixelsPerMU;
    const rulerGap = 20;
    const mapInset = rulerWidth + rulerGap;
    let currMouse: IPoint;

    $: xRulerMarks = generateRulerTicks($currX, $currWidth, pixelsPerMU);
    $: yRulerMarks = generateRulerTicks($currY, $currHeight, pixelsPerMU);
    $: showMouseX =
        currMouse !== undefined &&
        currMouse.x >= $currX &&
        currMouse.x <= $currX + $currWidth;
    $: showMouseY =
        currMouse !== undefined &&
        currMouse.y >= $currY &&
        currMouse.y <= $currY + $currHeight;

    const smallestGlyphRatio = 0.5;
    const ship2mu = (ship: FullThrustShip): number => {
        let ratio = (ship.mass ?? 75) / 75;
        return Math.max(smallestGlyphRatio, ratio);
    }

    /** Ordnance map token size in MU. */
    const ordnanceTokenMu = 0.4;

    let contrastColour = "white";
    userSettings.subscribe(val => {
        if (val.opacity !== undefined && val.opacity < 0.5) {
            contrastColour = "black";
        } else {
            contrastColour = "white";
        }
    });
</script>

<section class="container">
    <div class="mapSvg">
        <svg bind:this="{outerSvg}" preserveAspectRatio="none" viewBox="-1 -1 {boardWidthPx + (rulerWidth * 2) + (rulerGap * 2) + 2} {boardHeightPx + (rulerWidth * 2) + (rulerGap * 2)  + 2}" on:mousemove="{outerMove}">
            <defs>
                <!-- Define interactive object glyphs -->
                {#if ($currentState.state !== undefined) && ($currentState.state.objects !== undefined)}
                    {#key boardKey}
                        {#each $currentState.state.objects as obj (obj.id)}
                            {#if obj.objType === "ship"}
                                <RenderCounter object={obj}/>
                            {:else if obj.svg}
                                {@html recolorGlyphSvg(
                                    obj.svg,
                                    ownerColour($currentState.state?.players, obj.owner, contrastColour),
                                    contrastColour
                                )}
                            {/if}
                        {/each}
                    {/key}
                {/if}
            </defs>

            <!-- X rulers: viewBox tracks the visible map window so ticks stay on whole MUs -->
            <svg
                x="{mapInset}"
                y="0"
                width="{boardWidthPx}"
                height="{rulerWidth}"
                viewBox="{$currX} 0 {$currWidth} {rulerWidth}"
                preserveAspectRatio="none"
            >
                <rect
                    x="{$currX}"
                    y="0"
                    width="{$currWidth}"
                    height="{rulerWidth}"
                    fill="#f5f5f5"
                    stroke="#cccccc"
                />
                {#each xRulerMarks as mark (mark.coordPx)}
                    {@const tickLen = rulerTickLength(mark.level, rulerWidth)}
                    <line
                        x1="{mark.coordPx}"
                        y1="{rulerWidth}"
                        x2="{mark.coordPx}"
                        y2="{rulerWidth - tickLen}"
                        stroke="#333333"
                        stroke-width="{rulerTickStroke(mark.level, pixelsPerMU)}"
                    />
                {/each}
                {#if showMouseX}
                    <line
                        x1="{currMouse.x}"
                        y1="0"
                        x2="{currMouse.x}"
                        y2="{rulerWidth}"
                        stroke="red"
                        stroke-width="{pixelsPerMU / 20}"
                    />
                {/if}
            </svg>
            <svg
                x="{mapInset}"
                y="{mapInset + boardHeightPx}"
                width="{boardWidthPx}"
                height="{rulerWidth}"
                viewBox="{$currX} 0 {$currWidth} {rulerWidth}"
                preserveAspectRatio="none"
            >
                <rect
                    x="{$currX}"
                    y="0"
                    width="{$currWidth}"
                    height="{rulerWidth}"
                    fill="#f5f5f5"
                    stroke="#cccccc"
                />
                {#each xRulerMarks as mark (mark.coordPx)}
                    {@const tickLen = rulerTickLength(mark.level, rulerWidth)}
                    <line
                        x1="{mark.coordPx}"
                        y1="0"
                        x2="{mark.coordPx}"
                        y2="{tickLen}"
                        stroke="#333333"
                        stroke-width="{rulerTickStroke(mark.level, pixelsPerMU)}"
                    />
                {/each}
                {#if showMouseX}
                    <line
                        x1="{currMouse.x}"
                        y1="0"
                        x2="{currMouse.x}"
                        y2="{rulerWidth}"
                        stroke="red"
                        stroke-width="{pixelsPerMU / 20}"
                    />
                {/if}
            </svg>

            <!-- Y rulers -->
            <svg
                x="0"
                y="{mapInset}"
                width="{rulerWidth}"
                height="{boardHeightPx}"
                viewBox="0 {$currY} {rulerWidth} {$currHeight}"
                preserveAspectRatio="none"
            >
                <rect
                    x="0"
                    y="{$currY}"
                    width="{rulerWidth}"
                    height="{$currHeight}"
                    fill="#f5f5f5"
                    stroke="#cccccc"
                />
                {#each yRulerMarks as mark (mark.coordPx)}
                    {@const tickLen = rulerTickLength(mark.level, rulerWidth)}
                    <line
                        x1="{rulerWidth}"
                        y1="{mark.coordPx}"
                        x2="{rulerWidth - tickLen}"
                        y2="{mark.coordPx}"
                        stroke="#333333"
                        stroke-width="{rulerTickStroke(mark.level, pixelsPerMU)}"
                    />
                {/each}
                {#if showMouseY}
                    <line
                        x1="0"
                        y1="{currMouse.y}"
                        x2="{rulerWidth}"
                        y2="{currMouse.y}"
                        stroke="red"
                        stroke-width="{pixelsPerMU / 20}"
                    />
                {/if}
            </svg>
            <svg
                x="{mapInset + boardWidthPx}"
                y="{mapInset}"
                width="{rulerWidth}"
                height="{boardHeightPx}"
                viewBox="0 {$currY} {rulerWidth} {$currHeight}"
                preserveAspectRatio="none"
            >
                <rect
                    x="0"
                    y="{$currY}"
                    width="{rulerWidth}"
                    height="{$currHeight}"
                    fill="#f5f5f5"
                    stroke="#cccccc"
                />
                {#each yRulerMarks as mark (mark.coordPx)}
                    {@const tickLen = rulerTickLength(mark.level, rulerWidth)}
                    <line
                        x1="0"
                        y1="{mark.coordPx}"
                        x2="{tickLen}"
                        y2="{mark.coordPx}"
                        stroke="#333333"
                        stroke-width="{rulerTickStroke(mark.level, pixelsPerMU)}"
                    />
                {/each}
                {#if showMouseY}
                    <line
                        x1="0"
                        y1="{currMouse.y}"
                        x2="{rulerWidth}"
                        y2="{currMouse.y}"
                        stroke="red"
                        stroke-width="{pixelsPerMU / 20}"
                    />
                {/if}
            </svg>

            <!-- And here's the map -->
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <svg bind:this="{innerSvg}" class:map-beacon-mode={$clickMode === "beacon"} preserveAspectRatio="none" viewBox="{$currX} {$currY} {$currWidth} {$currHeight}" x="{mapInset}" y="{mapInset}" width="{boardWidthPx}" height="{boardHeightPx}" on:wheel="{handleWheel}" on:mousedown="{dragStart}" on:mouseup="{dragEnd}" on:mouseleave="{() => { dragEnd(); clearHoveredId(); }}" on:mousemove="{dragMouse}" on:click="{handleLeftClick}" on:contextmenu={handleRightClick}>
                <rect x="{boardMinPx}" y="{boardMinPy}" width="{boardWidthPx}" height="{boardHeightPx}" fill="black" opacity="{$userSettings.opacity !== undefined ? $userSettings.opacity : 1}" />
            <!-- Add Annotations to bottom layer -->
            {#each $annotations as note}
                {@html genAnnotation(note, contrastColour, pixelsPerMU)}
            {/each}
            {#if ($currentState.pendingLaunches?.length ?? 0) > 0 && ($currentState.meta?.phase ?? 0) === 3}
                {#each $currentState.pendingLaunches ?? [] as pending}
                    {#if pending.name === "declareLaunchOrdnance"}
                        {@const rocket = (pending as { type?: string; targetShip?: string }).type === "rocket"}
                        {@const targetId = (pending as { targetShip?: string }).targetShip}
                        {#if rocket && targetId}
                            {@const tgt = $currentState.state?.objects?.find((o) => o.id === targetId)}
                            {#if tgt?.position && "x" in tgt.position}
                                {@const tpos = tgt.position}
                                <circle
                                    pointer-events="none"
                                    cx={tpos.x * pixelsPerMU}
                                    cy={tpos.y * pixelsPerMU}
                                    r={0.5 * pixelsPerMU}
                                    fill="none"
                                    stroke="#ff6644"
                                    stroke-width="2"
                                    stroke-dasharray="4 4"
                                />
                            {/if}
                        {:else}
                            {@const pos = (pending as { position?: { x: number; y: number } }).position}
                            {#if pos}
                                <circle
                                    pointer-events="none"
                                    cx={pos.x * pixelsPerMU}
                                    cy={pos.y * pixelsPerMU}
                                    r="6"
                                    fill="none"
                                    stroke="#ffb86b"
                                    stroke-width="2"
                                    stroke-dasharray="4 4"
                                />
                            {/if}
                        {/if}
                    {/if}
                {/each}
            {/if}
            {#if pendingMineMarkers.length > 0}
                {#each pendingMineMarkers as marker (marker.key)}
                    {@const opos = marker.position}
                    {@const colour =
                        $currentState.state?.players?.find((p) => p.id === marker.owner)?.colour ??
                        "#ff6644"}
                    <g id="ordnance_{marker.key}" pointer-events="bounding-box">
                        <title>{marker.shipId} mine (pending) · {marker.systemId}</title>
                        <circle
                            cx={opos.x * pixelsPerMU}
                            cy={opos.y * pixelsPerMU}
                            r={0.35 * pixelsPerMU}
                            fill={colour}
                            fill-opacity="0.35"
                            stroke={colour}
                            stroke-width="2"
                            stroke-dasharray="5 4"
                        />
                        <text
                            x={opos.x * pixelsPerMU}
                            y={opos.y * pixelsPerMU}
                            text-anchor="middle"
                            dominant-baseline="middle"
                            fill={contrastColour}
                            font-size="14"
                            font-weight="bold"
                            pointer-events="none"
                        >M</text>
                        <circle
                            pointer-events="none"
                            cx={opos.x * pixelsPerMU}
                            cy={opos.y * pixelsPerMU}
                            r={3 * pixelsPerMU}
                            fill="none"
                            stroke={colour}
                            stroke-opacity="0.3"
                            stroke-dasharray="6 6"
                        />
                    </g>
                {/each}
            {/if}
            {#if ($currentState.pendingOrdnanceAllocations?.length ?? 0) > 0}
                {#each $currentState.pendingOrdnanceAllocations ?? [] as pendingAlloc}
                    {#if pendingAlloc.action === "target" && pendingAlloc.targetShipId}
                        {@const ord = $currentState.state?.objects?.find((o) => o.id === pendingAlloc.ordnanceId)}
                        {@const tgt = $currentState.state?.objects?.find((o) => o.id === pendingAlloc.targetShipId)}
                        {#if ord?.position && "x" in ord.position && tgt?.position && "x" in tgt.position}
                            {@const opos = ord.position as { x: number; y: number }}
                            {@const tpos = tgt.position as { x: number; y: number }}
                            <line
                                pointer-events="none"
                                x1={opos.x * pixelsPerMU}
                                y1={opos.y * pixelsPerMU}
                                x2={tpos.x * pixelsPerMU}
                                y2={tpos.y * pixelsPerMU}
                                stroke="#ffb86b"
                                stroke-width="2"
                                stroke-dasharray="5 4"
                                stroke-opacity="0.85"
                            />
                        {/if}
                    {/if}
                {/each}
            {/if}
            {#if $currentState.state?.objects}
                {#each $currentState.state.objects as ordLine (ordLine.id + "_ordtgt")}
                    {#if ordLine.objType === "ordnance" && (ordLine as { targetShip?: string }).targetShip && ordLine.position && "x" in ordLine.position}
                        {@const targetId = (ordLine as { targetShip?: string }).targetShip}
                        {@const tgt = $currentState.state.objects?.find((o) => o.id === targetId)}
                        {#if tgt?.position && "x" in tgt.position}
                            {@const opos = ordLine.position as { x: number; y: number }}
                            {@const tpos = tgt.position as { x: number; y: number }}
                            <line
                                pointer-events="none"
                                x1={opos.x * pixelsPerMU}
                                y1={opos.y * pixelsPerMU}
                                x2={tpos.x * pixelsPerMU}
                                y2={tpos.y * pixelsPerMU}
                                stroke={ordLine.type === "rocket" ? "#ff6644" : "#ffaa44"}
                                stroke-width="2"
                                stroke-dasharray={ordLine.type === "rocket" ? "4 4" : "none"}
                                stroke-opacity="0.9"
                            />
                        {/if}
                    {/if}
                {/each}
            {/if}

            {#if $currentState.state?.objects}
                {#each $currentState.state.objects as linkObj (linkObj.id + "_attach")}
                    {#if linkObj.objType === "fighters" && (linkObj as { attackAllocation?: { targetId: string; targetType: string } }).attackAllocation && linkObj.position && "x" in linkObj.position}
                        {@const alloc = (linkObj as { attackAllocation: { targetId: string; targetType: string } }).attackAllocation}
                        {@const target = $currentState.state.objects?.find((o) => o.id === alloc.targetId && o.objType === alloc.targetType)}
                        {#if target?.position && typeof target.position === "object" && "x" in target.position}
                            {@const fpos = linkObj.position as { x: number; y: number }}
                            {@const tpos = target.position as { x: number; y: number }}
                            <line
                                pointer-events="none"
                                x1={fpos.x * pixelsPerMU}
                                y1={fpos.y * pixelsPerMU}
                                x2={tpos.x * pixelsPerMU}
                                y2={tpos.y * pixelsPerMU}
                                stroke="#ff6666"
                                stroke-width="2"
                                stroke-dasharray="6 4"
                                stroke-opacity="0.85"
                            />
                        {/if}
                    {:else if linkObj.objType === "fighters" && linkObj.fighterAttachment && linkObj.position && "x" in linkObj.position}
                        {@const att = linkObj.fighterAttachment}
                        {@const target = $currentState.state.objects?.find((o) => o.id === att.targetId)}
                        {#if target?.position && typeof target.position === "object" && "x" in target.position}
                            {@const fpos = linkObj.position as { x: number; y: number }}
                            {@const tpos = target.position as { x: number; y: number }}
                            {@const linkColour =
                                att.kind === "screen"
                                    ? ($currentState.state.players?.find((p) => p.id === linkObj.owner)?.colour ?? "#88ff88")
                                    : "#ff8888"}
                            <line
                                pointer-events="none"
                                x1={fpos.x * pixelsPerMU}
                                y1={fpos.y * pixelsPerMU}
                                x2={tpos.x * pixelsPerMU}
                                y2={tpos.y * pixelsPerMU}
                                stroke={linkColour}
                                stroke-width="2"
                                stroke-dasharray="6 4"
                                stroke-opacity="0.75"
                            />
                            <text
                                pointer-events="none"
                                x={(fpos.x + tpos.x) * 0.5 * pixelsPerMU}
                                y={(fpos.y + tpos.y) * 0.5 * pixelsPerMU}
                                text-anchor="middle"
                                dominant-baseline="middle"
                                fill={linkColour}
                                font-size="12"
                                font-weight="bold"
                            >{att.kind === "screen" ? "S" : "P"}</text>
                        {/if}
                    {/if}
                {/each}
            {/if}

            <!-- Place interactive objects -->
            {#if ($currentState.state !== undefined) && ($currentState.state.objects !== undefined)}
                {#key boardKey}
                {#each $currentState.state.objects as obj (obj.id)}
                    {#if obj.objType === "ship" && obj.position != null}
                        {@const capture = (obj as { boardingCapture?: { by: string; resolved?: boolean } }).boardingCapture}
                        {#if obj.vectors && obj.vectors.length > 0}
                            {#each obj.vectors as path, vi}
                                <polyline
                                    pointer-events="none"
                                    points={path.map((p) => `${p.x * pixelsPerMU},${p.y * pixelsPerMU}`).join(" ")}
                                    fill="none"
                                    stroke={contrastColour}
                                    stroke-opacity={vi === 0 ? 0.8 : 0.3}
                                    stroke-width={vi === 0 ? 4 : 2}
                                />
                            {/each}
                        {/if}
                        <g id="ship_{obj.id}" pointer-events="bounding-box">
                            <title
                                >{obj.id}{#if capture && !capture.resolved}
                                    — CAPTURED (awaiting transfer to {capture.by}){/if}</title
                            >
                            <rect
                                x="{(obj.position.x * pixelsPerMU) - ((ship2mu(obj.object) * pixelsPerMU) / 2)}"
                                y="{(obj.position.y * pixelsPerMU) - ((ship2mu(obj.object) * pixelsPerMU) / 2)}"
                                width="{ship2mu(obj.object) * pixelsPerMU}"
                                height="{ship2mu(obj.object) * pixelsPerMU}"
                                fill="transparent"
                            />
                            {#if capture && !capture.resolved}
                                <rect
                                    pointer-events="none"
                                    x="{(obj.position.x * pixelsPerMU) - ((ship2mu(obj.object) * pixelsPerMU) / 2)}"
                                    y="{(obj.position.y * pixelsPerMU) - ((ship2mu(obj.object) * pixelsPerMU) / 2)}"
                                    width="{ship2mu(obj.object) * pixelsPerMU}"
                                    height="{ship2mu(obj.object) * pixelsPerMU}"
                                    fill="none"
                                    stroke="#f14668"
                                    stroke-width="3"
                                    stroke-dasharray="6 4"
                                />
                                <text
                                    pointer-events="none"
                                    x="{obj.position.x * pixelsPerMU}"
                                    y="{(obj.position.y * pixelsPerMU) - ((ship2mu(obj.object) * pixelsPerMU) / 2) - 4}"
                                    text-anchor="middle"
                                    font-size="11"
                                    font-weight="bold"
                                    fill="#f14668"
                                >
                                    CAPTURED
                                </text>
                            {/if}
                            <use
                                pointer-events="none"
                                href="#{obj.id}"
                                x="{(obj.position.x * pixelsPerMU) - ((ship2mu(obj.object) * pixelsPerMU) / 2)}"
                                y="{(obj.position.y * pixelsPerMU) - ((ship2mu(obj.object) * pixelsPerMU) / 2)}"
                                width="{ship2mu(obj.object) * pixelsPerMU}"
                                height="{ship2mu(obj.object) * pixelsPerMU}"
                            />
                        </g>
                    {:else if obj.objType === "fighters" && obj.position != null && "x" in obj.position}
                        {@const fpos = obj.position as { x: number; y: number }}
                        {@const fColour = $currentState.state.players?.find((p) => p.id === obj.owner)?.colour ?? contrastColour}
                        {@const fw = FIGHTER_MAP_TOKEN_W_MU * pixelsPerMU}
                        {@const fh = FIGHTER_MAP_TOKEN_H_MU * pixelsPerMU}
                        {@const cx = fpos.x * pixelsPerMU}
                        {@const cy = fpos.y * pixelsPerMU}
                        {@const rot = (obj.facing ?? 12) * 30}
                        {#if obj.vectors && obj.vectors.length > 0}
                            {#each obj.vectors as path, vi}
                                <polyline
                                    pointer-events="none"
                                    points={path.map((p) => `${p.x * pixelsPerMU},${p.y * pixelsPerMU}`).join(" ")}
                                    fill="none"
                                    stroke={contrastColour}
                                    stroke-opacity={vi === 0 ? 0.6 : 0.25}
                                    stroke-width="2"
                                />
                            {/each}
                        {/if}
                        <g id="fighters_{obj.id}" pointer-events="bounding-box">
                            <title>{fighterGroupLabel(obj)} · {obj.type} ×{obj.number ?? 6}{#if (obj as { callsign?: string }).callsign} ({obj.id}){/if}</title>
                            {#if obj.svg}
                                <g transform="translate({cx},{cy}) rotate({rot})">
                                    <rect
                                        x={-fw / 2}
                                        y={-fh / 2}
                                        width={fw}
                                        height={fh}
                                        fill="transparent"
                                    />
                                    <use
                                        pointer-events="none"
                                        href="#{obj.id}"
                                        x={-fw / 2}
                                        y={-fh / 2}
                                        width={fw}
                                        height={fh}
                                    />
                                </g>
                            {:else}
                                <circle
                                    cx={cx}
                                    cy={cy}
                                    r={FIGHTER_MAP_TOKEN_RADIUS_MU * pixelsPerMU}
                                    fill={fColour}
                                    opacity="0.85"
                                    stroke={contrastColour}
                                    stroke-width="2"
                                />
                                <text
                                    x={cx}
                                    y={cy}
                                    text-anchor="middle"
                                    dominant-baseline="middle"
                                    fill={contrastColour}
                                    font-size={Math.max(9, Math.round(fw * 0.5))}
                                >{obj.number ?? 6}</text>
                            {/if}
                        </g>
                    {:else if obj.objType === "gunboats" && obj.position != null && "x" in obj.position}
                        {@const gpos = obj.position as { x: number; y: number }}
                        {@const gColour =
                            $currentState.state.players?.find((p) => p.id === obj.owner)?.colour ??
                            contrastColour}
                        {@const gw = GUNBOAT_MAP_TOKEN_W_MU * pixelsPerMU}
                        {@const gh = GUNBOAT_MAP_TOKEN_H_MU * pixelsPerMU}
                        {@const gcx = gpos.x * pixelsPerMU}
                        {@const gcy = gpos.y * pixelsPerMU}
                        {@const grot = (obj.facing ?? 12) * 30}
                        <g id="gunboats_{obj.id}" pointer-events="bounding-box">
                            <title>{gunboatGroupLabel(obj)} ×{obj.number ?? 6}</title>
                            {#if obj.svg}
                                <g transform="translate({gcx},{gcy}) rotate({grot})">
                                    <rect
                                        x={-gw / 2}
                                        y={-gh / 2}
                                        width={gw}
                                        height={gh}
                                        fill="transparent"
                                    />
                                    <use
                                        pointer-events="none"
                                        href="#{obj.id}"
                                        x={-gw / 2}
                                        y={-gh / 2}
                                        width={gw}
                                        height={gh}
                                    />
                                </g>
                            {:else}
                                <g transform="translate({gcx},{gcy}) rotate({grot})">
                                    <rect
                                        x={-gw / 2}
                                        y={-gh / 2}
                                        width={gw}
                                        height={gh}
                                        fill={gColour}
                                        opacity="0.9"
                                        stroke={contrastColour}
                                        stroke-width="2"
                                    />
                                    <text
                                        x="0"
                                        y="0"
                                        text-anchor="middle"
                                        dominant-baseline="middle"
                                        fill={contrastColour}
                                        font-size={Math.max(7, Math.round(gh * 0.45))}
                                    >{obj.number ?? 6}</text>
                                </g>
                            {/if}
                        </g>
                    {:else if obj.objType === "ordnance" && obj.position != null}
                        {@const opos = obj.position as { x: number; y: number }}
                        {@const ordColour =
                            $currentState.state.players?.find((p) => p.id === obj.owner)?.colour ??
                            "#ffaa00"}
                        {@const ow = ordnanceTokenMu * pixelsPerMU}
                        {@const oh = ordnanceTokenMu * pixelsPerMU}
                        {@const ocx = opos.x * pixelsPerMU}
                        {@const ocy = opos.y * pixelsPerMU}
                        {@const orot = obj.facing ? obj.facing * 30 : 0}
                        <g id="ordnance_{obj.id}" pointer-events="bounding-box">
                            <title>{obj.id}{#if isSalvoOrdnanceType(obj.type)} · ×{salvoMissileCount(obj)}{/if}</title>
                            {#if obj.type === "mine"}
                                <circle
                                    cx={opos.x * pixelsPerMU}
                                    cy={opos.y * pixelsPerMU}
                                    r={0.4 * pixelsPerMU}
                                    fill={ordColour}
                                    opacity="0.9"
                                    stroke={contrastColour}
                                    stroke-width="2"
                                />
                                <text
                                    x={opos.x * pixelsPerMU}
                                    y={opos.y * pixelsPerMU}
                                    text-anchor="middle"
                                    dominant-baseline="middle"
                                    fill={contrastColour}
                                    font-size="16"
                                    font-weight="bold"
                                    pointer-events="none"
                                >M</text>
                            {:else if obj.svg}
                                <g transform="translate({ocx},{ocy}) rotate({orot})">
                                    <use
                                        pointer-events="none"
                                        href="#{obj.id}"
                                        x={-ow / 2}
                                        y={-oh / 2}
                                        width={ow}
                                        height={oh}
                                    />
                                </g>
                                {#if isSalvoOrdnanceType(obj.type)}
                                    {@const salvoN = salvoMissileCount(obj)}
                                    <text
                                        x={ocx}
                                        y={ocy}
                                        text-anchor="middle"
                                        dominant-baseline="middle"
                                        fill={contrastColour}
                                        font-size={Math.max(9, Math.round(ow * 0.55))}
                                        font-weight="bold"
                                        pointer-events="none"
                                    >{salvoN}</text>
                                {/if}
                            {:else}
                                <polygon
                                    points={[
                                        [0, -0.3],
                                        [0.25, 0],
                                        [0, 0.3],
                                        [-0.25, 0],
                                    ]
                                        .map(
                                            ([dx, dy]) =>
                                                `${(opos.x + dx) * pixelsPerMU},${(opos.y + dy) * pixelsPerMU}`
                                        )
                                        .join(" ")}
                                    fill={ordColour}
                                    stroke={contrastColour}
                                    stroke-width="2"
                                />
                            {/if}
                            {#if (obj as { aimPosition?: { x: number; y: number } }).aimPosition}
                                {@const aim = (obj as { aimPosition: { x: number; y: number } }).aimPosition}
                                <circle
                                    pointer-events="none"
                                    cx={aim.x * pixelsPerMU}
                                    cy={aim.y * pixelsPerMU}
                                    r={4}
                                    fill="none"
                                    stroke="#88ccff"
                                    stroke-opacity="0.5"
                                    stroke-dasharray="3 3"
                                />
                            {/if}
                            {#if obj.range}
                                <circle
                                    pointer-events="none"
                                    cx={opos.x * pixelsPerMU}
                                    cy={opos.y * pixelsPerMU}
                                    r={obj.range * pixelsPerMU}
                                    fill="none"
                                    stroke={contrastColour}
                                    stroke-opacity="0.25"
                                    stroke-dasharray="8 8"
                                />
                            {/if}
                        </g>
                    {/if}
                {/each}
                {/key}
            {/if}
            {#each $trajectoryLines as line (line.key)}
                <polyline
                    pointer-events="none"
                    points={line.points}
                    fill="none"
                    stroke="#000000"
                    stroke-opacity={0.45}
                    stroke-width={trajectoryStrokeWidth * 1.75}
                    stroke-dasharray={line.strokeDasharray}
                    stroke-linecap="round"
                    stroke-linejoin="round"
                />
                <polyline
                    pointer-events="none"
                    points={line.points}
                    fill="none"
                    stroke={line.stroke}
                    stroke-opacity={line.strokeOpacity}
                    stroke-width={trajectoryStrokeWidth}
                    stroke-dasharray={line.strokeDasharray}
                    stroke-linecap="round"
                    stroke-linejoin="round"
                />
                <circle
                    pointer-events="none"
                    cx={line.endX}
                    cy={line.endY}
                    r={trajectoryStrokeWidth * 0.9}
                    fill="none"
                    stroke={line.stroke}
                    stroke-opacity={line.strokeOpacity}
                    stroke-width={trajectoryStrokeWidth * 0.35}
                />
            {/each}
            {#if $beacon !== undefined}
                <circle
                    id="_beacon"
                    class="beacon"
                    cx="{$beacon.x * pixelsPerMU}"
                    cy="{$beacon.y * pixelsPerMU}"
                    r={0.35 * pixelsPerMU}
                    fill="none"
                    stroke={contrastColour}
                    stroke-width="4"
                    opacity="0.9"
                />
            {/if}
            </svg>
        </svg>
    </div>
</section>

<style>
    .mapSvg {
        width: 100%;
        height: auto;
    }
    @keyframes beacon-pulse {
        from {
            transform: scale(0.65);
            opacity: 0.55;
        }
        50% {
            transform: scale(1.15);
            opacity: 1;
        }
        to {
            transform: scale(0.65);
            opacity: 0.55;
        }
    }
    .beacon {
        transform-origin: center;
        transform-box: fill-box;
        animation: beacon-pulse 1.5s ease-in-out infinite;
        pointer-events: none;
    }
    .map-beacon-mode {
        cursor: crosshair;
    }
</style>