<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { currentState } from "@/stores/derivedState";
    import { gameMeta } from "@/stores/writeGameMeta";
    import { commands } from "@/stores/writeCommands";
    import { headOffset } from "@/stores/writeHeadOffset";
    import {
        buildFurballCommands,
        resolveFurballEngagement,
        splitKillsEvenly,
        type FurballEngagement,
        type FurballGroupSide,
    } from "@/lib/game/fighterDogfight";
    import { fighterAttackAllocations } from "@/lib/game/fighterEngagement";
    import {
        screeningEngagementPlan,
        suggestedFurballsFromScreening,
        validateFurballAgainstScreening,
    } from "@/lib/game/fighterScreening";
    import { isDeployedFighter } from "@/lib/game/fighterMove";
    import { fighterEndurance, isFighterExhausted } from "@/lib/game/fighterEndurance";
    import { parseDiceString, policyRollSource, arrayRollSource } from "@/lib/game/dice";
    import { appendGameCommands } from "@/lib/game/appendCommand";
    import { toast } from "@zerodevx/svelte-toast";
    import { userSettings } from "@/stores/writeUserSettings";
    import { fighterGroupOptionLabel } from "@/lib/game/fighterLabel";
    import { focusMapOnFightersId } from "@/lib/actMapInteraction";

    const dispatch = createEventDispatcher();

    let showQuick = false;
    let diceOverride = "";
    let attackerIds: string[] = [];
    let defenderIds: string[] = [];
    let attackerTargets: Record<string, string[]> = {};
    let defenderTargets: Record<string, string[]> = {};
    let quickA = "";
    let quickB = "";
    let prevQuickA = "";
    let prevQuickB = "";

    $: mapObjects = ($currentState.state?.objects ?? []) as import("@/schemas/position").FullThrustGameObjects[];

    $: if (quickA && quickA !== prevQuickA) {
        prevQuickA = quickA;
        focusMapOnFightersId(quickA, mapObjects);
    }
    $: if (quickB && quickB !== prevQuickB) {
        prevQuickB = quickB;
        focusMapOnFightersId(quickB, mapObjects);
    }

    $: fighters =
        $currentState.state?.objects?.filter(
            (o) => o.objType === "fighters" && isDeployedFighter(o)
        ) ?? [];
    $: turn = $currentState.meta?.turn ?? 1;
    $: visibleCommands = $commands.slice(0, Math.max(0, $commands.length - $headOffset));
    $: allocations =
        $currentState.state
            ? fighterAttackAllocations($currentState.state, visibleCommands, turn)
            : [];
    $: screeningPlan =
        $currentState.state
            ? screeningEngagementPlan($currentState.state, allocations)
            : [];
    $: suggestions = suggestedFurballsFromScreening(screeningPlan);

    const ensureTargets = (id: string, map: Record<string, string[]>) => {
        if (!map[id]) map[id] = [];
        return map[id];
    };

    const toggleId = (list: string[], id: string): string[] =>
        list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

    const toggleAttacker = (id: string) => {
        attackerIds = toggleId(attackerIds, id);
        if (attackerIds.includes(id)) {
            ensureTargets(id, attackerTargets);
            focusMapOnFightersId(id, mapObjects);
        } else delete attackerTargets[id];
        attackerTargets = attackerTargets;
    };

    const toggleDefender = (id: string) => {
        defenderIds = toggleId(defenderIds, id);
        if (defenderIds.includes(id)) {
            ensureTargets(id, defenderTargets);
            focusMapOnFightersId(id, mapObjects);
        } else delete defenderTargets[id];
        defenderTargets = defenderTargets;
    };

    const applySuggestion = (eng: FurballEngagement) => {
        attackerIds = eng.attackers.map((a) => a.id);
        defenderIds = eng.defenders.map((d) => d.id);
        attackerTargets = Object.fromEntries(eng.attackers.map((a) => [a.id, [...a.targetIds]]));
        defenderTargets = Object.fromEntries(eng.defenders.map((d) => [d.id, [...d.targetIds]]));
    };

    const buildEngagement = (): FurballEngagement | null => {
        if (showQuick) {
            if (!quickA || !quickB || quickA === quickB) return null;
            return {
                attackers: [{ id: quickA, targetIds: [quickB] }],
                defenders: [{ id: quickB, targetIds: [quickA] }],
            };
        }
        const attackers: FurballGroupSide[] = attackerIds.map((id) => ({
            id,
            targetIds: (attackerTargets[id] ?? []).filter(Boolean),
        }));
        const defenders: FurballGroupSide[] = defenderIds.map((id) => ({
            id,
            targetIds: (defenderTargets[id] ?? []).filter(Boolean),
        }));
        if (attackers.length === 0 && defenders.length === 0) return null;
        return { attackers, defenders };
    };

    $: engagement = buildEngagement();
    $: screeningWarnings = engagement
        ? validateFurballAgainstScreening(screeningPlan, engagement)
        : [];

    const previewSplit = (kills: number, targetIds: string[]) => {
        const m = splitKillsEvenly(kills, targetIds);
        return [...m.entries()].map(([id, n]) => `${id}:${n}`).join(", ");
    };

    const resolve = () => {
        const eng = buildEngagement();
        if (!eng) {
            toast.push("Select at least one attacker or defender group");
            return;
        }
        for (const side of [...eng.attackers, ...eng.defenders]) {
            if (side.targetIds.length === 0) {
                toast.push(`Group ${side.id} needs at least one target`);
                return;
            }
        }
        const meta = $currentState.meta ?? $gameMeta;
        const position = $currentState.state;
        if (!position) return;
        let rolls: number[];
        try {
            if (diceOverride.trim()) {
                rolls = parseDiceString(diceOverride);
            } else {
                const source = policyRollSource(meta.dicePolicy, { seed: meta.diceSeed });
                resolveFurballEngagement(position, eng, source);
                rolls = source.consumed();
            }
        } catch (e) {
            toast.push(e instanceof Error ? e.message : "Dice error");
            return;
        }
        const resolution = resolveFurballEngagement(position, eng, arrayRollSource(rolls));
        const cmds = buildFurballCommands(
            eng,
            resolution,
            position,
            diceOverride.trim() ? "moderatorSequence" : "client"
        );
        appendGameCommands(cmds, ($userSettings.role ?? "player") === "moderator");
        toast.push(`Furball resolved: ${resolution.notes}`);
        dispatch("done");
    };
