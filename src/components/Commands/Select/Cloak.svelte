<script lang="ts">
    import { createEventDispatcher, onDestroy } from "svelte";
    import { currentState } from "@/stores/derivedState";
    import { clickMode } from "@/stores/writeClickMode";
    import { beacon } from "@/stores/writeBeacon";
    import { appendGameCommand } from "@/lib/game/appendCommand";
    import type { FullThrustGameCommand } from "@/schemas/commands";
    import { toast } from "@zerodevx/svelte-toast";
    import { focusMapOnShipId } from "@/lib/actMapInteraction";

    const dispatch = createEventDispatcher();

    $: ships = $currentState.state?.objects?.filter((o) => o.objType === "ship") ?? [];

    let shipId = "";
    let mode: "hide" | "uncloak" = "hide";
    let prevShipId = "";

    $: if (shipId && shipId !== prevShipId) {
        prevShipId = shipId;
        focusMapOnShipId(shipId, ships as import("@/schemas/position").FullThrustGameObjects[]);
    }

    $: if (mode === "uncloak") {
        $clickMode = "beacon";
    } else {
        $clickMode = undefined;
        $beacon = undefined;
    }

    onDestroy(() => {
        $clickMode = undefined;
        $beacon = undefined;
    });

    const submit = () => {
        if (!shipId) {
            toast.push("Select ship");
            return;
        }
        if (mode === "hide") {
            appendGameCommand({
                name: "objHide",
                uuid: shipId,
            } as FullThrustGameCommand);
            toast.push("Ship cloaked (hidden)");
        } else {
            if (!$beacon) {
                toast.push("Click map for uncloak position");
                return;
            }
            const ship = ships.find((s) => s.id === shipId);
            appendGameCommand({
                name: "moveShip",
                id: shipId,
                position: { x: $beacon.x, y: $beacon.y },
                facing: ship?.facing ?? 12,
                speed: ship?.speed ?? 0,
            } as FullThrustGameCommand);
            toast.push("Ship uncloaked");
        }
        dispatch("done");
    };
</script>

<div class="field">
    <label class="label">Action</label>
    <label class="radio"><input type="radio" bind:group={mode} value="hide" /> Cloak (hide)</label>
    <label class="radio"><input type="radio" bind:group={mode} value="uncloak" /> Uncloak</label>
</div>
<div class="field">
    <label class="label" for="ship">Ship</label>
    <div class="select">
        <select id="ship" bind:value={shipId}>
            <option value="">--</option>
            {#each ships as s}
                <option value={s.id}>{s.id}{s.position == null ? " (hidden)" : ""}</option>
            {/each}
        </select>
    </div>
</div>
{#if mode === "uncloak"}
    <p class="help">
        Click map for reveal position
        {#if $beacon}({$beacon.x.toFixed(2)}, {$beacon.y.toFixed(2)}){/if}
    </p>
{/if}
<button class="button is-primary" on:click={submit}>Apply</button>
