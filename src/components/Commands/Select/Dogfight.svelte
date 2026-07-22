<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { currentState } from "@/stores/derivedState";
    import { gameMeta } from "@/stores/writeGameMeta";
    import { resolveDogfightSide, resolveDogfightSideFromRolls } from "@/lib/game/fighters";
    import { formatDogfightResultNotes, makeLogDice } from "@/lib/game/rollResults";
    import { parseDiceString, policyRollSource } from "@/lib/game/dice";
    import { appendGameCommands } from "@/lib/game/appendCommand";
    import type { FullThrustGameCommand } from "@/schemas/commands";
    import { toast } from "@zerodevx/svelte-toast";
    import { userSettings } from "@/stores/writeUserSettings";
    import { fighterGroupOptionLabel } from "@/lib/game/fighterLabel";
    import { focusMapOnFightersId } from "@/lib/actMapInteraction";

    const dispatch = createEventDispatcher();

    $: fighters =
        $currentState.state?.objects?.filter((o) => o.objType === "fighters") ?? [];

    let aId = "";
    let bId = "";
    let diceOverride = "";
    let prevAId = "";
    let prevBId = "";

    $: mapObjects = ($currentState.state?.objects ?? []) as import("@/schemas/position").FullThrustGameObjects[];

    $: if (aId && aId !== prevAId) {
        prevAId = aId;
        focusMapOnFightersId(aId, mapObjects);
    }
    $: if (bId && bId !== prevBId) {
        prevBId = bId;
        focusMapOnFightersId(bId, mapObjects);
    }

    $: groupA = fighters.find((f) => f.id === aId);
    $: groupB = fighters.find((f) => f.id === bId);

    const resolve = () => {
        if (!groupA || !groupB || aId === bId) {
            toast.push("Select two different fighter groups");
            return;
        }
        const nA = Number(groupA.number ?? 6) || 0;
        const nB = Number(groupB.number ?? 6) || 0;
        const meta = $currentState.meta ?? $gameMeta;
        let rolls: number[];
        let sideA: ReturnType<typeof resolveDogfightSideFromRolls>;
        let sideB: ReturnType<typeof resolveDogfightSideFromRolls>;
        try {
            if (diceOverride.trim()) {
                rolls = parseDiceString(diceOverride);
                sideA = resolveDogfightSideFromRolls(nA, rolls, 0);
                sideB = resolveDogfightSideFromRolls(nB, rolls, sideA.nextIndex);
            } else {
                const source = policyRollSource(meta.dicePolicy, { seed: meta.diceSeed });
                sideA = { result: resolveDogfightSide(nA, source).result, nextIndex: source.consumed().length };
                sideB = {
                    result: resolveDogfightSide(nB, source).result,
                    nextIndex: source.consumed().length,
                };
                rolls = source.consumed();
            }
        } catch (e) {
            toast.push(e instanceof Error ? e.message : "Dice error");
            return;
        }

        const afterB = Math.max(0, nB - sideA.result.killsDealt);
        const afterA = Math.max(0, nA - sideB.result.killsDealt);

        const resultNotes = formatDogfightResultNotes(
            aId,
            bId,
            nA,
            nB,
            sideA.result.killsDealt,
            sideB.result.killsDealt
        );

        const cmds: FullThrustGameCommand[] = [
            makeLogDice({
                purpose: `dogfight ${aId} vs ${bId}`,
                rolls: rolls.slice(0, sideB.nextIndex),
                source: diceOverride.trim() ? "moderatorSequence" : "client",
                result: resultNotes,
            }),
            {
                name: "_custom",
                msg: `Dogfight: ${resultNotes}`,
            } as FullThrustGameCommand,
            {
                name: "adjustFighters",
                id: aId,
                number: afterA,
            } as FullThrustGameCommand,
            {
                name: "adjustFighters",
                id: bId,
                number: afterB,
            } as FullThrustGameCommand,
        ];
        if (afterA === 0) cmds.push({ name: "objDestroy", uuid: aId } as FullThrustGameCommand);
        if (afterB === 0) cmds.push({ name: "objDestroy", uuid: bId } as FullThrustGameCommand);

        appendGameCommands(cmds, ($userSettings.role ?? "player") === "moderator");
        toast.push(`Dogfight resolved: ${afterA} vs ${afterB}`);
        dispatch("done");
    };
</script>

<p class="help">Simultaneous dogfight: each fighter rolls one die (4–5 = 1 kill, 6 = 2 + reroll).</p>

<div class="field">
    <label class="label" for="a">Group A</label>
    <div class="select">
        <select id="a" bind:value={aId}>
            <option value="">--</option>
            {#each fighters as f}
                <option value={f.id}>{fighterGroupOptionLabel(f)}</option>
            {/each}
        </select>
    </div>
</div>
<div class="field">
    <label class="label" for="b">Group B</label>
    <div class="select">
        <select id="b" bind:value={bId}>
            <option value="">--</option>
            {#each fighters as f}
                <option value={f.id}>{fighterGroupOptionLabel(f)}</option>
            {/each}
        </select>
    </div>
</div>
<div class="field">
    <label class="label" for="dice">Dice override</label>
    <input id="dice" class="input" bind:value={diceOverride} placeholder="Leave empty to auto-roll on demand" />
</div>
<button class="button is-primary" on:click={resolve}>Resolve dogfight</button>
