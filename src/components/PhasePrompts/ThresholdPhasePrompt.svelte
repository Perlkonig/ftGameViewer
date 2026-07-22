<script lang="ts">
    import Modal from "@/components/Modal.svelte";
    import { appendGameCommands } from "@/lib/game/appendCommand";
    import { fixedDiceRolls, SeededDice } from "@/lib/game/dice";
    import { phaseName } from "@/lib/game/phase";
    import { buildAllThresholdResolveCommands, thresholdDiceCount } from "@/lib/game/thresholdSystems";
    import { currentState } from "@/stores/derivedState";
    import type { GameMeta } from "@/lib/game/types";
    import { toast } from "@zerodevx/svelte-toast";

    export let meta: GameMeta;
    export let onClose: () => void;

    let diceSeq = "";
    let expandedShip = "";

    $: position =
        $currentState.state ?? { map: { mode: "fixed", width: 72, height: 48 }, objects: [] };
    $: summary = thresholdDiceCount(position, meta);
    $: totalDice = summary.total;

    const rollDice = () => {
        const n = Math.max(0, Math.min(120, totalDice));
        if (n === 0) {
            toast.push("No dice needed");
            return;
        }
        const rng = new SeededDice();
        diceSeq = Array.from({ length: n }, () => rng.next()).join(", ");
    };

    const resolve = () => {
        if (summary.checks.length === 0) {
            onClose();
            return;
        }
        try {
            const { rolls } = fixedDiceRolls(diceSeq, totalDice, meta.dicePolicy, {
                seed: meta.diceSeed,
            });
            if (!diceSeq.trim()) {
                diceSeq = rolls.join(", ");
            }
            const cmds = buildAllThresholdResolveCommands(position, meta, rolls);
            appendGameCommands(cmds, true);
            toast.push(`Resolved threshold checks (${rolls.length} dice)`);
            onClose();
        } catch (e) {
            toast.push(e instanceof Error ? e.message : "Could not resolve threshold checks");
        }
    };

    const toggleShip = (shipId: string) => {
        expandedShip = expandedShip === shipId ? "" : shipId;
    };

    $: modalButtons = summary.checks.length
        ? [
              { label: "Skip", action: onClose },
              { label: "Roll dice", action: rollDice, class: "is-light" },
              { label: "Resolve", action: resolve, class: "is-info" },
          ]
        : [{ label: "Close", action: onClose }];
</script>

<Modal
    title="Phase 13: {phaseName(13)} — hull thresholds"
    buttons={modalButtons}
>
    {#if summary.checks.length === 0}
        <p class="notification is-light">No pending threshold checks — advance phase.</p>
    {:else}
        <p class="help mb-3">
            Roll one d6 per system target (and invader) for each pending hull row check, plus one
            extra d6 per operational sensor module (+1 fragility on each sensor die). Dice are
            consumed in ship order, then check order, then target order, then sensor order. If an
            AMT rack fails, also roll 1d6 hull-only to the carrier and 1d6 per other unit within
            1 MU (no screens/armour) — those dice are taken from the end of the sequence or
            auto-rolled.
        </p>
        <table class="table is-narrow is-fullwidth is-size-7">
            <thead>
                <tr>
                    <th>Ship</th>
                    <th>Row</th>
                    <th>Fail on</th>
                    <th>Roll bonus</th>
                    <th>System dice</th>
                    <th>Sensor dice</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
                {#each summary.checks as row}
                    <tr>
                        <td>{row.shipId}</td>
                        <td>{row.thresholdIndex}</td>
                        <td>{row.failOn}+</td>
                        <td>{row.rollBonus > 0 ? `+${row.rollBonus}` : "—"}</td>
                        <td>{row.systemDice}</td>
                        <td>{row.sensorDice > 0 ? row.sensorDice : "—"}</td>
                        <td>
                            <button
                                type="button"
                                class="button is-small is-light"
                                on:click={() => toggleShip(`${row.shipId}-${row.thresholdIndex}`)}
                            >
                                {expandedShip === `${row.shipId}-${row.thresholdIndex}`
                                    ? "Hide"
                                    : "Targets"}
                            </button>
                        </td>
                    </tr>
                    {#if expandedShip === `${row.shipId}-${row.thresholdIndex}`}
                        <tr>
                            <td colspan="7" class="is-size-7">
                                {row.targets.map((t) => t.label).join(", ")}
                            </td>
                        </tr>
                    {/if}
                {/each}
            </tbody>
        </table>
        <p class="mb-3"><strong>Total dice: {totalDice}</strong></p>

        <div class="field is-grouped">
            <div class="control">
                <button type="button" class="button is-light" on:click={rollDice}>
                    Roll {totalDice} dice
                </button>
            </div>
        </div>

        <div class="field">
            <label class="label" for="diceSeq">Dice sequence (optional)</label>
            <input
                id="diceSeq"
                class="input"
                bind:value={diceSeq}
                placeholder="Leave empty to auto-roll on demand"
            />
            <p class="help is-size-7">
                Leave empty and click Resolve to roll on demand, or paste a moderator dice string.
            </p>
        </div>
    {/if}
</Modal>
