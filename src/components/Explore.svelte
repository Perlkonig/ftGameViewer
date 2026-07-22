<script lang="ts">
    import { selectedObject } from "@/stores/writeSelectedObject";
    import { clickMode } from "@/stores/writeClickMode";
    import { currentState } from "@/stores/derivedState";
    import { onDestroy, onMount } from "svelte";
    import { parseObjectRef } from "@/lib/objectRef";
    import ObjectList from "@/components/ObjectList.svelte";
    import MeasurePanel from "./Explore/MeasurePanel.svelte";
    import Ship from "./Explore/Ship.svelte";
    import Gunboat from "./Explore/Gunboat.svelte";
    import { get } from "svelte/store";

    onMount(() => {
        if (get(clickMode) === undefined) {
            clickMode.set("select");
        }
    });

    onDestroy(() => {
        if (get(clickMode) === "select") {
            clickMode.set(undefined);
        }
        selectedObject.set(undefined);
    });

    $: ref = $selectedObject ? parseObjectRef($selectedObject) : undefined;
    $: objType = ref?.objType;
    $: objId = ref?.objId;
    $: selectedShip =
        objType === "ship" && objId
            ? $currentState.state?.objects?.find((o) => o.objType === "ship" && o.id === objId)
            : undefined;
</script>

<div class="explore-grid">
    <ObjectList />

    <MeasurePanel />

    {#if $selectedObject === undefined}
        <section class="explore-panel explore-panel--placeholder explore-panel--ssd">
            <p class="explore-panel__title">SSD</p>
            <p class="help">Select a ship on the map or from the list to view its SSD.</p>
        </section>
        <section class="explore-panel explore-panel--placeholder explore-panel--system">
            <p class="explore-panel__title">Selected system</p>
            <p class="help">Click a system on the SSD to inspect it.</p>
        </section>
    {:else if objType === "gunboats" && objId}
        {#key objId}
            <Gunboat gunboatId={objId} />
        {/key}
    {:else if objType !== "ship" || !objId}
        <section class="explore-panel explore-panel--placeholder explore-panel--ssd">
            <p class="explore-panel__title">SSD</p>
            <p class="help">Selected object is not a ship.</p>
        </section>
        <section class="explore-panel explore-panel--placeholder explore-panel--system">
            <p class="explore-panel__title">Selected system</p>
            <p class="help">Select a ship to view systems.</p>
        </section>
    {:else}
        {#key objId}
            <Ship shipId={objId} owner={selectedShip?.owner} />
        {/key}
    {/if}
</div>

<style>
    .explore-grid {
        display: grid;
        grid-template-columns: minmax(11rem, 0.9fr) minmax(12rem, 1fr) minmax(14rem, 1.1fr) minmax(
                12rem,
                1fr
            );
        gap: 1rem;
        align-items: start;
    }

    .explore-grid > :global(.explore-panel--ssd),
    .explore-grid > .explore-panel--ssd {
        grid-column: 3;
    }

    .explore-grid > :global(.explore-panel--system),
    .explore-grid > .explore-panel--system {
        grid-column: 4;
    }

    .explore-panel {
        min-width: 0;
        max-height: 70vh;
        overflow-y: auto;
        border: 1px solid #dbdbdb;
        border-radius: 4px;
        padding: 0.65rem;
        background: #fafafa;
    }

    .explore-panel__title {
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #7a7a7a;
        margin: 0 0 0.5rem;
    }

    @media (max-width: 1100px) {
        .explore-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .explore-grid > :global(.explore-panel--ssd),
        .explore-grid > .explore-panel--ssd,
        .explore-grid > :global(.explore-panel--system),
        .explore-grid > .explore-panel--system {
            grid-column: auto;
        }
    }
</style>
