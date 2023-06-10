<script lang="ts">
    import { selectedObject } from "@/stores/writeSelectedObject";
    import { clickMode } from "@/stores/writeClickMode";
    import { onDestroy, afterUpdate } from "svelte";
    import { currentState } from "@/stores/derivedState";
    import type { Position } from "@/schemas/position";
    import { annotations, type ILine } from "@/stores/writeAnnotations";

    $clickMode = "select";

    let anchorType: string;
    let anchorId: string;
    let compType: string;
    let compId: string;
    let distance: number|undefined;
    let mode: "anchor"|"comp" = "anchor";

    const calcDistance = () => {
        if ( (anchorId !== undefined) && (compId !== undefined) ) {
            let x1: number;
            let y1: number;
            if (anchorType === "ship") {
                const found = $currentState.state.objects.find(o => o.objType === "ship" && o.id === anchorId);
                if (found === undefined) {
                    throw new Error(`Could not find a ship with ID '${anchorId}'`);
                }
                x1 = (found.position as Position).x;
                y1 = (found.position as Position).y;
            } else {
                throw new Error(`Unrecognized anchor type '${anchorType}'`);
            }
            let x2: number;
            let y2: number;
            if (compType === "ship") {
                const found = $currentState.state.objects.find(o => o.objType === "ship" && o.id === compId);
                if (found === undefined) {
                    throw new Error(`Could not find a ship with ID '${compId}'`);
                }
                x2 = (found.position as Position).x;
                y2 = (found.position as Position).y;
            } else {
                throw new Error(`Unrecognized anchor type '${anchorType}'`);
            }
            distance = Math.sqrt(((x1 - x2) ** 2) + ((y1 - y2) ** 2));
            // delete any preexisting line
            const idx = $annotations.findIndex(n => n.id === "_distance");
            if (idx !== -1) {
                $annotations.splice(idx, 1);
            }
            $annotations.push({
                type: "LINE",
                id: "_distance",
                note: {
                    p1: {x: x1, y: y1},
                    p2: {x: x2, y: y2},
                } as ILine
            });
            $annotations = $annotations;
        } else {
            distance = undefined;
        }
    }

    const handleSelect = (id: string) => {
        if (id !== undefined) {
            if (mode === "anchor") {
                [anchorType, anchorId] = id.split("_", 2);
                mode = "comp";
            } else {
                [compType, compId] = id.split("_", 2);
                calcDistance();
            }
        }
    }

    const unsub = selectedObject.subscribe(handleSelect);

    const resetAnchor = () => {
        // delete any preexisting line
        const idx = $annotations.findIndex(n => n.id === "_distance");
        if (idx !== -1) {
            $annotations.splice(idx, 1);
            $annotations = $annotations;
        }
        anchorType = undefined;
        anchorId = undefined;
        compType = undefined;
        compId = undefined;
        $selectedObject = undefined;
        mode = "anchor";
    }

    onDestroy(() => {
        // delete any preexisting line
        const idx = $annotations.findIndex(n => n.id === "_distance");
        if (idx !== -1) {
            $annotations.splice(idx, 1);
            $annotations = $annotations;
        }
        $clickMode = undefined;
        $selectedObject = undefined;
        unsub();
    });
</script>

{#if anchorId === undefined}
    <p>Select an object as your anchor point.</p>
{:else}
    <p>Anchor: {anchorId} ({anchorType})</p>
    <button class="button" on:click={resetAnchor}>Reset Anchor</button>
    <p>Select another object to show the distance between.</p>
    {#if compId !== undefined}
        <p>Comparator: {compId} ({compType})</p>
        <p>Distance: {distance} MU</p>
    {/if}
{/if}
