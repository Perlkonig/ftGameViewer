<script lang="ts">
    import { nanoid } from "nanoid";
    import { currentState } from "@/stores/derivedState";
    import type { FullThrustGameObjects } from "@/schemas/position";
    import { userSettings } from "@/stores/writeUserSettings";
    import { facingToCourse } from "@/lib/game/coords";

    type Facing = 1|2|3|4|5|6|7|8|9|10|11|12;

    // Assumes incoming SVG is a <symbol> tag with a viewBox attribute and no ID attribute
    // If `object` is given, then nothing else passed matters, including `svg`
    export let object: FullThrustGameObjects | undefined = undefined;
    export let svg: string | undefined = undefined;
    export let size: number = 100;
    export let id: string = nanoid();
    export let colour: string = "#ffffff";
    export let facing: Facing = 12;
    export let speed: number | undefined = undefined;
    export let course: number | undefined = undefined;

    type ShipObject = Extract<FullThrustGameObjects, { objType: "ship" }>;

    const prefix = nanoid(5);

    $: ship = object?.objType === "ship" ? (object as ShipObject) : undefined;
    $: sourceSvg = ship?.svg ?? svg;
    $: displayId = ship?.id ?? id;
    $: displayFacing = (ship?.facing ?? facing) as Facing;
    $: displaySpeed = ship?.speed ?? speed;
    $: displayCourse = ship?.course ?? course;
    $: displayColour =
        ship !== undefined
            ? ($currentState.state?.players?.find((p) => p.id === ship.owner)?.colour ??
              colour)
            : colour;

    $: processedSvg =
        sourceSvg !== undefined
            ? sourceSvg
                  .replace(`<symbol `, `<symbol id="${prefix}_counter" `)
                  .replaceAll(`#030303`, displayColour)
            : undefined;

    $: showVelocity =
        displayCourse !== undefined ||
        (displaySpeed !== undefined && displaySpeed > 0);
    $: velocityDeg =
        displayCourse !== undefined
            ? displayCourse - facingToCourse(displayFacing)
            : displaySpeed !== undefined && displaySpeed > 0
              ? 0
              : undefined;
    $: href = showVelocity ? `${prefix}_composite` : `${prefix}_counter`;

    const x1 = 65;
    const y1 = 65;
    $: velocityLine =
        velocityDeg !== undefined
            ? (() => {
                  const rel = (velocityDeg * Math.PI) / 180;
                  const len = 60;
                  return {
                      x2: x1 + len * Math.sin(rel),
                      y2: y1 - len * Math.cos(rel),
                  };
              })()
            : undefined;

    let markerColour = "#ffffff";
    $: if ($userSettings.opacity !== undefined) {
        if ($userSettings.opacity < 0.5) {
            markerColour = "#000000";
        } else {
            markerColour = "#ffffff";
        }
    }
</script>

{#if processedSvg !== undefined}
<svg id="{displayId}" width="100%" height="100%" viewBox="-1 -1 {size + 2} {size + 2}">
    <defs>
        {@html processedSvg}
    {#if velocityDeg !== undefined}
        <marker id="{prefix}_arrow"
            viewBox="0 0 10 10" refX="0" refY="5"
            markerUnits="strokeWidth"
            markerWidth="4" markerHeight="3"
            fill="{markerColour}"
            orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
    {/if}
    {#if showVelocity}
        <symbol id="{prefix}_composite" viewBox="-1 -1 132 132">
            <use href="#{prefix}_counter" x="15" y="15" width="100" height="100" />
            <polygon points="60,20 70,20 65,0" fill="{markerColour}" />
        {#if displaySpeed !== undefined}
            <text x="75" y="0" stroke="{markerColour}" fill="{markerColour}" font-size="20px" text-anchor="start" alignment-baseline="hanging" dominant-baseline="hanging">{displaySpeed}</text>
        {/if}
        {#if velocityLine !== undefined}
            <line x1="{x1}" y1="{y1}" x2="{velocityLine.x2}" y2="{velocityLine.y2}" stroke="{markerColour}" stroke-width="2" marker-end="url(#{prefix}_arrow)" />
        {/if}
        </symbol>
    {/if}
    </defs>
    <rect x="0" y="0" width="{size}" height="{size}" fill="black" opacity="{object === undefined ? 1 : 0}" />
    <use href="#{href}" x="0" y="0" width="{size}" height="{size}" transform="rotate({(displayFacing - 12) * 30} {size/2} {size/2})" />
</svg>
{/if}
