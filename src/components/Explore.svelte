<script lang="ts">
    import { selectedObject } from "@/stores/writeSelectedObject";
    import { clickMode } from "@/stores/writeClickMode";
    import { onDestroy, afterUpdate } from "svelte";
    import Ship from "./Explore/Ship.svelte";

    $clickMode = "select";

    onDestroy(() => {
        $clickMode = undefined;
        $selectedObject = undefined;
    });

    let objType: string;
    let objId: string;
    afterUpdate(() => {
        if ($selectedObject !== undefined) {
            [objType, objId] = $selectedObject.split("_", 2);
        }
    });
</script>

{#key objId}
{#if $selectedObject !== undefined}
    {#if objType === "ship"}
        <Ship
            shipId={objId}
        />
    {/if}
{/if}
{/key}
