<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { currentState } from "@/stores/derivedState";
    import { appendGameCommand } from "@/lib/game/appendCommand";
    import type { FullThrustGameCommand } from "@/schemas/commands";
    import { toast } from "@zerodevx/svelte-toast";
    import { gunboatGroupOptionLabel } from "@/lib/game/gunboatLabel";
    import { deployedGunboatsForOwner } from "@/lib/game/gunboatMove";
    import { validateDeclareGunboatAttack } from "@/lib/game/gunboatAttack";
    import { DEFAULT_META } from "@/lib/game/types";

    const dispatch = createEventDispatcher();

    $: playerId = $currentState.state?.players?.[0]?.id ?? "";
    $: gunboats = playerId
        ? deployedGunboatsForOwner($currentState.state!, playerId)
        : [];

    let groupId = "";
    let targetType: "ship" | "fighters" | "gunboats" | "ordnance" = "ship";
    let targetId = "";

    const submit = () => {
        const cmd = {
            name: "declareGunboatAttack",
            id: groupId,
            targetType,
            targetId,
        } as FullThrustGameCommand;
        const issues = validateDeclareGunboatAttack(
            {
                meta: $currentState.meta ?? DEFAULT_META(),
                position: $currentState.state!,
            },
            cmd
        );
        const err = issues.find((i) => i.severity === "error");
        if (err) {
            toast.push(err.message);
            return;
        }
        appendGameCommand(cmd);
        toast.push("Gunboat attack declared");
        dispatch("done");
    };
</script>

<h3 class="title is-6">Declare gunboat attack (12 MU)</h3>
<select bind:value={groupId}>
    <option value="">Squadron</option>
    {#each gunboats as g}
        <option value={g.id}>{gunboatGroupOptionLabel(g)}</option>
    {/each}
</select>
<select bind:value={targetType}>
    <option value="ship">Ship</option>
    <option value="fighters">Fighters</option>
    <option value="gunboats">Gunboats</option>
    <option value="ordnance">Ordnance</option>
</select>
<input class="input" placeholder="Target id" bind:value={targetId} />
<button class="button is-primary" on:click={submit}>Declare</button>
