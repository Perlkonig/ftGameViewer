<script lang="ts">
    import { afterUpdate, onMount } from "svelte";
    import { nanoid } from "nanoid";
    import { currentState } from "@/stores/derivedState";
    import type { FullThrustGameObjects } from "@/schemas/position";
    import { userSettings } from "@/stores/writeUserSettings";

    type Facing = 1|2|3|4|5|6|7|8|9|10|11|12;

    // Assumes incoming SVG is a <symbol> tag with a viewBox attribute and no ID attribute
    // If `object` is given, then nothing else passed matters, including `svg`
    export let object: FullThrustGameObjects = undefined;
    export let svg: string = undefined;
    export let size: number = 100;
    export let id: string = nanoid();
    export let colour: string = "#ffffff";
    export let facing: Facing = 12;
    export let speed: number = undefined;
    export let course: number = undefined;

    const prefix = nanoid(5);
    let origSvg: string;
    onMount(() => {
        if ( (object !== undefined) && (object.objType === "ship") ) {
            svg = object.svg;
            id = object.id;
            facing = object.facing;
            speed = object.speed;
            course = object.course;
            const owner = $currentState.state.players.find(p => p.id === object.owner);
            if (owner !== undefined) {
                colour = owner.colour;
            }
        }
        origSvg = svg;
    });

    let href = `${prefix}_counter`;
    const x1 = 65; const y1 = 65;
    let x2: number; let y2:number;
    afterUpdate(() => {
        if (svg !== undefined) {
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
        }
    });

    let markerColour = "#ffffff";
    $: if ($userSettings.opacity !== undefined) {
        if ($userSettings.opacity < 0.5) {
            markerColour = "#000000";
        } else {
            markerColour = "#ffffff";
        }
    }
</script>

{#if svg !== undefined}
<svg id="{id}" width="100%" height="100%" viewBox="-1 -1 {size + 2} {size + 2}">
    <defs>
        {@html svg}
    {#if course !== undefined}
        <marker id="{prefix}_arrow"
            viewBox="0 0 10 10" refX="0" refY="5"
            markerUnits="strokeWidth"
            markerWidth="4" markerHeight="3"
            fill="{markerColour}"
            orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
    {/if}
    {#if ( (speed !== undefined) || (course !== undefined) )}
        <symbol id="{prefix}_composite" viewBox="-1 -1 132 132">
            <use href="#{prefix}_counter" x="15" y="15" width="100" height="100" />
            <polygon points="60,20 70,20 65,0" fill="{markerColour}" />
        {#if speed !== undefined}
            <text x="75" y="0" stroke="{markerColour}" fill="{markerColour}" font-size="20px" text-anchor="start" alignment-baseline="hanging" dominant-baseline="hanging">{speed}</text>
        {/if}
        {#if course !== undefined}
            <line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{markerColour}" stroke-width="2" marker-end="url(#{prefix}_arrow)" />
        {/if}
        </symbol>
    {/if}
    </defs>
    <rect x="0" y="0" width="{size}" height="{size}" fill="black" opacity="{object === undefined ? 1 : 0}" />
    <use href="#{href}" x="0" y="0" width="{size}" height="{size}" transform="rotate({facing * 30} {size/2} {size/2})" />
</svg>
{/if}