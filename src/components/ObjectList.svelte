<script lang="ts">
    import { selectObject, selectedObject } from "@/stores/writeSelectedObject";
    import { currentState } from "@/stores/derivedState";
    import { mapViewport, focusMapOnPoint } from "@/stores/writeMapView";
    import { listExploreObjects, type ExploreListScope } from "@/lib/exploreObjects";
    import { listPendingLayMineExploreEntries } from "@/lib/pendingMineMarkers";

    let listScope: ExploreListScope = "all";

    $: listedObjects = [
        ...listExploreObjects(
            $currentState.state?.objects,
            $currentState.state?.players?.map((p) => p.id) ?? [],
            {
                scope: listScope,
                viewport: $mapViewport,
            }
        ),
        ...listPendingLayMineExploreEntries(
            $currentState.pendingLayMines,
            $currentState.state
        ).filter((entry) => {
            if (listScope !== "visible" || !$mapViewport) return true;
            const { x, y } = entry.position;
            return (
                x >= $mapViewport.minX &&
                x <= $mapViewport.maxX &&
                y >= $mapViewport.minY &&
                y <= $mapViewport.maxY
            );
        }),
    ];
    $: playerColours = new Map(
        ($currentState.state?.players ?? []).map((p) => [p.id, p.colour])
    );

    const selectFromList = (key: string, x: number, y: number) => {
        selectObject(key);
        focusMapOnPoint(x, y, 24);
    };
</script>

<aside class="object-list" aria-label="Map objects">
    <div class="object-list__header">
        <p class="object-list__title">Objects</p>
        <div class="object-list__toggle" role="group" aria-label="List scope">
            <label class="object-list__toggle-option">
                <input type="radio" bind:group={listScope} value="all" />
                All
            </label>
            <label class="object-list__toggle-option">
                <input type="radio" bind:group={listScope} value="visible" />
                Visible
            </label>
        </div>
    </div>
    {#if listedObjects.length === 0}
        <p class="help">
            {listScope === "visible"
                ? "No objects in the current map view."
                : "No objects on the map."}
        </p>
    {:else}
        <ul class="object-list__items">
            {#each listedObjects as entry (entry.key)}
                <li>
                    <button
                        type="button"
                        class="object-list__item"
                        class:is-selected={$selectedObject === entry.key}
                        on:click={() => selectFromList(entry.key, entry.position.x, entry.position.y)}
                    >
                        <span
                            class="object-list__swatch"
                            style:background={entry.owner
                                ? (playerColours.get(entry.owner) ?? "#999")
                                : "#999"}
                            title={entry.owner ?? "Unowned"}
                        ></span>
                        <span class="object-list__text">
                            <span class="object-list__label">{entry.label}</span>
                            <span class="object-list__detail">{entry.detail}</span>
                            <span class="object-list__motion">{entry.motionLine}</span>
                        </span>
                    </button>
                </li>
            {/each}
        </ul>
    {/if}
</aside>

<style>
    .object-list {
        min-width: 0;
        max-height: 70vh;
        overflow-y: auto;
        position: sticky;
        top: 0.75rem;
        border: 1px solid #dbdbdb;
        border-radius: 4px;
        padding: 0.65rem;
        background: #fafafa;
    }

    .object-list__header {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        margin-bottom: 0.5rem;
    }

    .object-list__title {
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #7a7a7a;
        margin: 0;
    }

    .object-list__toggle {
        display: flex;
        gap: 0.35rem;
    }

    .object-list__toggle-option {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.25rem;
        font-size: 0.75rem;
        padding: 0.2rem 0.35rem;
        border: 1px solid #dbdbdb;
        border-radius: 4px;
        background: #fff;
        cursor: pointer;
        user-select: none;
    }

    .object-list__toggle-option:has(input:checked) {
        border-color: #3273dc;
        background: #f0f5ff;
        font-weight: 600;
    }

    .object-list__toggle-option input {
        margin: 0;
    }

    .object-list__items {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
    }

    .object-list__item {
        display: flex;
        align-items: flex-start;
        gap: 0.5rem;
        width: 100%;
        padding: 0.45rem 0.5rem;
        border: 1px solid #dbdbdb;
        border-radius: 4px;
        background: #fff;
        text-align: left;
        cursor: pointer;
    }

    .object-list__item:hover {
        border-color: #b5b5b5;
        background: #f5f5f5;
    }

    .object-list__item.is-selected {
        border-color: #3273dc;
        background: #f0f5ff;
    }

    .object-list__swatch {
        flex-shrink: 0;
        width: 0.75rem;
        height: 0.75rem;
        border-radius: 2px;
        margin-top: 0.15rem;
        border: 1px solid rgba(10, 10, 10, 0.15);
    }

    .object-list__text {
        display: flex;
        flex-direction: column;
        min-width: 0;
    }

    .object-list__label {
        font-size: 0.875rem;
        font-weight: 600;
        word-break: break-word;
    }

    .object-list__detail {
        font-size: 0.75rem;
        color: #7a7a7a;
    }

    .object-list__motion {
        font-size: 0.7rem;
        color: #5a5a5a;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
</style>
