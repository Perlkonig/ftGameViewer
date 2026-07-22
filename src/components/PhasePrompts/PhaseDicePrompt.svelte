<script lang="ts">
    import Modal from "@/components/Modal.svelte";
    import { appendGameCommand } from "@/lib/game/appendCommand";
    import { fixedDiceRolls, SeededDice } from "@/lib/game/dice";
    import { makeLogDice } from "@/lib/game/rollResults";
    import { phaseName, suggestedDiceCount } from "@/lib/game/phase";
    import type { GamePhase } from "@/lib/game/types";
    import type { FullThrustGameCommand } from "@/schemas/commands";
    import { gameMeta } from "@/stores/writeGameMeta";
    import { toast } from "@zerodevx/svelte-toast";

    export let phase: GamePhase;
    export let onClose: () => void;

    let diceSeq = "";
    let rollCount = suggestedDiceCount(phase);

    $: purpose = `Phase ${phase}: ${phaseName(phase)}`;

    const rollDice = () => {
        const n = Math.max(1, Math.min(120, Math.round(Number(rollCount) || 12)));
        const rng = new SeededDice();
        diceSeq = Array.from({ length: n }, () => rng.next()).join(", ");
    };

    const apply = () => {
        try {
            const count = Math.max(1, Math.min(120, Math.round(Number(rollCount) || 12)));
            const gm = $gameMeta;
            const { rolls, source } = fixedDiceRolls(diceSeq, count, gm.dicePolicy, {
                seed: gm.diceSeed,
            });
            if (!diceSeq.trim()) {
                diceSeq = rolls.join(", ");
            }
            appendGameCommand(
                makeLogDice({
                    purpose,
                    rolls,
                    source,
                    result: `Logged ${rolls.length} dice`,
                }),
                true
            );
            toast.push(`Logged ${rolls.length} dice for ${phaseName(phase)}`);
            onClose();
        } catch (e) {
            toast.push(e instanceof Error ? e.message : "Could not log dice");
        }
    };
</script>

<Modal
    title="Dice — Phase {phase}: {phaseName(phase)}"
    buttons={[
        { label: "Skip", action: onClose },
        { label: "Roll dice", action: rollDice, class: "is-light" },
        { label: "Log dice", action: apply, class: "is-info" },
    ]}
>
    <p class="help mb-3">
        Enter the moderator dice sequence for this phase, or let the system roll for you.
        Individual Act helpers can still override dice per resolution.
    </p>

    <div class="field">
        <label class="label" for="purpose">Purpose</label>
        <input id="purpose" class="input" value={purpose} readonly />
    </div>

    <div class="field is-grouped">
        <div class="control">
            <label class="label" for="count">Dice to roll</label>
            <input
                id="count"
                class="input"
                type="number"
                min="1"
                max="120"
                bind:value={rollCount}
            />
        </div>
        <div class="control">
            <label class="label">&nbsp;</label>
            <button type="button" class="button is-light" on:click={rollDice}>
                Roll {rollCount || suggestedDiceCount(phase)} dice
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
            Leave empty and click Log dice to roll the count above on demand, or paste a moderator
            dice string.
        </p>
    </div>
</Modal>
