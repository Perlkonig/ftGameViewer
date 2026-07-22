<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { currentState } from "@/stores/derivedState";
    import { appendGameCommand } from "@/lib/game/appendCommand";
    import type { FullThrustGameCommand } from "@/schemas/commands";
    import { toast } from "@zerodevx/svelte-toast";
    import { fighterGroupOptionLabel } from "@/lib/game/fighterLabel";
    import { focusMapOnFightersId, focusMapOnShipId } from "@/lib/actMapInteraction";

    const dispatch = createEventDispatcher();

    $: fighters =
        $currentState.state?.objects?.filter((o) => o.objType === "fighters") ?? [];
    $: ships =
        $currentState.state?.objects?.filter((o) => o.objType === "ship") ?? [];

    let fighterId = "";
    let number = 6;
    let endurance = 6;
    let skill: "standard" | "ace" | "turkey" = "standard";
    let hangarShip = "";
    let hangarId = "";
    let prevFighterId = "";
    let prevHangarShip = "";

    $: if (hangarShip && hangarShip !== prevHangarShip) {
        prevHangarShip = hangarShip;
        focusMapOnShipId(hangarShip, ships as import("@/schemas/position").FullThrustGameObjects[]);
    }
    $: if (fighterId && fighterId !== prevFighterId) {
        prevFighterId = fighterId;
        focusMapOnFightersId(
            fighterId,
            fighters as import("@/schemas/position").FullThrustGameObjects[]
        );
    }

    $: selected = fighters.find((f) => f.id === fighterId);

    const onFighterPick = () => {
        if (!selected) return;
        number = selected.number ?? 6;
        endurance = selected.endurance ?? 6;
        skill = (selected.skill as typeof skill) ?? "standard";
    };

    const adjust = () => {
        if (!fighterId) {
            toast.push("Select fighters");
            return;
        }
        appendGameCommand({
            name: "adjustFighters",
            id: fighterId,
            number,
            endurance,
            skill,
        } as FullThrustGameCommand);
        toast.push("Fighters adjusted");
        dispatch("done");
    };

    const recover = () => {
        if (!fighterId || !hangarShip) {
            toast.push("Select fighters and carrier ship");
            return;
        }
        appendGameCommand({
            name: "moveFighters",
            id: fighterId,
            position: { ship: hangarShip, hangar: hangarId || "1" },
            distanceMu: 0,
        } as FullThrustGameCommand);
        appendGameCommand({
            name: "adjustFighters",
            id: fighterId,
            endurance: 6,
        } as FullThrustGameCommand);
        toast.push("Fighters recovered to hangar");
        dispatch("done");
    };
</script>

<div class="field">
    <label class="label" for="f">Fighter group</label>
    <div class="select">
        <select id="f" bind:value={fighterId} on:change={onFighterPick}>
            <option value="">--</option>
            {#each fighters as f}
                <option value={f.id}>{fighterGroupOptionLabel(f)}</option>
            {/each}
        </select>
    </div>
</div>
<div class="field">
    <label class="label" for="n">Number</label>
    <input id="n" class="input" type="number" min="0" max="12" bind:value={number} />
</div>
<div class="field">
    <label class="label" for="e">Endurance</label>
    <input id="e" class="input" type="number" min="0" bind:value={endurance} />
</div>
<div class="field">
    <label class="label" for="sk">Skill</label>
    <div class="select">
        <select id="sk" bind:value={skill}>
            <option value="standard">standard</option>
            <option value="ace">ace</option>
            <option value="turkey">turkey</option>
        </select>
    </div>
</div>
<button class="button is-primary" on:click={adjust}>Apply adjust</button>

<hr />
<h3 class="title is-6">Recover to hangar</h3>
<div class="field">
    <label class="label" for="hs">Carrier ship</label>
    <div class="select">
        <select id="hs" bind:value={hangarShip}>
            <option value="">--</option>
            {#each ships as s}
                <option value={s.id}>{s.id}</option>
            {/each}
        </select>
    </div>
</div>
<div class="field">
    <label class="label" for="hid">Hangar id</label>
    <input id="hid" class="input" bind:value={hangarId} placeholder="1" />
</div>
<button class="button" on:click={recover}>Recover</button>
