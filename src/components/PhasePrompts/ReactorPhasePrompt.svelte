<script lang="ts">
    import Modal from "@/components/Modal.svelte";
    import { appendGameCommands } from "@/lib/game/appendCommand";
    import {
        buildReactorResolveCommands,
        reactorDiceCount,
        reactorExplosionThreshold,
        shipIsAbandoned,
        shipsNeedingReactorRoll,
        type CoreState,
    } from "@/lib/game/coreSystems";
    import { fixedDiceRolls, policyRollSource } from "@/lib/game/dice";
    import { phaseName } from "@/lib/game/phase";
    import { reactorBreachesEnabled } from "@/lib/game/types";
    import { currentState } from "@/stores/derivedState";
    import { gameMeta } from "@/stores/writeGameMeta";
    import type { GameMeta } from "@/lib/game/types";
    import { toast } from "@zerodevx/svelte-toast";

    export let meta: GameMeta;
    export let onClose: () => void;

    let diceSeq = "";

    $: position =
        $currentState.state ?? { map: { mode: "fixed", width: 72, height: 48 }, objects: [] };
    $: gameMetaForCore = { ...$gameMeta, ...meta };
    $: shipIds = shipsNeedingReactorRoll(position, gameMetaForCore);
    $: totalDice = reactorDiceCount(position, gameMetaForCore);
    $: breachesOn = reactorBreachesEnabled(gameMetaForCore);

    type ShipRow = {
        id: string;
        owner: string;
        abandoned: boolean;
        threshold: number;
    };

    $: shipRows = shipIds.map((id): ShipRow => {
        const ship = position.objects?.find((o) => o.objType === "ship" && o.id === id) as
            | { owner?: string; coreState?: CoreState }
            | undefined;
        const core = ship?.coreState;
        return {
            id,
            owner: ship?.owner ?? "—",
            abandoned: shipIsAbandoned(core),
            threshold: reactorExplosionThreshold(core, gameMetaForCore.turn),
        };
    });

    const rollDice = () => {
        const n = Math.max(0, Math.min(120, totalDice));
        if (n === 0) {
            toast.push("No dice needed");
            return;
        }
        const { rolls } = fixedDiceRolls(diceSeq, n, gameMetaForCore.dicePolicy, {
            seed: gameMetaForCore.diceSeed,
        });
        diceSeq = rolls.join(", ");
    };

    const resolve = () => {
        if (shipIds.length === 0) {
            onClose();
            return;
        }
        try {
            const { rolls } = fixedDiceRolls(
                diceSeq,
                totalDice,
                gameMetaForCore.dicePolicy,
                { seed: gameMetaForCore.diceSeed }
            );
            if (!diceSeq.trim()) {
                diceSeq = rolls.join(", ");
            }
            const extraDice = policyRollSource(gameMetaForCore.dicePolicy, {
                seed: gameMetaForCore.diceSeed,
            });
            const cmds = buildReactorResolveCommands(
                position,
                gameMetaForCore,
                rolls,
                extraDice
            );
            appendGameCommands(cmds, true);
            toast.push(`Resolved reactor breaches (${rolls.length} reactor dice)`);
            onClose();
        } catch (e) {
            toast.push(e instanceof Error ? e.message : "Could not resolve reactor breaches");
        }
    };

    $: modalButtons = shipIds.length
        ? [
              { label: "Skip", action: onClose },
              { label: "Roll dice", action: rollDice, class: "is-light" },
              { label: "Resolve reactor breaches", action: resolve, class: "is-info" },
          ]
        : [{ label: "Close", action: onClose }];
</script>

<Modal title="Phase 15: {phaseName(15)}" buttons={modalButtons}>
    {#if shipIds.length === 0}
        <p class="notification is-light">No unstable reactors — advance phase.</p>
    {:else}
        <div class="notification is-info is-light mb-3">
            <p class="mb-2">
                Ask each affected player whether to <strong>dump reactor</strong>,
                <strong>abandon ship</strong>, or <strong>hold</strong>. Apply their choice on
                the Moderator tab (<code>setCoreState</code>) before resolving.
            </p>
            <p class="mb-0 is-size-7">
                Phase 14 DCP can stabilize a reactor only before abandon — once abandoned, no
                further reactor repair is possible. Breach damage applies immediately; hull-row
                crossings become pending thresholds for phase 13 next turn.
            </p>
        </div>
        {#if breachesOn}
            <p class="help mb-3">
                Reactor breach area damage: within 3 MU, SAP damage = sum of
                <em>floor(mass ÷ 25)</em> d6 per target (standard screens ignored; advanced
                screens apply per die).
            </p>
        {/if}

        <table class="table is-narrow is-size-7 mb-3">
            <thead>
                <tr>
                    <th>Ship</th>
                    <th>Owner</th>
                    <th>Abandoned?</th>
                    <th>Explode on</th>
                </tr>
            </thead>
            <tbody>
                {#each shipRows as row}
                    <tr>
                        <td>{row.id}</td>
                        <td>{row.owner}</td>
                        <td>{row.abandoned ? "Yes" : "No"}</td>
                        <td>{row.threshold}+</td>
                    </tr>
                {/each}
            </tbody>
        </table>

        <p class="mb-3"><strong>Reactor dice: {totalDice}</strong> (1d6 per unstable ship)</p>

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
                Paste moderator dice for reactor rolls only; breach dice roll automatically if
                needed.
            </p>
        </div>
    {/if}
</Modal>
