<script lang="ts">
    import { toast } from "@zerodevx/svelte-toast";
    import { initialState } from "@/stores/writeInitialState";

    const colours = ["#e41a1c", "#377eb8", "#4daf4a", "#ffff33", "#984ea3", "#ff7f00", "#a65628", "#f781bf", "#999999"];
    const coloursCB = ["#ddcc77", "#cc6677", "#aa4499", "#882255", "#332288", "#117733", "#44aa99", "#88ccee"];

    interface IPlayer {
        id: string;
        colour: string;
        vp: number;
        [k: string]: unknown;
    }
    let players: [IPlayer, ...IPlayer[]] = [
        {
            id: "Player 1",
            colour: colours[0],
            vp: 0
        }
    ];
    const reColour = /^#[A-Fa-f0-9]{6}$/;

    const addPlayer = () => {
        const node = {
            id: `Player ${players.length + 1}`,
            colour: "",
            vp: 0
        };
        if (players.length < colours.length) {
            node.colour = colours[players.length];
        }
        players.push(node);
        players = players;
    }

    const delPlayer = (i: number) => {
        if (players.length > 1) {
            players.splice(i, 1);
            players = players;
        } else {
            toast.push("There must be at least one player")
        }
    }

    let dupeNames: boolean;
    $: dupeNames = new Set<string>([...players.map(p => p.id)]).size !== players.length;
    let dupeColours: boolean;
    $: dupeColours = new Set<string>([...players.map(p => p.colour)]).size !== players.length;
    let validColours: boolean;
    $: validColours = [...players.map(p => reColour.test(p.colour))].reduce((prev, curr) => prev && curr, true);

    const savePlayers = () => {
        if (dupeNames || dupeColours || !validColours) {
            toast.push("Resolve all errors before saving players");
        } else if (players.length < 1) {
            toast.push("You must define at least one player");
        } else {
            $initialState.players = players;
            $initialState = $initialState;
        }
    }
</script>

<div class="content">
    <p>Define any participating players, including NPCs (owned by a moderator or preset AI). Each player needs a unique name and colour. Players cannot be easily changed once the game starts.</p>
</div>

{#each players as p, i}
<div class="columns">
    <div class="column">
        <div class="field">
            <label class="label" for={`pname${i}`}>Name</label>
            <div class="control">
                <input class="input" type="text" name={`pname${i}`} bind:value={players[i].id}>
            </div>
            <p class="help">May contain spaces and any other UTF-8 special characters</p>
        </div>
    </div>
    <div class="column">
        <div class="field">
            <label class="label" for={`pcolour${i}`}>Colour</label>
            <div class="control">
                <input class="input" type="text" name={`pcolour${i}`} bind:value={players[i].colour}>
            </div>
        {#if ! reColour.test(players[i].colour)}
            <p class="help is-danger">The colour must be a valid hexadecimal colour string (e.g., "#ff0000")</p>
        {:else}
            <p class="help" style={`width: 100%; background-color: ${players[i].colour}`}>&nbsp;</p>
        {/if}
        </div>
    </div>
    <div class="column">
        <div class="field">
            <!-- svelte-ignore a11y-label-has-associated-control -->
            <label class="label">&nbsp;</label>
            <div class="control">
                <button class="button is-danger" on:click={() => delPlayer(i)}>
                    <span class="icon" title="Delete player">
                        <i class="fa-solid fa-trash"></i>
                    </span>
                </button>
            </div>
        </div>
    </div>
</div>
{/each}

<div class="columns">
    <div class="column">
        <div class="field">
            <div class="control">
                <button class="button is-success" on:click={addPlayer}>Add player</button>
            </div>
        {#if dupeNames}
            <p class="help is-danger">Player names must be unique</p>
        {/if}
        {#if !validColours}
            <p class="help is-danger">Not all the colours are valid</p>
        {/if}
        {#if dupeColours}
            <p class="help is-danger">Each colour must be unique</p>
        {/if}
        </div>
    </div>
    <div class="column" style="text-align: right">
        <div class="field">
            <div class="control">
                <button class="button is-primary" disabled={dupeNames || dupeColours || !validColours} on:click={savePlayers}>Save players</button>
            </div>
        </div>
    </div>
</div>


<style>
</style>
