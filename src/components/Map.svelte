<script lang="ts">
    import { onMount, afterUpdate } from 'svelte';
    // import { nanoid } from "nanoid";
    import { tweened } from "svelte/motion";
    import { sineOut } from 'svelte/easing';
    import { mousePos } from "@/stores/writeMousePos";
    import { beacon } from '@/stores/writeBeacon';
    import { currentState } from '@/stores/derivedState';
    import { mapBuffers } from '@/stores/writeBuffer';
    import { clickMode } from '@/stores/writeClickMode';
    import type { Position } from '@/schemas/position';
    import { initialState } from '@/stores/writeInitialState';
    import RenderCounter from './RenderCounter.svelte';
    import type { FullThrustShip } from 'ftlibship';
    import { userSettings } from '@/stores/writeUserSettings';

    let pixelsPerMU = 100;
    let maxX = 72 * pixelsPerMU;
    let maxY = 48 * pixelsPerMU;
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
    onMount(() => {
        resetMap();
    });

    const resetMap = () => {
        let originX = 0;
        let originY = 0;
        if ( ($currentState !== undefined) && ($currentState.state !== undefined) && ($currentState.state.map !== undefined) ) {
            if ($currentState.state.map.mode === "fixed")  {
                maxX = $currentState.state.map.width * pixelsPerMU;
                maxY = $currentState.state.map.height * pixelsPerMU;
            } else {
                let [mnx, mny, mxx, mxy] = getVisibleDimensions();
                if (mnx === Infinity) { mnx = 0; }
                if (mxx === -Infinity) { mxx = 72; }
                if (mny === Infinity) { mny = 0; }
                if (mxy === -Infinity) { mxy = 48; }
                originX = mnx * pixelsPerMU;
                originY = mny * pixelsPerMU;
                maxX = mxx * pixelsPerMU;
                maxY = mxy * pixelsPerMU;
            }
        }
        $mousePos = {x: originX, y: originY};
        currX.set(originX);
        currY.set(originY);
        currWidth.set(maxX - originX);
        currHeight.set(maxY - originY);
    }
    initialState.subscribe(() => resetMap());

    const getVisibleDimensions = (): [number, number, number, number] => {
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;

        if ( ($currentState !== undefined) && ($currentState.state !== undefined) && ($currentState.state.objects !== undefined) && ($currentState.state.objects.length > 0) ) {
            for (const obj of $currentState.state.objects) {
                if ( (obj.position !== undefined) && (obj.position.hasOwnProperty("x")) ) {
                    minX = Math.min(minX, (obj.position as Position).x);
                    minY = Math.min(minY, (obj.position as Position).y);
                    maxX = Math.max(maxX, (obj.position as Position).x);
                    maxY = Math.max(maxY, (obj.position as Position).y);
                }
            }
        }

        return [minX, minY, maxX, maxY];
    }

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
            // minx -= offsetX / 2;
            // if (minx < 0) { minx = 0; }
            // miny -= offsetY / 2;
            // if (miny < 0) { miny = 0; }
            newWidth += offsetX;
            if (newWidth > maxX) { newWidth = maxX; }
            newHeight += offsetY;
            if (newHeight > maxY) { newHeight = maxY; }
        }
        currWidth.set(newWidth);
        currHeight.set(newHeight);

        // now try to center on the mouse point
        let originX = mousePt.x - (newWidth / 2);
        let originY = mousePt.y - (newHeight / 2);
        if (originX < 0) {
            currX.set(0);
        } else if (originX > (maxX - newWidth)) {
            currX.set(maxX - newWidth);
        } else {
            currX.set(originX);
        }
        if (originY < 0) {
            currY.set(0);
        } else if (originY > (maxY - newHeight)) {
            currY.set(maxY - newHeight);
        } else {
            currY.set(originY);
        }
    }

    interface IPoint {
        x: number;
        y: number;
    }

    const getInnerMousePosition = (e: (WheelEvent | MouseEvent | TouchEvent)): IPoint => {
        var CTM = innerSvg.getScreenCTM();
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

    const getOuterMousePosition = (e: (WheelEvent | MouseEvent | TouchEvent)): IPoint => {
        var CTM = outerSvg.getScreenCTM();
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

    let panning: boolean;
    const dragStart = (e: MouseEvent | TouchEvent) => {
        panning = true;
    }

    const dragEnd = (e: MouseEvent | TouchEvent) => {
        panning = false;
    }

    const dragMouse = (e: MouseEvent) => {
        // Speed is relative to viewBox. You should move slower the more zoomed in you are.
        const speed = (($currWidth + $currHeight) / 2) * 0.1;
        if (panning) {
            e.preventDefault();
            const newX = $currX + (e.movementX * -1 * speed);
            if (newX < 0) {
                currX.set(0);
            } else if (newX > maxX - $currWidth) {
                currX.set(maxX - $currWidth);
            } else {
                currX.set(newX);
            }
            const newY = $currY + (e.movementY * -1 * speed);
            if (newY < 0) {
                currY.set(0);
            } else if (newY > maxY - $currHeight) {
                currY.set(maxY - $currHeight);
            } else {
                currY.set(newY);
            }
        }
    }

    const outerMove = (e: MouseEvent) => {
        currMouse = getOuterMousePosition(e);
        currMouse.x -= rulerWidth + rulerGap;
        currMouse.y -= rulerWidth + rulerGap;
        if (currMouse.x < 0) {
            currMouse.x = 0;
        } else if (currMouse.x > maxX) {
            currMouse.x = maxX;
        }
        if (currMouse.y < 0) {
            currMouse.y = 0;
        } else if (currMouse.y > maxY) {
            currMouse.y = maxY;
        }

        // put current coordinates in the inputs
        $mousePos.x = currMouse.x / pixelsPerMU;
        $mousePos.y = currMouse.y / pixelsPerMU;
        // If there's something underneath the mouse cursor, put the ID in the input
        const ele = getInnermostHovered();
        if (ele !== undefined) {
            $mousePos.id = ele.id;
        }
    }

    const handleLeftClick = (e: MouseEvent) => {
        currMouse = getInnerMousePosition(e);
        if (currMouse.x < 0) {
            currMouse.x = 0;
        } else if (currMouse.x > maxX) {
            currMouse.x = maxX;
        }
        if (currMouse.y < 0) {
            currMouse.y = 0;
        } else if (currMouse.y > maxY) {
            currMouse.y = maxY;
        }

        if ($clickMode !== undefined) {
            if ($clickMode === "beacon") {
                $beacon = { x: currMouse.x / pixelsPerMU, y: currMouse.y / pixelsPerMU};
            }
        }
    }

    const handleRightClick = (e: MouseEvent) => {
        if ($clickMode !== undefined) {
            e.preventDefault();
            $beacon = undefined;
        }
    }

    const getInnermostHovered = (): Element|undefined => {
        let n = document.querySelector(":hover");
        let nn: Element;
        while (n) {
            nn = n;
            n = nn.querySelector(":hover");
        }
        return nn;
    }

    const rulerWidth = pixelsPerMU;
    const rulerGap = 20;
    let currMouse: IPoint;

    interface IRulerLine {
        coord: number;
        type: number;
    }
    let xLines: IRulerLine[];
    let yLines: IRulerLine[];
    const majorMod = pixelsPerMU;
    const numNotches = 3;
    $: {
        xLines = [];
        for (let i = 0; i < $currWidth; i++) {
            const factor = maxX / $currWidth;
            for (let exp = 0; exp < numNotches; exp++) {
                const mod = majorMod / (2 ** exp);
                if (i % mod === 0) {
                    xLines.push({coord: i * factor, type: exp});
                }
            }
        }

        yLines = [];
        for (let i = 0; i < $currHeight; i++) {
            const factor = maxY / $currHeight;
            for (let exp = 0; exp < numNotches; exp++) {
                const mod = majorMod / (2 ** exp);
                if (i % mod === 0) {
                    yLines.push({coord: i * factor, type: exp});
                }
            }
        }

    }

    const smallestGlyphRatio = 0.5;
    const ship2mu = (ship: FullThrustShip): number => {
        let ratio = ship.mass / 75;
        return Math.max(smallestGlyphRatio, ratio);
    }
</script>

<section class="container">
    <div class="mapSvg">
        <svg bind:this="{outerSvg}" viewBox="-1 -1 {maxX + (rulerWidth * 2) + (rulerGap * 2) + 2} {maxY + (rulerWidth * 2) + (rulerGap * 2)  + 2}" on:mousemove="{outerMove}">
            <defs>
                <symbol id="xRuler" viewBox="0 0 {maxX} {rulerWidth}">
                    <rect x="0" y="0" width="{maxX}" height="{rulerWidth}" fill="none"/>
                {#each xLines as mark}
                    <line x1="{mark.coord}" y1="0" x2="{mark.coord}" y2="{rulerWidth / (2 ** mark.type)}" stroke="black" stroke-width="{(pixelsPerMU / 10) / (2 ** mark.type)}" />
                {/each}
                {#if currMouse !== undefined}
                    <line x1="{currMouse.x}" y1="0" x2="{currMouse.x}" y2="{rulerWidth}" stroke="red" stroke-width="{pixelsPerMU / 20}"/>
                {/if}
                </symbol>
                <symbol id="yRuler" viewBox="0 0 {maxY} {rulerWidth}">
                    <rect x="0" y="0" width="{maxY}" height="{rulerWidth}" fill="none"/>
                {#each yLines as mark}
                    <line x1="{mark.coord}" y1="0" x2="{mark.coord}" y2="{rulerWidth / (2 ** mark.type)}" stroke="black" stroke-width="{(pixelsPerMU / 10) / (2 ** mark.type)}" />
                {/each}
                {#if currMouse !== undefined}
                    <line x1="{currMouse.y}" y1="0" x2="{currMouse.y}" y2="{rulerWidth}" stroke="red" stroke-width="{pixelsPerMU / 20}"/>
                {/if}
                </symbol>
                <!-- Define interactive object glyphs -->
                {#if ($currentState.state !== undefined) && ($currentState.state.objects !== undefined)}
                    {#each $currentState.state.objects as obj}
                        <RenderCounter object={obj}/>
                    {/each}
                {/if}
            </defs>

            <!-- Position the rulers -->
            <use href="#xRuler" x="{rulerWidth + rulerGap}" y="0" height="{rulerWidth}" width="{maxX}" />
            <use href="#xRuler" x="0" y="0" height="{rulerWidth}" width="{maxX}" transform="scale(1,-1) translate({rulerWidth + rulerGap}, -{(rulerWidth * 2) + (rulerGap * 2) + maxY})"/>
            <use href="#yRuler" x="0" y="0" height="{rulerWidth}" width="{maxY}" transform="translate(0, {rulerWidth + rulerGap + maxY}) rotate(-90) scale(-1,1) translate(-{maxY}, 0)" />
            <use href="#yRuler" x="0" y="0" height="{rulerWidth}" width="{maxY}" transform="rotate(90) translate({rulerWidth + rulerGap}, -{(rulerWidth * 2) + (rulerGap * 2) + maxX})"/>

            <!-- And here's the map -->
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <svg bind:this="{innerSvg}" viewBox="{$currX} {$currY} {$currWidth} {$currHeight}" x="{rulerWidth + rulerGap}" y="{rulerWidth + rulerGap}" width="{maxX}" height="{maxY}" on:wheel="{handleWheel}" on:mousedown="{dragStart}" on:mouseup="{dragEnd}" on:mouseleave="{dragEnd}" on:mousemove="{dragMouse}" on:click="{handleLeftClick}" on:contextmenu={handleRightClick}>
                <rect x="0" y="0" width="{maxX}" height="{maxY}" fill="black" opacity="{$userSettings.opacity !== undefined ? $userSettings.opacity : 1}" />
            <!-- Place interactive objects -->
            {#if ($currentState.state !== undefined) && ($currentState.state.objects !== undefined)}
                {#each $currentState.state.objects as obj}
                    {#if obj.objType === "ship"}
                        <use
                            id="ship_{obj.id}"
                            href="#{obj.id}"
                            x="{(obj.position.x * pixelsPerMU) - ((ship2mu(obj.object) * pixelsPerMU) / 2)}"
                            y="{(obj.position.y * pixelsPerMU) - ((ship2mu(obj.object) * pixelsPerMU) / 2)}"
                            width="{ship2mu(obj.object) * pixelsPerMU}"
                            height="{ship2mu(obj.object) * pixelsPerMU}"
                        />
                    {/if}
                {/each}
            {/if}
            {#if $beacon !== undefined}
                <circle id="_beacon" class="beacon" cx="{$beacon.x * pixelsPerMU}" cy="{$beacon.y * pixelsPerMU}" r="1" fill="white" opacity="0.5" />
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
    @keyframes beacon {
        from {
            r: 1;
        }
        50% {
            r: 100;
        }
        100% {
            r: 1;
        }
    }
    .beacon {
        animation-duration: 2s;
        animation-iteration-count: infinite;
        animation-name: beacon;
    }
</style>