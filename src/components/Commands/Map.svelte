<script lang="ts">
    import { initialState } from "@/stores/writeInitialState";

    let mode: "fixed"|"fluid" = "fixed";
    let width = 72;
    let height = 48;


    const handleClick = () => {
        if (mode === "fluid") {
            $initialState.map = {mode};
        } else {
            $initialState.map = {
                mode,
                width,
                height
            };
        }
        $initialState = $initialState
    }
</script>

<div class="content">
    <p>No game is currently loaded. Start by using the form below to define the game's map. Typically the map is not changed once the game starts.</p>
</div>
<div class="field">
    <div class="control">
        <label class="radio">
            <input type="radio" bind:group={mode} name="mode" value="fixed">
            Fixed
        </label>
        <label class="radio">
            <input type="radio" bind:group={mode} name="mode" value="fluid">
            Fluid
        </label>
    </div>
{#if mode === "fixed"}
    <p class="help">This map has fixed boundaries that you may not leave.</p>
{:else}
    <p class="help">This map changes size to accommodate all visible objects. You can also add a buffer using boxes above the map.</p>
{/if}
</div>

{#if mode === "fixed"}
<div class="columns">
    <div class="column">
        <div class="field">
            <label class="label" for="width">Width (in MUs)</label>
            <div class="control">
                <input class="input" type="number" name="width" bind:value={width} min="1" step="1">
            </div>
        </div>
    </div>
    <div class="column">
        <div class="field">
            <label class="label" for="height">Height (in MUs)</label>
            <div class="control">
                <input class="input" type="number" name="height" bind:value={height} min="1" step="1">
            </div>
        </div>
    </div>
</div>
{/if}
<div class="control">
    <button class="button is-primary" on:click={handleClick}>Save map settings</button>
</div>

<style></style>
