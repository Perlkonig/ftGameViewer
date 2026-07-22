<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { toast } from "@zerodevx/svelte-toast";
    import type { DicePolicy } from "@/lib/game/types";
    import type { FleetLimit } from "@/lib/game/types";
    import {
        createNewPackage,
        PLAYER_COLOURS,
        validatePlayers,
        type GamePlayer,
        type GameMap,
        type GamePackage,
    } from "@/lib/game/package";

    const dispatch = createEventDispatcher<{ created: GamePackage; cancel: void }>();

    let name = "New Game";
    let dicePolicy: DicePolicy = "hybrid";
    let mapMode: "fixed" | "fluid" = "fixed";
    let mapWidth = 72;
    let mapHeight = 48;
    let mapBuffer = 12;

    let players: GamePlayer[] = [
        { id: "Player 1", colour: PLAYER_COLOURS[0], vp: 0 },
        { id: "Player 2", colour: PLAYER_COLOURS[1], vp: 0 },
    ];

    let fleetEnabled = false;
    let fleetByPlayer: Record<string, { maxPoints: string; maxShips: string; notes: string }> =
        {};
    const ensureFleetRow = (id: string) => {
        if (!fleetByPlayer[id]) {
            fleetByPlayer[id] = { maxPoints: "", maxShips: "", notes: "" };
        }
    };

    $: for (const p of players) ensureFleetRow(p.id);

    const addPlayer = () => {
        const idx = players.length;
        players = [
            ...players,
            {
                id: `Player ${idx + 1}`,
                colour: PLAYER_COLOURS[idx % PLAYER_COLOURS.length] ?? "#999999",
                vp: 0,
            },
        ];
    };

    const removePlayer = (i: number) => {
        if (players.length <= 1) {
            toast.push("There must be at least one player");
            return;
        }
        players = players.filter((_, j) => j !== i);
    };

    const buildMap = (): GameMap => {
        if (mapMode === "fluid") {
            return {
                mode: "fluid",
                width: Math.max(1, Math.round(mapWidth)),
                height: Math.max(1, Math.round(mapHeight)),
                buffer: Math.max(0, Math.min(48, Math.round(mapBuffer))),
            };
        }
        return {
            mode: "fixed",
            width: Math.max(1, Math.round(mapWidth)),
            height: Math.max(1, Math.round(mapHeight)),
        };
    };

    let allowVectorMovement = false;
    let includeCoreSystemsInThreshold = true;
    let reactorBreachesEnabled = true;

    const buildFleetLimits = (): FleetLimit[] | undefined => {
        if (!fleetEnabled) return undefined;
        const limits: FleetLimit[] = [];
        for (const p of players) {
            const row = fleetByPlayer[p.id];
            if (!row) continue;
            const maxPoints = row.maxPoints.trim() ? Number(row.maxPoints) : undefined;
            const maxShips = row.maxShips.trim() ? Number(row.maxShips) : undefined;
            const notes = row.notes.trim() || undefined;
            if (maxPoints !== undefined || maxShips !== undefined || notes) {
                limits.push({
                    playerId: p.id,
                    maxPoints: Number.isFinite(maxPoints) ? maxPoints : undefined,
                    maxShips: Number.isFinite(maxShips) ? maxShips : undefined,
                    notes,
                });
            }
        }
        return limits.length ? limits : undefined;
    };

    const create = () => {
        const err = validatePlayers(players);
        if (err) {
            toast.push(err);
            return;
        }
        const pkg = createNewPackage({
            name: name.trim() || "New Game",
            dicePolicy,
            map: buildMap(),
            players: players.map((p) => ({ ...p, id: p.id.trim() })),
            fleetLimits: buildFleetLimits(),
            allowVectorMovement,
            includeCoreSystemsInThreshold,
            reactorBreachesEnabled,
        });
        dispatch("created", pkg);
    };

    const cancel = () => dispatch("cancel");
</script>