</script>

<p class="help">
    Simultaneous furball: each fighter rolls (4–5 = 1 kill, 6 = 2 + reroll). Exhausted groups
    return fire on 6 only. −1 CEF per participating group.
</p>

<details class="mb-3">
    <summary>Quick 1v1 dogfight</summary>
    <label class="checkbox mt-2">
        <input type="checkbox" bind:checked={showQuick} />
        Use quick 1v1 mode
    </label>
    {#if showQuick}
        <div class="columns mt-2">
            <div class="column">
                <div class="select is-fullwidth">
                    <select bind:value={quickA}>
                        <option value="">Group A</option>
                        {#each fighters as f}
                            <option value={f.id}>{fighterGroupOptionLabel(f)}</option>
                        {/each}
                    </select>
                </div>
            </div>
            <div class="column">
                <div class="select is-fullwidth">
                    <select bind:value={quickB}>
                        <option value="">Group B</option>
                        {#each fighters as f}
                            <option value={f.id}>{fighterGroupOptionLabel(f)}</option>
                        {/each}
                    </select>
                </div>
            </div>
        </div>
    {/if}
</details>

{#if !showQuick}
    {#if suggestions.length > 0}
        <div class="box mb-3">
            <p class="label">Suggested engagements (from screening + phase 7)</p>
            {#each suggestions as sug, i}
                <button class="button is-small is-light mb-1 mr-1" on:click={() => applySuggestion(sug)}>
                    Suggestion {i + 1}: {sug.attackers.map((a) => a.id).join(", ")} vs
                    {sug.defenders.map((d) => d.id).join(", ") || "—"}
                </button>
            {/each}
        </div>
    {/if}

    <div class="columns">
        <div class="column">
            <p class="label">Attackers</p>
            {#each fighters as f}
                <label class="checkbox is-block">
                    <input
                        type="checkbox"
                        checked={attackerIds.includes(f.id)}
                        on:change={() => toggleAttacker(f.id)}
                    />
                    {fighterGroupOptionLabel(f)} — CEF {fighterEndurance(f)}{isFighterExhausted(f) ? " (exhausted)" : ""}
                </label>
            {/each}
        </div>
        <div class="column">
            <p class="label">Defenders</p>
            {#each fighters as f}
                <label class="checkbox is-block">
                    <input
                        type="checkbox"
                        checked={defenderIds.includes(f.id)}
                        on:change={() => toggleDefender(f.id)}
                    />
                    {fighterGroupOptionLabel(f)} — CEF {fighterEndurance(f)}{isFighterExhausted(f) ? " (exhausted)" : ""}
                </label>
            {/each}
        </div>
    </div>

    {#each attackerIds as aid}
        <div class="field">
            <label class="label" for="at-{aid}">Attacker {aid} targets</label>
            <div class="select is-multiple is-fullwidth">
                <select
                    id="at-{aid}"
                    multiple
                    bind:value={attackerTargets[aid]}
                    on:change={() => (attackerTargets = attackerTargets)}
                >
                    {#each defenderIds as did}
                        <option value={did}>{did}</option>
                    {/each}
                </select>
            </div>
            <p class="help">Kill split preview (3 kills): {previewSplit(3, attackerTargets[aid] ?? [])}</p>
        </div>
    {/each}

    {#each defenderIds as did}
        <div class="field">
            <label class="label" for="dt-{did}">Defender {did} return-fire targets</label>
            <div class="select is-multiple is-fullwidth">
                <select
                    id="dt-{did}"
                    multiple
                    bind:value={defenderTargets[did]}
                    on:change={() => (defenderTargets = defenderTargets)}
                >
                    {#each attackerIds as aid}
                        <option value={aid}>{aid}</option>
                    {/each}
                </select>
            </div>
        </div>
    {/each}
{/if}

{#if screeningWarnings.length > 0}
    <div class="notification is-warning is-light">
        {#each screeningWarnings as w}
            <p>{w.message}</p>
        {/each}
    </div>
{/if}

<div class="field">
    <label class="label" for="dice">Dice override</label>
    <input id="dice" class="input" bind:value={diceOverride} placeholder="Leave empty to auto-roll" />
</div>

<button class="button is-primary" on:click={resolve}>Resolve furball</button>
