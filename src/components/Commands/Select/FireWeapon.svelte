<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { currentState } from "@/stores/derivedState";
    import { shipCanFire } from "@/lib/game/activation";
    import type { ShipGameState } from "@/lib/game/shipSystems";
    import ShipFireDeclare from "./ShipFireDeclare.svelte";

    const dispatch = createEventDispatcher();

    $: allShips =
        $currentState.state?.objects?.filter((o) => o.objType === "ship" && o.position) ?? [];
    $: players = $currentState.state?.players ?? [];

    let selectedOwner = "";
    $: if (players.length && !selectedOwner) {
        selectedOwner = players[0].id;
    }

    $: declareShips = allShips.filter((o) => {
        if (!shipCanFire(o as ShipGameState)) return false;
        if (selectedOwner && o.owner !== selectedOwner) return false;
        return true;
    });
</script>

<ShipFireDeclare
    ships={declareShips}
    bind:selectedOwner
    on:done={() => dispatch("done")}
/>
