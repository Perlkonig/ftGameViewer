<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { currentState } from "@/stores/derivedState";
    import { gameMeta } from "@/stores/writeGameMeta";
    import { commands } from "@/stores/writeCommands";
    import { headOffset } from "@/stores/writeHeadOffset";
    import { fighterAttackAllocations } from "@/lib/game/fighterEngagement";
    import { gunboatAttackAllocations } from "@/lib/game/gunboatEngagement";
    import {
        applyPhase8FurballBatch,
        buildPhase8FurballResolveCommands,
        effectivePhase8FurballDeclarations,
        phase8FurballsResolvedInLog,
        uncoveredFurballGroups,
        validateResolvePhase8Furballs,
    } from "@/lib/game/fighterPhase8";
    import { parseDiceString, policyRollSource, arrayRollSource } from "@/lib/game/dice";
    import { appendGameCommands } from "@/lib/game/appendCommand";
    import { toast } from "@zerodevx/svelte-toast";
    import { userSettings } from "@/stores/writeUserSettings";
    import ActError from "./ActError.svelte";

    const dispatch = createEventDispatcher();

    let diceOverride = "";

    $: turn = $currentState.meta?.turn ?? 1;
    $: visibleCommands = $commands.slice(0, Math.max(0, $commands.length - $headOffset));
    $: alreadyResolved = phase8FurballsResolvedInLog(visibleCommands, turn);
    $: declarations = effectivePhase8FurballDeclarations(
        $currentState.phase8FurballDeclarations,
        visibleCommands,
        turn
    );
    $: allocations =
        $currentState.state
            ? fighterAttackAllocations($currentState.state, visibleCommands, turn)
            : [];
    $: gunboatAllocations =
        $currentState.state
            ? gunboatAttackAllocations($currentState.state, visibleCommands, turn)
            : [];
    $: uncovered =
        $currentState.state && !alreadyResolved
            ? uncoveredFurballGroups(
                  $currentState.state,
                  allocations,
                  declarations,
                  gunboatAllocations
              )
            : [];
    $: validationIssues =
        $currentState.state && !alreadyResolved
            ? validateResolvePhase8Furballs(
                  $currentState.state,
                  allocations,
                  declarations,
                  gunboatAllocations
              )
            : [];

    const resolve = () => {
        if (!$currentState.state || alreadyResolved) return;
        const issues = validateResolvePhase8Furballs(
            $currentState.state,
            allocations,
            declarations,
            gunboatAllocations
        );
        const errors = issues.filter((i) => i.severity === "error");
        if (errors.length) {
            toast.push(errors[0].message);
            return;
        }
        const meta = $currentState.meta ?? $gameMeta;
        const position = structuredClone($currentState.state);
        let result;
        try {
            if (diceOverride.trim()) {
                const rolls = parseDiceString(diceOverride);
                result = applyPhase8FurballBatch(
                    position,
                    declarations,
                    arrayRollSource(rolls),
                    allocations,
                    gunboatAllocations
                );
            } else {
                const source = policyRollSource(meta.dicePolicy, { seed: meta.diceSeed });
                result = applyPhase8FurballBatch(
                    position,
                    declarations,
                    source,
                    allocations,
                    gunboatAllocations
                );
            }
        } catch (e) {
            toast.push(e instanceof Error ? e.message : "Dice error");
            return;
        }
        appendGameCommands(
            buildPhase8FurballResolveCommands(result, declarations.length),
            ($userSettings.role ?? "player") === "moderator"
        );
        toast.push(`Resolved ${declarations.length} furball engagement(s)`);
        diceOverride = "";
        dispatch("done");
    };
</script>

<p class="help">
    Moderator: roll and apply every furball declared this phase. Uses one dice stream across all
    engagements.
</p>

{#if alreadyResolved}
    <p class="notification is-success is-light">
        Furballs for this phase were already resolved. Advance the phase when ready.
    </p>
{:else if declarations.length === 0}
    <p class="notification is-warning is-light">No furball declarations yet.</p>
{:else}
    <div class="box mb-3">
        <p class="label">Declared engagements ({declarations.length})</p>
        <ul class="help">
            {#each declarations as decl, i}
                <li>
                    #{i + 1}: {decl.attackers.map((a) => a.id).join(", ")} vs
                    {decl.defenders.map((d) => d.id).join(", ") || "—"}
                </li>
            {/each}
        </ul>
    </div>
{/if}

{#if uncovered.length > 0}
    <p class="notification is-danger is-light">
        Groups not covered by any declaration: {uncovered.join(", ")}
    </p>
{/if}

<ActError issues={validationIssues} />

{#if !alreadyResolved}
    <div class="field">
        <label class="label" for="dice">Dice override</label>
        <input id="dice" class="input" bind:value={diceOverride} placeholder="Leave empty to auto-roll" />
    </div>

    <button class="button is-primary" on:click={resolve} disabled={declarations.length === 0}>
        Resolve all furballs
    </button>
{/if}
