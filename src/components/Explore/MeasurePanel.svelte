<script lang="ts">
    import { selectedObject } from "@/stores/writeSelectedObject";
    import { currentState } from "@/stores/derivedState";
    import type { Position } from "@/schemas/position";
    import { annotations, type ILine } from "@/stores/writeAnnotations";
    import { parseObjectRef } from "@/lib/objectRef";
    import { distance as muDistance } from "@/lib/game/movement";
    import { onDestroy } from "svelte";

    let anchorType: string | undefined;
    let anchorId: string | undefined;
    let compType: string | undefined;
    let compId: string | undefined;
    let measuredDistance: number | undefined;
    let mode: "anchor" | "comp" = "anchor";
    let templateRange = 12;
    let showTemplate = false;

    const getPos = (objId: string | undefined): Position | undefined => {
        const objects = $currentState.state?.objects;
        if (!objId || !objects) return undefined;
        const found = objects.find((o) => o.id === objId);
        if (!found || found.position == null || !("x" in found.position)) return undefined;
        return found.position as Position;
    };

    const calcDistance = () => {
        const a = getPos(anchorId);
        const b = getPos(compId);
        if (!a || !b) {
            measuredDistance = undefined;
            return;
        }
        measuredDistance = muDistance(a, b);
        const idx = $annotations.findIndex((n) => n.id === "_distance");
        if (idx !== -1) $annotations.splice(idx, 1);
        $annotations.push({
            type: "LINE",
            id: "_distance",
            note: { p1: a, p2: b } as ILine,
        });
        $annotations = $annotations;
        refreshTemplate();
    };

    const refreshTemplate = () => {
        $annotations = $annotations.filter((n) => !n.id.startsWith("_template"));
        if (!showTemplate || !anchorId) {
            $annotations = $annotations;
            return;
        }
        const a = getPos(anchorId);
        if (!a) return;
        for (const r of [templateRange, templateRange * 2, templateRange * 3].filter((x) => x > 0)) {
            $annotations.push({
                type: "CIRCLE",
                id: `_template_${r}`,
                note: { c: a, r },
                opacity: 0.12,
                strokeWidth: 2,
            });
        }
        $annotations = $annotations;
    };

    const handleSelect = (id: string | undefined) => {
        if (id === undefined) return;
        const ref = parseObjectRef(id);
        if (!ref) return;
        if (mode === "anchor") {
            anchorType = ref.objType;
            anchorId = ref.objId;
            mode = "comp";
            refreshTemplate();
        } else {
            compType = ref.objType;
            compId = ref.objId;
            calcDistance();
        }
    };

    const unsub = selectedObject.subscribe(handleSelect);

    const resetAnchor = () => {
        $annotations = $annotations.filter(
            (n) => n.id !== "_distance" && !n.id.startsWith("_template")
        );
        anchorType = undefined;
        anchorId = undefined;
        compType = undefined;
        compId = undefined;
        measuredDistance = undefined;
        selectedObject.set(undefined);
        mode = "anchor";
    };

    onDestroy(() => {
        $annotations = $annotations.filter(
            (n) => n.id !== "_distance" && !n.id.startsWith("_template")
        );
        unsub();
    });
</script>

<section class="measure-panel" aria-label="Distance measurement">
    <p class="measure-panel__title">Measure</p>

    {#if anchorId === undefined}
        <p class="help">Select an object as your anchor point (ships, fighters, or ordnance).</p>
    {:else}
        <p>Anchor: {anchorId} ({anchorType})</p>
        <button class="button is-small" on:click={resetAnchor}>Reset anchor</button>
        <p class="help">Select another object to show the distance between.</p>
        {#if compId !== undefined}
            <p>Comparator: {compId} ({compType})</p>
            <p>
                <strong>Distance:</strong>
                {measuredDistance !== undefined ? measuredDistance.toFixed(2) : "?"} MU
            </p>
        {/if}
    {/if}

    <hr />
    <label class="checkbox">
        <input type="checkbox" bind:checked={showTemplate} on:change={refreshTemplate} />
        Show range-band template from anchor
    </label>
    <div class="field">
        <label class="label is-small" for="tr">Band width (MU)</label>
        <input
            id="tr"
            class="input is-small"
            type="number"
            min="1"
            bind:value={templateRange}
            on:change={refreshTemplate}
        />
        <p class="help">Draws circles at 1×, 2×, and 3× band width (beam bands are typically 12 MU).</p>
    </div>
</section>

<style>
    .measure-panel {
        min-width: 0;
        max-height: 70vh;
        overflow-y: auto;
        border: 1px solid #dbdbdb;
        border-radius: 4px;
        padding: 0.65rem;
        background: #fafafa;
    }

    .measure-panel__title {
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #7a7a7a;
        margin: 0 0 0.5rem;
    }

    .measure-panel hr {
        margin: 0.75rem 0;
    }
</style>