<div class="new-game box">
    <h2 class="title is-5">Start a new game</h2>
    <p class="help mb-4">
        Define the game name, dice policy, table map, and players in one step. Export the
        game when ready to send to players.
    </p>

    <div class="field">
        <label class="label" for="gameName">Game name</label>
        <input id="gameName" class="input" bind:value={name} />
    </div>

    <div class="field">
        <label class="label" for="dicePolicy">Dice policy</label>
        <div class="select">
            <select id="dicePolicy" bind:value={dicePolicy}>
                <option value="hybrid">Hybrid (sequence if provided, else client)</option>
                <option value="client">Client PRNG</option>
                <option value="moderatorSequence">Moderator sequence only</option>
            </select>
        </div>
    </div>

    <div class="field">
        <label class="checkbox">
            <input type="checkbox" bind:checked={allowVectorMovement} />
            Allow vector movement (players opt in per ship at placement; fixed thereafter)
        </label>
    </div>

    <div class="field">
        <label class="checkbox">
            <input type="checkbox" bind:checked={includeCoreSystemsInThreshold} />
            Include core systems in threshold checks (bridge, life support, reactor)
        </label>
    </div>

    <div class="field">
        <label class="checkbox">
            <input type="checkbox" bind:checked={reactorBreachesEnabled} disabled={!includeCoreSystemsInThreshold} />
            Reactor breach area damage (3 MU SAP blast on reactor explosion)
        </label>
    </div>

    <h3 class="title is-6 mt-4">Map</h3>
    <div class="field">
        <label class="radio">
            <input type="radio" bind:group={mapMode} value="fixed" />
            Fixed table
        </label>
        <label class="radio ml-3">
            <input type="radio" bind:group={mapMode} value="fluid" />
            Fluid (grows with objects)
        </label>
    </div>
    {#if mapMode === "fixed"}
        <div class="columns">
            <div class="column">
                <label class="label" for="mapW">Width (MU)</label>
                <input
                    id="mapW"
                    class="input"
                    type="number"
                    min="1"
                    step="1"
                    bind:value={mapWidth}
                />
            </div>
            <div class="column">
                <label class="label" for="mapH">Height (MU)</label>
                <input
                    id="mapH"
                    class="input"
                    type="number"
                    min="1"
                    step="1"
                    bind:value={mapHeight}
                />
            </div>
        </div>
        <p class="help">Default 72×48 MU approximates a 6×4 foot table.</p>
    {:else}
        <div class="columns">
            <div class="column">
                <label class="label" for="fluidMapW">Starting width (MU)</label>
                <input
                    id="fluidMapW"
                    class="input"
                    type="number"
                    min="1"
                    step="1"
                    bind:value={mapWidth}
                />
            </div>
            <div class="column">
                <label class="label" for="fluidMapH">Starting height (MU)</label>
                <input
                    id="fluidMapH"
                    class="input"
                    type="number"
                    min="1"
                    step="1"
                    bind:value={mapHeight}
                />
            </div>
            <div class="column">
                <label class="label" for="fluidMapB">Default buffer (MU)</label>
                <input
                    id="fluidMapB"
                    class="input"
                    type="number"
                    min="0"
                    max="48"
                    step="1"
                    bind:value={mapBuffer}
                />
            </div>
        </div>
        <p class="help">
            Placement uses the starting board until turn 1 phase 2; then the map grows to fit all
            visible objects plus the buffer (adjustable anytime via the status bar).
        </p>
    {/if}

    <h3 class="title is-6 mt-4">Players</h3>
    {#each players as p, i}
        <div class="columns is-vcentered">
            <div class="column">
                <label class="label" for="pname{i}">Name</label>
                <input id="pname{i}" class="input" bind:value={players[i].id} />
            </div>
            <div class="column is-narrow">
                <label class="label" for="pcol{i}">Colour</label>
                <input
                    id="pcol{i}"
                    class="input"
                    style="width: 7em"
                    bind:value={players[i].colour}
                />
                <span
                    class="colour-swatch"
                    style="background-color: {players[i].colour}"
                    title="Preview"
                ></span>
            </div>
            <div class="column is-narrow">
                <label class="label">&nbsp;</label>
                <button
                    type="button"
                    class="button is-danger is-small"
                    on:click={() => removePlayer(i)}
                    title="Remove player"
                >
                    <span class="icon"><i class="fa-solid fa-trash"></i></span>
                </button>
            </div>
        </div>
    {/each}
    <button type="button" class="button is-success is-small" on:click={addPlayer}>
        Add player
    </button>

    <h3 class="title is-6 mt-4">Fleet limits (optional)</h3>
    <label class="checkbox">
        <input type="checkbox" bind:checked={fleetEnabled} />
        Set per-player fleet limits for this scenario
    </label>
    {#if fleetEnabled}
        {#each players as p}
            {@const fleet = fleetByPlayer[p.id]}
            <div class="columns is-vcentered mt-2">
                <div class="column is-one-quarter">
                    <strong>{p.id || "(unnamed)"}</strong>
                </div>
                <div class="column">
                    <input
                        class="input is-small"
                        placeholder="Max points"
                        bind:value={fleet.maxPoints}
                    />
                </div>
                <div class="column">
                    <input
                        class="input is-small"
                        placeholder="Max ships"
                        bind:value={fleet.maxShips}
                    />
                </div>
                <div class="column">
                    <input
                        class="input is-small"
                        placeholder="Notes"
                        bind:value={fleet.notes}
                    />
                </div>
            </div>
        {/each}
    {/if}

    <div class="buttons mt-4">
        <button type="button" class="button is-link" on:click={create}>Create game</button>
        <button type="button" class="button" on:click={cancel}>Cancel</button>
    </div>
</div>

<style>
    .colour-swatch {
        display: inline-block;
        width: 1.5em;
        height: 1.5em;
        margin-left: 0.5em;
        vertical-align: middle;
        border: 1px solid rgba(0, 0, 0, 0.2);
    }
    .new-game {
        margin-top: 0.75rem;
    }
</style>
