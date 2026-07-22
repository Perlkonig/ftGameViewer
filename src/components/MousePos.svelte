<script lang="ts">
    import { mousePos } from "@/stores/writeMousePos";
    import { showTrajectories } from "@/stores/writeMapView";
    import { currentState } from "@/stores/derivedState";
    import { fluidMapBuffer } from "@/stores/writeBuffer";

    $: isFluidMap = $currentState.state?.map?.mode === "fluid";
</script>

<div class="level">
    <div class="level-left">
        {#if $mousePos !== undefined}
            <div class="level-item">
                <span class="bold">x:</span>&nbsp;{$mousePos.x}
            </div>
            <div class="level-item">
                <span class="bold">y:</span>&nbsp;{$mousePos.y}
            </div>
            <div class="level-item">
                <span class="bold">ID:</span>&nbsp;{$mousePos.id ?? ""}
            </div>
        {/if}
        {#if isFluidMap}
            <div class="level-item buffer-control">
                <label class="buffer-label" for="fluidBuffer">Buffer (MU)</label>
                <input
                    id="fluidBuffer"
                    class="buffer-slider"
                    type="range"
                    min="0"
                    max="48"
                    step="1"
                    bind:value={$fluidMapBuffer}
                />
                <span class="buffer-value">{$fluidMapBuffer}</span>
            </div>
        {/if}
        <div class="level-item">
            <label class="checkbox">
                <input
                    type="checkbox"
                    checked={$showTrajectories}
                    on:change={(e) =>
                        showTrajectories.set(e.currentTarget.checked)}
                />
                Show trajectories
            </label>
        </div>
    </div>
</div>

<style>
    .bold {
        font-weight: bolder;
    }

    .buffer-control {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        min-width: 12rem;
    }

    .buffer-label {
        font-weight: bolder;
        white-space: nowrap;
    }

    .buffer-slider {
        width: 8rem;
    }

    .buffer-value {
        min-width: 1.5rem;
        text-align: right;
    }
</style>
