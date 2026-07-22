<script lang="ts">
    import Modal from "@/components/Modal.svelte";
    import { appendGameCommand } from "@/lib/game/appendCommand";
    import { fixedDiceRolls, SeededDice } from "@/lib/game/dice";
    import { phaseName } from "@/lib/game/phase";
    import {
        empContributorsNeedingAllocation,
        empFailThreshold,
        empHullRowDrmForShip,
        mergedEmpAllocationsForTarget,
        type BankedEmpState,
    } from "@/lib/game/empFire";
    import { commandsInCurrentPhaseSegment } from "@/lib/game/moderatorStatus";
    import { currentState } from "@/stores/derivedState";
    import { commands } from "@/stores/writeCommands";
    import { headOffset } from "@/stores/writeHeadOffset";
    import { gameMeta } from "@/stores/writeGameMeta";
    import { initialState } from "@/stores/writeInitialState";
    import type { GameMeta } from "@/lib/game/types";
    import type { FullThrustGameCommand } from "@/schemas/commands";
    import { toast } from "@zerodevx/svelte-toast";

    export let meta: GameMeta;
    export let onClose: () => void;
    export let onContinue: () => void;

    let diceSeq = "";
    let selectedTarget = "";

    $: position =
        $currentState.state ?? { map: { mode: "fixed", width: 72, height: 48 }, objects: [] };
    $: banked = ($currentState.bankedEmpHits ?? {}) as BankedEmpState;
    $: targetIds = Object.keys(banked);
    $: if (targetIds.length && !selectedTarget) {
        selectedTarget = targetIds[0];
    }
    $: visibleCommands = $commands.slice(0, Math.max(0, $commands.length - $headOffset));
    $: phaseCommands = commandsInCurrentPhaseSegment(
        visibleCommands,
        { turn: meta.turn, phase: 13 },
        $gameMeta,
        $initialState
    );
    $: needing = empContributorsNeedingAllocation(banked, phaseCommands);
    $: selectedEntry = selectedTarget ? banked[selectedTarget] : undefined;
    $: targetShip = selectedTarget
        ? position.objects?.find((o) => o.objType === "ship" && o.id === selectedTarget)
        : undefined;
    $: hullDrm = targetShip ? empHullRowDrmForShip(targetShip) : 0;
    $: failOn = selectedEntry ? empFailThreshold(selectedEntry.totalHits) : 6;
    $: diceNeeded = selectedEntry?.totalHits ?? 0;
    $: canResolveTarget =
        selectedTarget &&
        selectedEntry &&
        !needing.some((n) => n.targetShip === selectedTarget);

    const rollDice = () => {
        const n = Math.max(0, Math.min(120, diceNeeded));
        if (n === 0) return;
        const rng = new SeededDice();
        diceSeq = Array.from({ length: n }, () => rng.next()).join(", ");
    };

    const resolveTarget = () => {
        if (!selectedTarget || !selectedEntry || !canResolveTarget) return;
        try {
            const allocations = mergedEmpAllocationsForTarget(
                selectedTarget,
                selectedEntry,
                phaseCommands
            );
            const { rolls } = fixedDiceRolls(diceSeq, diceNeeded, meta.dicePolicy, {
                seed: meta.diceSeed,
            });
            if (!diceSeq.trim()) diceSeq = rolls.join(", ");
            const cmd = {
                name: "resolveEmpAllocation",
                targetShip: selectedTarget,
                allocations,
                hullRowDrm: hullDrm,
                rolls,
            } as FullThrustGameCommand;
            appendGameCommand(cmd, true);
            toast.push(`Resolved EMP on ${selectedTarget}`);
            diceSeq = "";
            const remaining = { ...banked };
            delete remaining[selectedTarget];
            if (Object.keys(remaining).length === 0) {
                onContinue();
            } else {
                selectedTarget = Object.keys(remaining)[0] ?? "";
            }
        } catch (e) {
            toast.push(e instanceof Error ? e.message : "Could not resolve EMP");
        }
    };

    const finish = () => {
        if (Object.keys(banked).length > 0) {
            toast.push("Resolve or skip remaining EMP targets first");
            return;
        }
        onContinue();
    };

    $: modalButtons =
        targetIds.length === 0
            ? [{ label: "Continue to thresholds", action: onContinue }]
            : [
                  { label: "Skip", action: onClose },
                  {
                      label: "Continue to thresholds",
                      action: finish,
                      class: "is-light",
                  },
              ];
</script>

<Modal title="Phase 13: {phaseName(13)} — EMP resolution" buttons={modalButtons}>
    {#if targetIds.length === 0}
        <p class="notification is-light">No banked EMP hits — continue to hull thresholds.</p>
    {:else}
        <p class="help mb-3">
            Attackers allocate hits in the Act tab (<strong>EMP allocation</strong>). Roll one d6
            per hit; combined fail threshold uses total hits on the target. Hull-row DRM from
            phases 11–12 adds to each die.
        </p>

        {#if needing.length > 0}
            <p class="notification is-warning is-size-7">
                Awaiting allocation:
                {#each needing as n}
                    {n.firerShip}/{n.weapon} → {n.targetShip} ({n.hits} hit{n.hits === 1 ? "" : "s"}){#if n !== needing[needing.length - 1]}; {/if}
                {/each}
            </p>
        {/if}

        <div class="field">
            <label class="label" for="empTarget">Target ship</label>
            <div class="select">
                <select id="empTarget" bind:value={selectedTarget}>
                    {#each targetIds as id}
                        <option value={id}>{id} ({banked[id].totalHits} hit(s))</option>
                    {/each}
                </select>
            </div>
        </div>

        {#if selectedEntry}
            <table class="table is-narrow is-fullwidth is-size-7 mb-3">
                <tbody>
                    <tr><th>Total hits</th><td>{selectedEntry.totalHits}</td></tr>
                    <tr><th>Fail on</th><td>{failOn}+</td></tr>
                    <tr><th>Hull-row DRM</th><td>+{hullDrm}</td></tr>
                    <tr><th>Dice</th><td>{diceNeeded}</td></tr>
                </tbody>
            </table>

            <p class="help is-size-7 mb-2">
                Contributors:
                {#each selectedEntry.contributors as c}
                    {c.shipId}/{c.weaponId} ({c.hits}){#if c !== selectedEntry.contributors[selectedEntry.contributors.length - 1]}; {/if}
                {/each}
            </p>

            <div class="field is-grouped mb-3">
                <div class="control">
                    <button type="button" class="button is-light" on:click={rollDice} disabled={!diceNeeded}>
                        Roll {diceNeeded} dice
                    </button>
                </div>
                <div class="control">
                    <button
                        type="button"
                        class="button is-info"
                        on:click={resolveTarget}
                        disabled={!canResolveTarget}
                    >
                        Resolve {selectedTarget}
                    </button>
                </div>
            </div>

            <div class="field">
                <label class="label" for="empDice">Dice sequence</label>
                <input id="empDice" class="input" bind:value={diceSeq} placeholder="Auto-roll on resolve if empty" />
            </div>
        {/if}
    {/if}
</Modal>
