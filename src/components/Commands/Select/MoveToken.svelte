<script lang="ts">
    import { createEventDispatcher, onDestroy } from "svelte";
    import { currentState } from "@/stores/derivedState";
    import { clickMode } from "@/stores/writeClickMode";
    import { beacon } from "@/stores/writeBeacon";
    import { appendGameCommand } from "@/lib/game/appendCommand";
    import type { FullThrustGameCommand } from "@/schemas/commands";
    import { toast } from "@zerodevx/svelte-toast";
    import { validateMoveFighters } from "@/lib/game/commandValidation";
    import ActError from "./ActError.svelte";
    import { focusMapOnObjectId } from "@/lib/actMapInteraction";

    export let mode: "fighters" | "ordnance" = "fighters";
    export let secondary = false;

    const dispatch = createEventDispatcher();

    $: objects =
        $currentState.state?.objects?.filter((o) =>
            mode === "fighters" ? o.objType === "fighters" : o.objType === "ordnance"
        ) ?? [];

    let id = "";
    let prevId = "";
    $clickMode = "beacon";
    onDestroy(() => {
        $clickMode = undefined;
        $beacon = undefined;
    });

    $: selectedObj = objects.find((o) => o.id === id);
    $: if (id && id !== prevId) {
        prevId = id;
        focusMapOnObjectId(
            id,
            objects as import("@/schemas/position").FullThrustGameObjects[],
            { objType: mode }
        );
    }
    $: actIssues =
        mode === "fighters" &&
        selectedObj &&
        $beacon &&
        selectedObj.position &&
        typeof selectedObj.position === "object" &&
        "x" in selectedObj.position
            ? validateMoveFighters(
                  selectedObj.position as { x: number; y: number },
                  $beacon,
                  secondary,
                  (selectedObj as { endurance?: number }).endurance
              )
            : [];

    const submit = () => {
        const obj = objects.find((o) => o.id === id);
        if (!obj || !$beacon) {
            toast.push("Select object and click destination");
            return;
        }
        const from = obj.position as { x: number; y: number } | undefined;
        if (mode === "fighters" && from && "x" in from) {
            const dist = Math.hypot($beacon.x - from.x, $beacon.y - from.y);
            const dest = appendGameCommand({
                name: "moveFighters",
                id,
                position: { x: $beacon.x, y: $beacon.y },
                distanceMu: dist,
                vectors: [from, $beacon],
            } as FullThrustGameCommand);
            toast.push(dest === "master" ? "Fighters moved" : "Move added to proposals");
        } else {
            const dest = appendGameCommand({
                name: "moveOrdnance",
                id,
                position: { x: $beacon.x, y: $beacon.y },
            } as FullThrustGameCommand);
            toast.push(dest === "master" ? "Ordnance moved" : "Move added to proposals");
        }
        dispatch("done");
    };
</script>

<div class="field">
    <label class="label" for="obj">Object</label>
    <div class="select">
        <select id="obj" bind:value={id}>
            <option value="">-- select --</option>
            {#each objects as o}
                <option value={o.id}>{o.id} ({o.objType})</option>
            {/each}
        </select>
    </div>
</div>
{#if mode === "fighters"}
    <label class="checkbox">
        <input type="checkbox" bind:checked={secondary} />
        Secondary move (costs endurance)
    </label>
{/if}
<p class="help">
    Click map destination
    {#if $beacon}({$beacon.x.toFixed(2)}, {$beacon.y.toFixed(2)}){/if}
</p>
<button class="button is-primary" on:click={submit}>
    Move
</button>
{#if mode === "fighters"}
    <ActError issues={actIssues} />
{/if}
