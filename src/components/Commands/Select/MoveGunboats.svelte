<script lang="ts">
    import { createEventDispatcher, onDestroy, onMount } from "svelte";
    import { currentState } from "@/stores/derivedState";
    import { commands } from "@/stores/writeCommands";
    import { headOffset } from "@/stores/writeHeadOffset";
    import { clickMode } from "@/stores/writeClickMode";
    import { beacon } from "@/stores/writeBeacon";
    import { annotations, type IAnnotation } from "@/stores/writeAnnotations";
    import { selectedObject } from "@/stores/writeSelectedObject";
    import { focusMapOnObjectId } from "@/lib/actMapInteraction";
    import { appendGameCommand } from "@/lib/game/appendCommand";
    import type { FullThrustGameCommand } from "@/schemas/commands";
    import { toast } from "@zerodevx/svelte-toast";
    import ActError from "./ActError.svelte";
    import Clock from "@/assets/clock.svg.svelte";
    import { distance } from "@/lib/game/movement";
    import {
        deployedGunboatsForOwner,
        gunboatMoveAllowanceMu,
        validateMoveGunboatsCommand,
    } from "@/lib/game/gunboatMove";
    import { parseObjectRef } from "@/lib/objectRef";
    import { DEFAULT_META } from "@/lib/game/types";
    import type { FoldState } from "@/lib/game/applyCommand";
    import type { GamePhase } from "@/lib/game/types";
    import { gunboatGroupOptionLabel } from "@/lib/game/gunboatLabel";

    type Facing = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

    const dispatch = createEventDispatcher();

    $: phase = ($currentState.meta?.phase ?? 1) as GamePhase;
    $: players = $currentState.state?.players ?? [];
    $: visibleCommands = $commands.slice(0, Math.max(0, $commands.length - $headOffset));

    let playerId = "";
    let groupId = "";
    let facing: Facing = 12;

    $: fold = {
        meta: $currentState.meta ?? DEFAULT_META(),
        position: $currentState.state!,
    } as FoldState;

    $: groups =
        playerId && $currentState.state
            ? deployedGunboatsForOwner($currentState.state, playerId)
            : [];

    $: selectedGroup = groups.find((g) => g.id === groupId);
    $: allowanceMu = gunboatMoveAllowanceMu(phase);

    const updateAnnotations = () => {
        const ann: IAnnotation[] = [];
        if (!selectedGroup?.position || !("x" in selectedGroup.position)) {
            annotations.set(ann);
            return;
        }
        const pos = selectedGroup.position as { x: number; y: number };
        ann.push({
            id: "gunboat_move_range",
            type: "CIRCLE",
            note: { c: pos, r: allowanceMu },
            color: "#ccaa88",
            opacity: 0.35,
            strokeWidth: 2,
        });
        annotations.set(ann);
    };

    $: if (selectedGroup) updateAnnotations();

    const handleClockClick = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.id.startsWith("face")) {
            facing = parseInt(target.id.substring(4), 10) as Facing;
        }
    };

    const resetForm = () => {
        groupId = "";
        $beacon = undefined;
    };

    $: clickMode.set(groupId ? "beacon" : "select");

    const resolveMapSelection = (refKey: string | undefined) => {
        if (!refKey || !playerId) return;
        const ref = parseObjectRef(refKey);
        if (!ref) return;
        if (ref.objType === "gunboats") {
            const g = groups.find((x) => x.id === ref.objId);
            if (g) {
                groupId = g.id;
                focusMapOnObjectId(g.id);
            }
        }
    };

    $: resolveMapSelection($selectedObject);

    $: actIssues = (() => {
        if (!selectedGroup || !$currentState.state) return [];
        if (!$beacon || !selectedGroup.position || !("x" in selectedGroup.position)) {
            return [];
        }
        const cmd = {
            name: "moveGunboats",
            id: groupId,
            position: { x: $beacon.x, y: $beacon.y },
        } as FullThrustGameCommand;
        return validateMoveGunboatsCommand(fold, cmd);
    })();

    $: canSubmit =
        !!groupId &&
        !!$beacon &&
        !actIssues.some((i) => i.severity === "error");

    const submit = () => {
        if (!selectedGroup) {
            toast.push("Select a gunboat squadron");
            return;
        }
        if (!$beacon || !selectedGroup.position || !("x" in selectedGroup.position)) {
            toast.push("Click a destination on the map");
            return;
        }
        const from = selectedGroup.position as { x: number; y: number };
        appendGameCommand({
            name: "moveGunboats",
            id: groupId,
            position: { x: $beacon.x, y: $beacon.y },
            facing,
            distanceMu: distance(from, $beacon),
        } as FullThrustGameCommand);
        toast.push("Gunboat move recorded");
        resetForm();
        dispatch("done");
    };

    onMount(() => {
        clickMode.set("select");
        beacon.set(undefined);
        selectedObject.set(undefined);
    });

    onDestroy(() => {
        clickMode.set(undefined);
        beacon.set(undefined);
        annotations.set([]);
        selectedObject.set(undefined);
    });
</script>

<p class="help is-size-7 mb-3">
    Gunboats move like fighters (18 MU primary / 9 MU secondary). They cannot screen or pursue.
</p>

<div class="field">
    <label class="label" for="gb-player">Player</label>
    <div class="select is-fullwidth">
        <select id="gb-player" bind:value={playerId}>
            <option value="">-- select --</option>
            {#each players as p}
                <option value={p.id}>{p.id}</option>
            {/each}
        </select>
    </div>
</div>

{#if playerId}
    <div class="field">
        <label class="label" for="gb-group">Gunboat squadron</label>
        <div class="select is-fullwidth">
            <select id="gb-group" bind:value={groupId}>
                <option value="">-- select --</option>
                {#each groups as g}
                    <option value={g.id}>{gunboatGroupOptionLabel(g)}</option>
                {/each}
            </select>
        </div>
        <p class="help is-size-7">Or click a gunboat token on the map.</p>
    </div>
{/if}

{#if selectedGroup}
    <p class="help">
        Range template: {allowanceMu} MU (18 primary / 9 secondary).
        {#if $beacon}
            Destination ({$beacon.x.toFixed(2)}, {$beacon.y.toFixed(2)})
        {:else}
            Click destination on the map.
        {/if}
    </p>
    <div class="field">
        <label class="label">Facing after move</label>
        <div class="control" style="max-width: 15vw" on:click={handleClockClick}>
            <Clock selected={facing} />
        </div>
    </div>
{/if}

<button class="button is-primary mt-3" disabled={!canSubmit} on:click={submit}>
    Move gunboats
</button>

<ActError issues={actIssues} />
