<script lang="ts">
    import { createEventDispatcher, onDestroy, onMount } from "svelte";
    import { currentState } from "@/stores/derivedState";
    import { commands } from "@/stores/writeCommands";
    import { headOffset } from "@/stores/writeHeadOffset";
    import { clickMode } from "@/stores/writeClickMode";
    import { selectedObject } from "@/stores/writeSelectedObject";
    import { annotations, type IAnnotation } from "@/stores/writeAnnotations";
    import { appendGameCommand } from "@/lib/game/appendCommand";
    import { toast } from "@zerodevx/svelte-toast";
    import type { FullThrustGameCommand } from "@/schemas/commands";
    import ActError from "./ActError.svelte";
    import {
        deployedFightersForOwner,
        isDeployedFighter,
    } from "@/lib/game/fighterMove";
    import {
        FIGHTER_ATTACK_RANGE_MU,
        validateDeclareFighterAttack,
    } from "@/lib/game/fighterAttack";
    import genArcs from "@/lib/genArcs";
    import { parseObjectRef } from "@/lib/objectRef";
    import { focusMapOnFightersId, focusMapOnObjectId } from "@/lib/actMapInteraction";
    import type { FoldState } from "@/lib/game/applyCommand";
    import { commandsInCurrentPhaseSegment } from "@/lib/game/moderatorStatus";
    import { fighterGroupOptionLabel } from "@/lib/game/fighterLabel";
    import { gameMeta } from "@/stores/writeGameMeta";
    import { initialState } from "@/stores/writeInitialState";

    const dispatch = createEventDispatcher();

    $: phase = $currentState.meta?.phase ?? 7;
    $: players = $currentState.state?.players ?? [];
    $: visibleCommands = $commands.slice(0, Math.max(0, $commands.length - $headOffset));

    let playerId = "";
    let groupId = "";
    let targetType: "ship" | "fighters" | "ordnance" = "ship";
    let targetId = "";
    let prevGroupId = "";
    let prevTargetId = "";

    $: mapObjects = ($currentState.state?.objects ?? []) as import("@/schemas/position").FullThrustGameObjects[];

    $: fold = {
        meta: $currentState.meta ?? DEFAULT_META(),
        position: $currentState.state!,
    } as FoldState;

    $: phaseCommands =
        $currentState.state && $currentState.meta
            ? commandsInCurrentPhaseSegment(
                  visibleCommands,
                  { turn: $currentState.meta.turn, phase },
                  $gameMeta,
                  $initialState
              )
            : [];

    $: groups =
        playerId && $currentState.state
            ? deployedFightersForOwner($currentState.state, playerId)
            : [];

    $: selectedGroup = groups.find((g) => g.id === groupId);

    $: enemyTargets =
        $currentState.state?.objects?.filter((o) => {
            if (!playerId || o.owner === playerId) return false;
            if (o.objType === "ship" && o.position) return true;
            if (o.objType === "fighters" && isDeployedFighter(o)) return true;
            if (o.objType === "ordnance" && o.position) return true;
            return false;
        }) ?? [];

    $: filteredTargets = enemyTargets.filter((o) => o.objType === targetType);

    $: actIssues =
        groupId && targetId
            ? validateDeclareFighterAttack(
                  fold,
                  {
                      name: "declareFighterAttack",
                      id: groupId,
                      targetType,
                      targetId,
                  } as FullThrustGameCommand,
                  phaseCommands
              )
            : [];

    $: canSubmit =
        !!groupId &&
        !!targetId &&
        !actIssues.some((i) => i.severity === "error");

    $: if (groupId && groupId !== prevGroupId) {
        prevGroupId = groupId;
        focusMapOnFightersId(groupId, mapObjects);
    }
    $: if (targetId && targetId !== prevTargetId) {
        prevTargetId = targetId;
        focusMapOnObjectId(targetId, mapObjects);
    }

    const updateAnnotations = () => {
        const ann: IAnnotation[] = [];
        if (!selectedGroup?.position || !("x" in selectedGroup.position)) {
            annotations.set(ann);
            return;
        }
        const pos = selectedGroup.position as { x: number; y: number };
        const facing = (selectedGroup.facing ?? 12) as import("@/lib/genArcs").Facing;
        const [left, right] = genArcs(undefined, facing, "FP", 3);
        ann.push({
            id: "fighter_attack_arc",
            type: "ARC",
            note: { c: pos, r: FIGHTER_ATTACK_RANGE_MU, left, right },
            color: "#aaccff",
            opacity: 0.2,
            strokeWidth: 2,
        });
        annotations.set(ann);
    };

    $: if (groupId && selectedGroup) {
        updateAnnotations();
    } else {
        annotations.set([]);
    }

    onMount(() => {
        clickMode.set("select");
    });

    onDestroy(() => {
        annotations.set([]);
        clickMode.set("beacon");
    });

    $: if ($selectedObject && $clickMode === "select" && $currentState.state && playerId) {
        const ref = parseObjectRef($selectedObject);
        if (ref) {
            const obj = $currentState.state.objects?.find((o) => o.id === ref.objId);
            if (obj && obj.owner !== playerId) {
                if (obj.objType === "ship") {
                    targetType = "ship";
                    targetId = obj.id;
                } else if (obj.objType === "fighters" && isDeployedFighter(obj)) {
                    targetType = "fighters";
                    targetId = obj.id;
                } else if (obj.objType === "ordnance") {
                    targetType = "ordnance";
                    targetId = obj.id;
                }
            }
        }
    }

    const submit = () => {
        if (!canSubmit) {
            toast.push("Select fighter group and target");
            return;
        }
        const cmd = {
            name: "declareFighterAttack",
            id: groupId,
            targetType,
            targetId,
        } as FullThrustGameCommand;
        const issues = validateDeclareFighterAttack(fold, cmd, phaseCommands);
        for (const issue of issues) {
            if (issue.severity === "warning") toast.push(issue.message);
        }
        appendGameCommand(cmd);
        toast.push("Fighter attack declared");
        groupId = "";
        targetId = "";
        dispatch("done");
    };
</script>

<p class="help">
    Phase 7 fighter allocation: each deployed group may attack one target. Ordnance may be
    selected even when out of range or arc — warnings are shown for player and moderator.
</p>

<div class="field">
    <label class="label" for="player">Player</label>
    <div class="select">
        <select id="player" bind:value={playerId}>
            <option value="">--</option>
            {#each players as p}
                <option value={p.id}>{p.id}</option>
            {/each}
        </select>
    </div>
</div>

{#if playerId}
    <div class="field">
        <label class="label" for="grp">Fighter group</label>
        <div class="select">
            <select id="grp" bind:value={groupId}>
                <option value="">--</option>
                {#each groups as g}
                    <option value={g.id}>{fighterGroupOptionLabel(g)}</option>
                {/each}
            </select>
        </div>
    </div>
{/if}

<div class="field">
    <label class="label" for="ttype">Target type</label>
    <div class="select">
        <select id="ttype" bind:value={targetType}>
            <option value="ship">Ship</option>
            <option value="fighters">Fighters</option>
            <option value="ordnance">Ordnance</option>
        </select>
    </div>
</div>

<div class="field">
    <label class="label" for="tgt">Target</label>
    <div class="select">
        <select id="tgt" bind:value={targetId}>
            <option value="">--</option>
            {#each filteredTargets as t}
                <option value={t.id}>{t.id}</option>
            {/each}
        </select>
    </div>
</div>

<ActError issues={actIssues} />

<button class="button is-primary" on:click={submit} disabled={!canSubmit}>Declare attack</button>
