<script lang="ts">
    import Modal from "@/components/Modal.svelte";
    import { appendGameCommand } from "@/lib/game/appendCommand";
    import { createDiceFromPolicy, SeededDice } from "@/lib/game/dice";
    import type { FullThrustGameCommand } from "@/schemas/commands";
    import { gameMeta } from "@/stores/writeGameMeta";
    import { toast } from "@zerodevx/svelte-toast";

    export let players: { id: string }[] = [];
    export let onClose: () => void;

    let winner = "";
    let playerRolls: Record<string, number | ""> = {};

    $: rollEntries = players.map((p) => ({
        player: p.id,
        roll: playerRolls[p.id],
    }));

    $: numericRolls = rollEntries
        .filter((e) => typeof e.roll === "number")
        .map((e) => ({ player: e.player, roll: e.roll as number }));

    $: autoWinner =
        numericRolls.length > 0
            ? [...numericRolls].sort((a, b) => b.roll - a.roll)[0]?.player ?? ""
            : "";

    $: displayWinner = winner || autoWinner;

    const rollOne = (playerId: string) => {
        playerRolls = { ...playerRolls, [playerId]: new SeededDice().next() };
    };

    const rollAll = () => {
        const rng = new SeededDice();
        const next: Record<string, number> = {};
        for (const p of players) {
            next[p.id] = rng.next();
        }
        playerRolls = next;
    };

    const apply = () => {
        try {
            if (players.length === 0) {
                throw new Error("No players in game");
            }
            const gm = $gameMeta;
            const dice = createDiceFromPolicy(gm.dicePolicy, { seed: gm.diceSeed });
            const nextRolls: Record<string, number> = {};
            for (const p of players) {
                const roll = playerRolls[p.id];
                if (typeof roll === "number" && roll >= 1 && roll <= 6) {
                    nextRolls[p.id] = roll;
                } else {
                    nextRolls[p.id] = dice.roll(1).rolls[0];
                }
            }
            playerRolls = nextRolls;
            const rolls = players.map((p) => ({ player: p.id, roll: nextRolls[p.id] }));
            const w =
                winner ||
                [...rolls].sort((a, b) => b.roll - a.roll)[0]?.player ||
                "";
            if (!w) throw new Error("Select initiative winner");
            if (!players.some((p) => p.id === w)) {
                throw new Error(`Winner must be one of: ${players.map((p) => p.id).join(", ")}`);
            }
            appendGameCommand(
                {
                    name: "setInitiative",
                    rolls,
                    winner: w,
                } as FullThrustGameCommand,
                true
            );
            toast.push(`Initiative set; winner ${w}`);
            onClose();
        } catch (e) {
            toast.push(e instanceof Error ? e.message : "Initiative failed");
        }
    };
</script>

<Modal
    title="Initiative — Phase 1"
    buttons={[
        { label: "Skip", action: onClose },
        { label: "Roll all", action: rollAll, class: "is-light" },
        { label: "Set initiative", action: apply, class: "is-info" },
    ]}
>
    <p class="help mb-3">
        Roll one d6 per player, enter rolls manually, or leave fields empty and click Set
        initiative to auto-roll any missing values. Highest roll wins unless overridden below.
    </p>

    <table class="table is-fullwidth is-size-7">
        <thead>
            <tr>
                <th>Player</th>
                <th>Roll</th>
                <th></th>
            </tr>
        </thead>
        <tbody>
            {#each players as p}
                <tr class:has-background-info-light={displayWinner === p.id}>
                    <td><strong>{p.id}</strong></td>
                    <td>
                        <input
                            class="input is-small"
                            type="number"
                            min="1"
                            max="6"
                            placeholder="empty = auto-roll"
                            value={playerRolls[p.id] ?? ""}
                            on:input={(e) => {
                                const v = (e.currentTarget as HTMLInputElement).value;
                                playerRolls = {
                                    ...playerRolls,
                                    [p.id]: v === "" ? "" : Number(v),
                                };
                            }}
                        />
                    </td>
                    <td>
                        <button
                            type="button"
                            class="button is-small"
                            on:click={() => rollOne(p.id)}
                        >
                            Roll
                        </button>
                    </td>
                </tr>
            {/each}
        </tbody>
    </table>

    <div class="field mt-3">
        <label class="label" for="winner">Initiative winner</label>
        <div class="select">
            <select id="winner" bind:value={winner}>
                <option value="">{autoWinner ? `auto: ${autoWinner}` : "select winner"}</option>
                {#each players as p}
                    <option value={p.id}>{p.id}</option>
                {/each}
            </select>
        </div>
    </div>
</Modal>
