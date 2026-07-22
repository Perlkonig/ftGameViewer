<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { currentState } from "@/stores/derivedState";
    import { gameMeta } from "@/stores/writeGameMeta";
    import { commands } from "@/stores/writeCommands";
    import { headOffset } from "@/stores/writeHeadOffset";
    import {
        applyPhase9PointDefenseBatch,
        buildPhase9PdResolveCommands,
        effectivePhase9PdDeclarations,
        phase9PointDefenseResolvedInLog,
        validateResolvePhase9PointDefense,
    } from "@/lib/game/pointDefensePhase9";
    import { parseDiceString, policyRollSource, arrayRollSource } from "@/lib/game/dice";
    import { appendGameCommands } from "@/lib/game/appendCommand";
    import { toast } from "@zerodevx/svelte-toast";
    import { userSettings } from "@/stores/writeUserSettings";
    import ActError from "./ActError.svelte";

    const dispatch = createEventDispatcher();

    let diceOverride = "";

    $: turn = $currentState.meta?.turn ?? 1;
    $: visibleCommands = $commands.slice(0, Math.max(0, $commands.length - $headOffset));
    $: alreadyResolved = phase9PointDefenseResolvedInLog(visibleCommands, turn);
    $: declarations = effectivePhase9PdDeclarations(
        $currentState.phase9PdDeclarations,
        visibleCommands,
        turn
    );
    $: validationIssues =
        $currentState.state && !alreadyResolved
            ? validateResolvePhase9PointDefense(
                  $currentState.state,
                  declarations,
                  visibleCommands,
                  turn,
                  { furballDeclarations: $currentState.phase8FurballDeclarations }
              )
            : [];

    const resolve = () => {
        if (!$currentState.state || alreadyResolved) return;
        const issues = validateResolvePhase9PointDefense(
            $currentState.state,
            declarations,
            visibleCommands,
            turn,
            { furballDeclarations: $currentState.phase8FurballDeclarations }
        );
        const errors = issues.filter((i) => i.severity === "error");
        if (errors.length) {
            toast.push(errors[0].message);
            return;
        }
        const warnMessages = [...new Set(issues.filter((i) => i.severity === "warning").map((i) => i.message))];
        if (warnMessages.length) {
            toast.push(warnMessages.join(" "));
        }
        const meta = $currentState.meta ?? $gameMeta;
        const position = structuredClone($currentState.state);
        let result;
        try {
            if (diceOverride.trim()) {
                const rolls = parseDiceString(diceOverride);
                result = applyPhase9PointDefenseBatch(
                    position,
                    declarations,
                    arrayRollSource(rolls),
                    visibleCommands,
                    turn
                );
            } else {
                const source = policyRollSource(meta.dicePolicy, { seed: meta.diceSeed });
                result = applyPhase9PointDefenseBatch(
                    position,
                    declarations,
                    source,
                    visibleCommands,
                    turn
                );
            }
        } catch (e) {
            toast.push(e instanceof Error ? e.message : "Dice error");
            return;
        }
        appendGameCommands(
            buildPhase9PdResolveCommands(
                result,
                ($userSettings.role ?? "player") === "moderator" ? "moderatorSequence" : "client"
            ),
            ($userSettings.role ?? "player") === "moderator"
        );
        toast.push(`Resolved ${declarations.length} point defense allocation(s)`);
        diceOverride = "";
        dispatch("done");
    };
</script>

<p class="help">
    Moderator: roll and apply every point defense declaration this phase.
</p>

{#if alreadyResolved}
    <p class="notification is-success is-light">
        Point defense for this phase was already resolved. Advance the phase when ready.
    </p>
{:else if declarations.length === 0}
    <p class="notification is-warning is-light">No point defense declarations yet.</p>
{:else}
    <div class="box mb-3">
        <p class="label">Declared allocations ({declarations.length})</p>
        <ul class="help">
            {#each declarations as decl, i}
                <li>
                    #{i + 1}: {decl.defenderShip}/{decl.weapon} → {decl.threatId}
                    (defends {decl.supportedShip})
                </li>
            {/each}
        </ul>
    </div>
{/if}

<ActError issues={validationIssues} />

{#if !alreadyResolved}
    <div class="field">
        <label class="label" for="pdDice">Dice override</label>
        <input id="pdDice" class="input" bind:value={diceOverride} placeholder="Leave empty to auto-roll" />
    </div>

    <button
        class="button is-primary"
        on:click={resolve}
        disabled={declarations.length === 0}
    >
        Resolve all point defense
    </button>
{/if}
