<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { currentState } from "@/stores/derivedState";
    import { appendGameCommand } from "@/lib/game/appendCommand";
    import type { FullThrustGameCommand } from "@/schemas/commands";
    import { toast } from "@zerodevx/svelte-toast";
    import {
        focusMapOnObjectId,
        focusMapOnShipId,
    } from "@/lib/actMapInteraction";

    const dispatch = createEventDispatcher();

    $: ships =
        $currentState.state?.objects?.filter((o) => o.objType === "ship" && o.position) ??
        [];
    $: fighters =
        $currentState.state?.objects?.filter((o) => o.objType === "fighters") ?? [];
    $: ordnance =
        $currentState.state?.objects?.filter((o) => o.objType === "ordnance") ?? [];

    let attackerId = "";
    let targetId = "";
    let note = "";
    let prevAttackerId = "";
    let prevTargetId = "";

    $: mapObjects = ($currentState.state?.objects ?? []) as import("@/schemas/position").FullThrustGameObjects[];

    $: if (attackerId && attackerId !== prevAttackerId) {
        prevAttackerId = attackerId;
        focusMapOnObjectId(attackerId, mapObjects);
    }
    $: if (targetId && targetId !== prevTargetId) {
        prevTargetId = targetId;
        focusMapOnShipId(targetId, mapObjects);
    }

    const submit = () => {
        if (!attackerId || !targetId) {
            toast.push("Select attacker and target");
            return;
        }
        const msg =
            note.trim() ||
            `Declare attack: ${attackerId} → ship ${targetId}`;
        appendGameCommand({
            name: "_custom",
            msg,
        } as FullThrustGameCommand);
        toast.push("Attack declaration logged");
        dispatch("done");
    };
</script>

<p class="help">
    Phase 6 helper: log which ordnance/fighter group is allocated against which ship. Reposition
    tokens with Move fighters/ordnance first if needed.
</p>

<div class="field">
    <label class="label" for="att">Attacker</label>
    <div class="select">
        <select id="att" bind:value={attackerId}>
            <option value="">--</option>
            {#each fighters as f}
                <option value={f.id}>fighters {f.id}</option>
            {/each}
            {#each ordnance as o}
                <option value={o.id}>ordnance {o.id}</option>
            {/each}
        </select>
    </div>
</div>
<div class="field">
    <label class="label" for="tgt">Target ship</label>
    <div class="select">
        <select id="tgt" bind:value={targetId}>
            <option value="">--</option>
            {#each ships as s}
                <option value={s.id}>{s.id}</option>
            {/each}
        </select>
    </div>
</div>
<div class="field">
    <label class="label" for="note">Optional note</label>
    <input id="note" class="input" bind:value={note} />
</div>
<button class="button is-primary" on:click={submit}>Log declaration</button>
