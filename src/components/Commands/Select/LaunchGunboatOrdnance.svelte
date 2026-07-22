<script lang="ts">
    import { createEventDispatcher, onDestroy, onMount } from "svelte";
    import { currentState } from "@/stores/derivedState";
    import { clickMode } from "@/stores/writeClickMode";
    import { beacon } from "@/stores/writeBeacon";
    import { appendGameCommand } from "@/lib/game/appendCommand";
    import type { FullThrustGameCommand } from "@/schemas/commands";
    import { toast } from "@zerodevx/svelte-toast";
    import ActError from "./ActError.svelte";
    import { gunboatGroupOptionLabel } from "@/lib/game/gunboatLabel";
    import {
        deployedOrdnanceGunboats,
        gunboatOrdnanceType,
        validateLaunchGunboatOrdnance,
    } from "@/lib/game/gunboatOrdnanceLaunch";
    import { distance } from "@/lib/game/movement";
    import { GUNBOAT_ATTACK_RANGE_MU } from "@/lib/game/gunboatAttack";

    const dispatch = createEventDispatcher();

    let playerId = "";
    let squadronId = "";
    let targetShipId = "";

    $: players = $currentState.state?.players ?? [];
    $: phase = $currentState.meta?.phase ?? 1;

    $: gunboats =
        $currentState.state && playerId
            ? deployedOrdnanceGunboats($currentState.state, playerId)
            : [];

    $: selected = gunboats.find((g) => g.id === squadronId);

    $: enemyShips =
        $currentState.state?.objects?.filter((o) => {
            if (o.objType !== "ship" || !o.position) return false;
            if (!playerId) return true;
            return o.owner !== playerId;
        }) ?? [];

    $: actIssues =
        $currentState.state && squadronId && targetShipId
            ? validateLaunchGunboatOrdnance(
                  $currentState.state,
                  squadronId,
                  targetShipId,
                  phase
              )
            : [];

    $: canSubmit =
        !!squadronId &&
        !!targetShipId &&
        !actIssues.some((i) => i.severity === "error");

    const submit = () => {
        if (!selected || !targetShipId || !$currentState.state) {
            toast.push("Select squadron and target ship");
            return;
        }
        const pos =
            selected.position && typeof selected.position === "object" && "x" in selected.position
                ? { x: selected.position.x, y: selected.position.y }
                : $beacon
                  ? { x: $beacon.x, y: $beacon.y }
                  : undefined;
        if (!pos) {
            toast.push("Squadron needs a map position");
            return;
        }
        const ordType = gunboatOrdnanceType(selected);
        const cmd = {
            name: "launchGunboatOrdnance",
            id: squadronId,
            ordnanceType: ordType,
            targetId: targetShipId,
            position: pos,
            facing: selected.facing,
            enduranceCost: 1,
        } as FullThrustGameCommand;
        const issues = validateLaunchGunboatOrdnance(
            $currentState.state,
            squadronId,
            targetShipId,
            phase
        );
        const err = issues.find((i) => i.severity === "error");
        if (err) {
            toast.push(err.message);
            return;
        }
        appendGameCommand(cmd);
        toast.push("Gunboat ordnance launch recorded");
        dispatch("done");
    };

    onMount(() => clickMode.set("beacon"));
    onDestroy(() => clickMode.set(undefined));
</script>

<h3 class="title is-6">Launch gunboat ordnance (phase 3)</h3>
<p class="help">
    Missile, rocket, and plasma bomber squadrons launch within {GUNBOAT_ATTACK_RANGE_MU} MU of an
    enemy ship. Costs 1 squad endurance per launch action.
</p>

<div class="field">
    <label class="label" for="gb-ord-player">Player</label>
    <div class="select is-fullwidth">
        <select id="gb-ord-player" bind:value={playerId}>
            <option value="">-- select --</option>
            {#each players as p}
                <option value={p.id}>{p.id}</option>
            {/each}
        </select>
    </div>
</div>

{#if playerId}
    <div class="field">
        <label class="label" for="gb-ord-squad">Squadron</label>
        <div class="select is-fullwidth">
            <select id="gb-ord-squad" bind:value={squadronId}>
                <option value="">-- select --</option>
                {#each gunboats as g}
                    <option value={g.id}>
                        {gunboatGroupOptionLabel(g)} (end {g.endurance ?? 6})
                    </option>
                {/each}
            </select>
        </div>
    </div>
{/if}

{#if squadronId}
    <div class="field">
        <label class="label" for="gb-ord-target">Target ship</label>
        <div class="select is-fullwidth">
            <select id="gb-ord-target" bind:value={targetShipId}>
                <option value="">-- select --</option>
                {#each enemyShips as s}
                    <option value={s.id}>
                        {s.id}
                        {#if selected?.position && typeof selected.position === "object" && "x" in selected.position && s.position && typeof s.position === "object" && "x" in s.position}
                            ({distance(
                                selected.position as { x: number; y: number },
                                s.position as { x: number; y: number }
                            ).toFixed(1)} MU)
                        {/if}
                    </option>
                {/each}
            </select>
        </div>
    </div>
{/if}

<button class="button is-primary mt-3" disabled={!canSubmit} on:click={submit}>
    Launch ordnance
</button>

<ActError issues={actIssues} />
