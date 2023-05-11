<script lang="ts">
    import { onMount } from 'svelte';
    // import { nanoid } from "nanoid";
    import { tweened } from "svelte/motion";
    import { sineOut } from 'svelte/easing';
    import { mousePos } from "@/stores/writeMousePos";
    import { beacon } from '@/stores/writeBeacon';

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
        $mousePos = {x: 0, y: 0};
        currX.set(0);
        currY.set(0);
        currWidth.set(maxX);
        currHeight.set(maxY);
    });

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

        $beacon = { x: currMouse.x, y: currMouse.y};
    }

    const handleRightClick = (e: MouseEvent) => {
        e.preventDefault();
        $beacon = undefined;
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
            </defs>

            <!-- Position the rulers -->
            <use href="#xRuler" x="{rulerWidth + rulerGap}" y="0" height="{rulerWidth}" width="{maxX}" />
            <use href="#xRuler" x="0" y="0" height="{rulerWidth}" width="{maxX}" transform="scale(1,-1) translate({rulerWidth + rulerGap}, -{(rulerWidth * 2) + (rulerGap * 2) + maxY})"/>
            <use href="#yRuler" x="0" y="0" height="{rulerWidth}" width="{maxY}" transform="translate(0, {rulerWidth + rulerGap + maxY}) rotate(-90) scale(-1,1) translate(-{maxY}, 0)" />
            <use href="#yRuler" x="0" y="0" height="{rulerWidth}" width="{maxY}" transform="rotate(90) translate({rulerWidth + rulerGap}, -{(rulerWidth * 2) + (rulerGap * 2) + maxX})"/>

            <!-- And here's the map -->
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <svg bind:this="{innerSvg}" viewBox="{$currX} {$currY} {$currWidth} {$currHeight}" x="{rulerWidth + rulerGap}" y="{rulerWidth + rulerGap}" width="{maxX}" height="{maxY}" on:wheel="{handleWheel}" on:mousedown="{dragStart}" on:mouseup="{dragEnd}" on:mouseleave="{dragEnd}" on:mousemove="{dragMouse}" on:click="{handleLeftClick}" on:contextmenu={handleRightClick}>
                <rect id="_background" x="0" y="0" width="{maxX}" height="{maxY}" fill="black" />
            {#if $beacon !== undefined}
                <circle id="_beacon" class="beacon" cx="{$beacon.x}" cy="{$beacon.y}" r="1" fill="white" opacity="0.5" />
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