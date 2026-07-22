<script lang="ts">
    import { createEventDispatcher, onDestroy, onMount } from "svelte";
    import { currentState } from "@/stores/derivedState";
    import { commands } from "@/stores/writeCommands";
    import { headOffset } from "@/stores/writeHeadOffset";
    import { clickMode } from "@/stores/writeClickMode";
    import { beacon, type IBeacon } from "@/stores/writeBeacon";
    import { annotations, type IAnnotation } from "@/stores/writeAnnotations";
    import { selectedObject } from "@/stores/writeSelectedObject";
    import { focusMapOnFightersId, focusMapOnObjectId } from "@/lib/actMapInteraction";
    import { appendGameCommand } from "@/lib/game/appendCommand";
    import type { FullThrustGameCommand } from "@/schemas/commands";
    import { toast } from "@zerodevx/svelte-toast";
    import ActError from "./ActError.svelte";
    import Clock from "@/assets/clock.svg.svelte";
    import { distance } from "@/lib/game/movement";
    import {
        deployedFightersForOwner,
        fighterMoveAllowanceMu,
        isDeployedFighter,
        screenableFriendlyFighterGroups,
        validateMoveFightersCommand,
        validatePursueFighters,
        validateScreenFighters,
    } from "@/lib/game/fighterMove";
    import { FIGHTER_SCREEN_RANGE_MU } from "@/lib/game/fighterAttachment";
    import { parseObjectRef } from "@/lib/objectRef";
    import { DEFAULT_META } from "@/lib/game/types";
    import type { FoldState } from "@/lib/game/applyCommand";
    import type { GamePhase } from "@/lib/game/types";
    import { commandsInCurrentPhaseSegment } from "@/lib/game/moderatorStatus";
    import { fighterGroupOptionLabel } from "@/lib/game/fighterLabel";
    import { gameMeta } from "@/stores/writeGameMeta";
    import { initialState } from "@/stores/writeInitialState";

    type Facing = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
    type OrderMode = "move" | "screen" | "pursue";

    const dispatch = createEventDispatcher();

    $: phase = ($currentState.meta?.phase ?? 1) as GamePhase;
    $: players = $currentState.state?.players ?? [];
    $: visibleCommands = $commands.slice(0, Math.max(0, $commands.length - $headOffset));

    let playerId = "";
    let groupId = "";
    let orderMode: OrderMode = "move";
    let facing: Facing = 12;
    let screenTargetType: "ship" | "fighters" = "ship";
    let screenTargetId = "";
    let pursueTargetType: "ship" | "fighters" = "ship";
    let pursueTargetId = "";
    let formKey = 0;
    let lastInitializedGroupId = "";
    let prevGroupId = "";
    let prevScreenTargetId = "";
    let prevPursueTargetId = "";

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
    $: allowanceMu = selectedGroup
        ? fighterMoveAllowanceMu(selectedGroup.type, phase)
        : 24;

    $: friendlyShips =
        $currentState.state?.objects?.filter(
            (o) => o.objType === "ship" && o.owner === playerId && o.position
        ) ?? [];

    $: enemyTargets =
        $currentState.state?.objects?.filter((o) => {
            if (!playerId || o.owner === playerId) return false;
            if (o.objType === "ship" && o.position) return true;
            if (o.objType === "fighters" && isDeployedFighter(o)) return true;
            return false;
        }) ?? [];

    $: screenableFighters =
        selectedGroup && playerId && $currentState.state
            ? screenableFriendlyFighterGroups($currentState.state, selectedGroup, playerId)
            : [];

    $: screenSelectValue =
        screenTargetId && screenTargetType ? `${screenTargetType}:${screenTargetId}` : "";

    $: suggestedPursuit = (() => {
        if (!selectedGroup?.lastAttack) return [];
        const la = selectedGroup.lastAttack;
        return enemyTargets.filter(
            (o) => o.objType === la.targetType && o.id === la.targetId
        );
    })();

    const updateAnnotations = () => {
        const ann: IAnnotation[] = [];
        if (!selectedGroup?.position || !("x" in selectedGroup.position)) {
            annotations.set(ann);
            return;
        }
        const pos = selectedGroup.position as { x: number; y: number };
        if (orderMode === "move") {
            ann.push({
                id: "fighter_move_range",
                type: "CIRCLE",
                note: { c: pos, r: allowanceMu },
                color: "#88ccff",
                opacity: 0.35,
                strokeWidth: 2,
            });
        } else if (orderMode === "screen") {
            ann.push({
                id: "fighter_screen_range",
                type: "CIRCLE",
                note: { c: pos, r: FIGHTER_SCREEN_RANGE_MU },
                color: "#88ff88",
                opacity: 0.4,
                strokeWidth: 2,
            });
            const screenTarget =
                screenTargetType === "ship"
                    ? friendlyShips.find((s) => s.id === screenTargetId)
                    : screenableFighters.find((f) => f.id === screenTargetId);
            if (
                screenTarget?.position &&
                typeof screenTarget.position === "object" &&
                "x" in screenTarget.position
            ) {
                ann.push({
                    id: "fighter_screen_line",
                    type: "LINE",
                    note: {
                        p1: pos,
                        p2: screenTarget.position as { x: number; y: number },
                    },
                    color: "#88ff88",
                    opacity: 0.7,
                    strokeWidth: 2,
                });
            }
        } else if (orderMode === "pursue" && pursueTargetId) {
            const target = enemyTargets.find((o) => o.id === pursueTargetId);
            const tpos =
                target?.position && typeof target.position === "object" && "x" in target.position
                    ? (target.position as { x: number; y: number })
                    : undefined;
            if (tpos) {
                ann.push({
                    id: "fighter_pursue_line",
                    type: "LINE",
                    note: { p1: pos, p2: tpos },
                    color: "#ff8888",
                    opacity: 0.7,
                    strokeWidth: 2,
                });
            }
        }
        annotations.set(ann);
    };

    $: if (groupId && selectedGroup) {
        orderMode;
        screenTargetId;
        screenTargetType;
        pursueTargetId;
        allowanceMu;
        updateAnnotations();
    } else {
        annotations.set([]);
    }

    $: if (!groupId) {
        beacon.set(undefined);
    }

    $: clickMode.set(groupId && orderMode === "move" ? "beacon" : "select");

    const focusGroup = (g: (typeof groups)[number]) => {
        focusMapOnFightersId(g.id, mapObjects);
    };

    $: if (groupId && groupId !== prevGroupId) {
        prevGroupId = groupId;
        if (selectedGroup) focusGroup(selectedGroup);
    }
    $: if (groupId && selectedGroup) {
        if (groupId !== lastInitializedGroupId) {
            facing = (selectedGroup.facing ?? 12) as Facing;
            lastInitializedGroupId = groupId;
        }
    } else {
        lastInitializedGroupId = "";
    }

    $: if (screenTargetId && screenTargetId !== prevScreenTargetId) {
        prevScreenTargetId = screenTargetId;
        focusMapOnObjectId(screenTargetId, mapObjects);
    }

    $: if (pursueTargetId && pursueTargetId !== prevPursueTargetId) {
        prevPursueTargetId = pursueTargetId;
        focusMapOnObjectId(pursueTargetId, mapObjects);
    }

    const resetForm = () => {
        groupId = "";
        screenTargetId = "";
        screenTargetType = "ship";
        pursueTargetId = "";
        pursueTargetType = "ship";
        facing = 12;
        formKey += 1;
        beacon.set(undefined);
        annotations.set([]);
        selectedObject.set(undefined);
        clickMode.set("select");
    };

    const handleClockClick = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.id.startsWith("face")) {
            facing = parseInt(target.id.substring(4), 10) as Facing;
        } else {
            facing = 12;
        }
    };

    const resolveMapSelection = (refKey: string | undefined) => {
        if (!refKey || !playerId) return;
        const ref = parseObjectRef(refKey);
        if (!ref) return;
        if (ref.objType === "fighters") {
            const g = groups.find((x) => x.id === ref.objId);
            if (g) {
                groupId = g.id;
                return;
            }
        }
        if (orderMode === "screen") {
            if (ref.objType === "ship") {
                const ship = friendlyShips.find((s) => s.id === ref.objId);
                if (ship) {
                    screenTargetType = "ship";
                    screenTargetId = ship.id;
                    return;
                }
                toast.push("Select a friendly ship to screen");
                return;
            }
            if (ref.objType === "fighters") {
                const wing = screenableFighters.find((f) => f.id === ref.objId);
                if (wing) {
                    screenTargetType = "fighters";
                    screenTargetId = wing.id;
                    return;
                }
                toast.push("Select a friendly fighter group within screen range");
            }
        }
        if (orderMode === "pursue") {
            const target = enemyTargets.find((o) => o.id === ref.objId);
            if (target) {
                pursueTargetType = target.objType as "ship" | "fighters";
                pursueTargetId = target.id;
                return;
            }
            toast.push("Select an enemy ship or fighter group");
        }
    };

    $: resolveMapSelection($selectedObject);

    $: actIssues = (() => {
        if (!selectedGroup || !$currentState.state) return [];
        if (orderMode === "move") {
            if (!$beacon || !selectedGroup.position || !("x" in selectedGroup.position)) {
                return [];
            }
            const cmd = {
                name: "moveFighters",
                id: groupId,
                position: { x: $beacon.x, y: $beacon.y },
                distanceMu: distance(
                    selectedGroup.position as { x: number; y: number },
                    $beacon
                ),
            } as FullThrustGameCommand;
            return validateMoveFightersCommand(fold, cmd, phaseCommands);
        }
        if (orderMode === "screen" && screenTargetId) {
            const screenCmd =
                screenTargetType === "ship"
                    ? ({
                          name: "screenFighters",
                          id: groupId,
                          ship: screenTargetId,
                          facing,
                      } as FullThrustGameCommand)
                    : ({
                          name: "screenFighters",
                          id: groupId,
                          targetType: "fighters",
                          targetId: screenTargetId,
                          facing,
                      } as FullThrustGameCommand);
            return validateScreenFighters(fold, screenCmd, phaseCommands);
        }
        if (orderMode === "pursue" && pursueTargetId) {
            return validatePursueFighters(
                fold,
                {
                    name: "pursueFighters",
                    id: groupId,
                    targetType: pursueTargetType,
                    targetId: pursueTargetId,
                } as FullThrustGameCommand,
                phaseCommands
            );
        }
        return [];
    })();

    $: canSubmit = (() => {
        if (!groupId || actIssues.some((i) => i.severity === "error")) return false;
        if (orderMode === "move") return !!$beacon;
        if (orderMode === "screen") return !!screenTargetId;
        if (orderMode === "pursue") return !!pursueTargetId;
        return false;
    })();

    const submit = () => {
        if (!selectedGroup) {
            toast.push("Select a fighter group");
            return;
        }
        if (orderMode === "move") {
            if (!$beacon || !selectedGroup.position || !("x" in selectedGroup.position)) {
                toast.push("Click a destination on the map");
                return;
            }
            const from = selectedGroup.position as { x: number; y: number };
            const dist = distance(from, $beacon);
            appendGameCommand({
                name: "moveFighters",
                id: groupId,
                position: { x: $beacon.x, y: $beacon.y },
                facing,
                distanceMu: dist,
                vectors: [from, { x: $beacon.x, y: $beacon.y }],
            } as FullThrustGameCommand);
            toast.push("Fighter move recorded");
        } else if (orderMode === "screen") {
            if (!screenTargetId) {
                toast.push("Select a ship or fighter group to screen");
                return;
            }
            const screenCmd =
                screenTargetType === "ship"
                    ? ({
                          name: "screenFighters",
                          id: groupId,
                          ship: screenTargetId,
                          facing,
                      } as FullThrustGameCommand)
                    : ({
                          name: "screenFighters",
                          id: groupId,
                          targetType: "fighters",
                          targetId: screenTargetId,
                          facing,
                      } as FullThrustGameCommand);
            appendGameCommand(screenCmd);
            toast.push(`Screening order recorded (facing ${facing})`);
        } else {
            if (!pursueTargetId) {
                toast.push("Select a pursuit target");
                return;
            }
            appendGameCommand({
                name: "pursueFighters",
                id: groupId,
                targetType: pursueTargetType,
                targetId: pursueTargetId,
            } as FullThrustGameCommand);
            toast.push("Pursuit order recorded");
        }
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

<div class="field">
    <label class="label">Order type</label>
    <div class="control">
        <label class="radio mr-3">
            <input type="radio" bind:group={orderMode} value="move" />
            Move
        </label>
        {#if phase === 4 || phase === 6}
            <label class="radio mr-3">
                <input type="radio" bind:group={orderMode} value="screen" />
                Screen
            </label>
            <label class="radio">
                <input type="radio" bind:group={orderMode} value="pursue" />
                Pursue
            </label>
        {/if}
    </div>
</div>

<div class="field">
    <label class="label" for="player">Player</label>
    <div class="select is-fullwidth">
        <select id="player" bind:value={playerId}>
            <option value="">-- select --</option>
            {#each players as p}
                <option value={p.id}>{p.id}</option>
            {/each}
        </select>
    </div>
</div>

{#if playerId}
    <div class="field">
        <label class="label" for="group">Fighter group</label>
        <div class="select is-fullwidth">
            <select id="group" bind:value={groupId}>
                <option value="">-- select --</option>
                {#each groups as g}
                    <option value={g.id}>{fighterGroupOptionLabel(g)}</option>
                {/each}
            </select>
        </div>
        <p class="help is-size-7">Or click a fighter token on the map.</p>
    </div>
{/if}

{#if orderMode === "move" && selectedGroup}
    <p class="help">
        Range template: {allowanceMu} MU.
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
        <p class="help">Selected facing: <strong>{facing}</strong></p>
    </div>
{:else if orderMode === "screen" && selectedGroup}
    <div class="field">
        <label class="label">Facing while screening</label>
        <div class="control" style="max-width: 15vw" on:click={handleClockClick}>
            <Clock selected={facing} />
        </div>
        <p class="help">
            Selected facing: <strong>{facing}</strong> — preserved when the escorted unit moves in
            phase 5.
        </p>
    </div>
    <div class="field">
        <label class="label" for="screenTarget">Screen target</label>
        <div class="select is-fullwidth">
            <select
                id="screenTarget"
                value={screenSelectValue}
                on:change={(e) => {
                    const v = (e.currentTarget as HTMLSelectElement).value;
                    if (!v) {
                        screenTargetId = "";
                        return;
                    }
                    const [type, id] = v.split(":");
                    screenTargetType = type as "ship" | "fighters";
                    screenTargetId = id;
                }}
            >
                <option value="">-- select --</option>
                <optgroup label="Friendly ships">
                    {#each friendlyShips as s}
                        <option value="ship:{s.id}">{s.id}</option>
                    {/each}
                </optgroup>
                {#if screenableFighters.length > 0}
                    <optgroup label="Friendly fighter groups (within {FIGHTER_SCREEN_RANGE_MU} MU)">
                        {#each screenableFighters as f}
                            <option value="fighters:{f.id}">{fighterGroupOptionLabel(f)}</option>
                        {/each}
                    </optgroup>
                {/if}
            </select>
        </div>
        <p class="help is-size-7">
            Friendly ship or fighter group within {FIGHTER_SCREEN_RANGE_MU} MU (typical). Groups
            already screening this wing are omitted; two groups cannot screen each other. Click the
            map or use the dropdown.
        </p>
    </div>
{:else if orderMode === "pursue" && selectedGroup}
    <div class="field">
        <label class="label" for="pursueTarget">Pursuit target</label>
        <div class="select is-fullwidth">
            {#key formKey}
            <select
                id="pursueTarget"
                on:change={(e) => {
                    const v = (e.currentTarget as HTMLSelectElement).value;
                    if (!v) {
                        pursueTargetId = "";
                        return;
                    }
                    const [type, id] = v.split(":");
                    pursueTargetType = type as "ship" | "fighters";
                    pursueTargetId = id;
                }}
            >
                <option value="">-- select --</option>
                {#if suggestedPursuit.length > 0}
                    <optgroup label="Suggested (attacked last turn)">
                        {#each suggestedPursuit as t}
                            <option value="{t.objType}:{t.id}">{t.objType} {t.id}</option>
                        {/each}
                    </optgroup>
                {/if}
                <optgroup label="All enemy on map">
                    {#each enemyTargets as t}
                        <option value="{t.objType}:{t.id}">{t.objType} {t.id}</option>
                    {/each}
                </optgroup>
            </select>
            {/key}
        </div>
        <p class="help is-size-7">
            Suggested targets attacked last turn; any enemy may be selected (warnings if ineligible).
        </p>
    </div>
{/if}

<button class="button is-primary mt-3" disabled={!canSubmit} on:click={submit}>
    {#if orderMode === "move"}
        Move fighters
    {:else if orderMode === "screen"}
        Screen
    {:else}
        Pursue
    {/if}
</button>

<ActError issues={actIssues} />
