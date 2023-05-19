<script lang="ts">
    import type { RenderOpts } from "ftlibship";
    import { renderSvg, validate } from "ftlibship";
    import { afterUpdate, onMount } from "svelte";
    import { toast } from "@zerodevx/svelte-toast";
    import { nanoid } from "nanoid";

    type Facing = 1|2|3|4|5|6|7|8|9|10|11|12;

    // Assumes incoming SVG is a <symbol> tag with a viewBox attribute and no ID attribute
    export let svg: string;
    export let size: number = 100;
    export let id: string = nanoid();
    export let colour: string = "#ffffff";
    export let facing: Facing = 12;
    export let speed: number = undefined;
    export let course: number = undefined;

    const prefix = nanoid(5);
    let origSvg: string;
    onMount(() => {
        origSvg = svg;
    });

    let href = `${prefix}_counter`;
    const x1 = 65; const y1 = 65;
    let x2: number; let y2:number;
    afterUpdate(() => {
        svg = origSvg.replace(`<symbol `, `<symbol id="${prefix}_counter" `);
        if (colour !== undefined) {
            svg = svg.replaceAll(`#030303`, colour);
        }
        if ( (speed !== undefined) || (course !== undefined) ) {
            href = `${prefix}_composite`;
        }
        if (course !== undefined) {
            const angle = ((course * -1) - (facing * 30)) * (Math.PI / 180);
            x2 = x1 + (60 * Math.cos(angle));
            y2 = y1 + (60 * Math.sin(angle));
        }
    });
</script>

<svg id="{id}" width="100%" height="100%" viewBox="-1 -1 {size + 2} {size + 2}">
    <defs>
        {@html svg}
    {#if course !== undefined}
        <marker id="{prefix}_arrow"
            viewBox="0 0 10 10" refX="0" refY="5"
            markerUnits="strokeWidth"
            markerWidth="4" markerHeight="3"
            fill="white"
            orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
    {/if}
    {#if ( (speed !== undefined) || (course !== undefined) )}
        <symbol id="{prefix}_composite" viewBox="-1 -1 132 132">
            <use href="#{prefix}_counter" x="15" y="15" width="100" height="100" />
            <polygon points="60,20 70,20 65,0" fill="white" />
        {#if speed !== undefined}
            <text x="75" y="0" stroke="white" fill="white" font-size="20px" text-anchor="start" alignment-baseline="hanging" dominant-baseline="hanging">{speed}</text>
        {/if}
        {#if course !== undefined}
            <line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="white" stroke-width="2" marker-end="url(#{prefix}_arrow)" />
        {/if}
        </symbol>
    {/if}
    </defs>
    <rect x="0" y="0" width="{size}" height="{size}" fill="black" />
    <use href="#{href}" x="0" y="0" width="{size}" height="{size}" transform="rotate({facing * 30} {size/2} {size/2})" />
</svg>
