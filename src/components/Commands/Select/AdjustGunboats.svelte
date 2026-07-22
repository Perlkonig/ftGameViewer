<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { currentState } from "@/stores/derivedState";
    import { appendGameCommand } from "@/lib/game/appendCommand";
    import type { FullThrustGameCommand } from "@/schemas/commands";
    import { toast } from "@zerodevx/svelte-toast";
    import { gunboatGroupOptionLabel } from "@/lib/game/gunboatLabel";
    import { deployedGunboatsForOwner } from "@/lib/game/gunboatMove";
    import { gameMeta } from "@/stores/writeGameMeta";

    const dispatch = createEventDispatcher();

    $: playerId = $currentState.state?.players?.[0]?.id ?? "";
    $: gunboats = playerId
        ? deployedGunboatsForOwner($currentState.state!, playerId)
        : [];

    let squadronId = "";
    let number = 6;
    let endurance = 6;

    const adjust = () => {
        if (!squadronId) return;
        appendGameCommand({
            name: "adjustGunboats",
            id: squadronId,
            number,
            endurance,
        } as FullThrustGameCommand);
        toast.push("Gunboats adjusted");
        dispatch("done");
    };

    const recoverRack = () => {
        if (!squadronId || !hangarShip || !rackId) {
            toast.push("Select squadron, ship, and rack");
            return;
        }
        appendGameCommand({
            name: "moveGunboats",
            id: squadronId,
            position: { ship: hangarShip, rack: rackId },
            distanceMu: 0,
        } as FullThrustGameCommand);
        toast.push("Recovered to rack (endurance unchanged)");
        dispatch("done");
    };

    const recoverBay = () => {
        if (!squadronId || !hangarShip || !bayId) {
            toast.push("Select squadron, ship, and bay");
            return;
        }
        appendGameCommand({
            name: "moveGunboats",
            id: squadronId,
            position: { ship: hangarShip, bay: bayId },
            distanceMu: 0,
            recoverEndurance: 6,
        } as FullThrustGameCommand);
        appendGameCommand({
            name: "adjustGunboats",
            id: squadronId,
            endurance: 6,
        } as FullThrustGameCommand);
        toast.push("Recovered to boat bay (endurance 6)");
        dispatch("done");
    };

    let hangarShip = "";
    let rackId = "";
    let bayId = "";
</script>

<h3 class="title is-6">Adjust / recover gunboats</h3>
<select bind:value={squadronId}>
    <option value="">Squadron</option>
    {#each gunboats as g}
        <option value={g.id}>{gunboatGroupOptionLabel(g)}</option>
    {/each}
</select>
<label>Number <input type="number" bind:value={number} min="0" max="6" /></label>
<label>Endurance <input type="number" bind:value={endurance} min="0" max="6" /></label>
<button class="button" on:click={adjust}>Adjust</button>

<h4 class="title is-6">Recover</h4>
<input class="input" placeholder="Carrier ship id" bind:value={hangarShip} />
<input class="input" placeholder="Rack id" bind:value={rackId} />
<button class="button" on:click={recoverRack}>To rack</button>
<input class="input" placeholder="Bay id" bind:value={bayId} />
<button class="button" on:click={recoverBay}>To boat bay</button>
