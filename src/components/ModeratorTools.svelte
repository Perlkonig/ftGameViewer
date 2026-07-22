<script lang="ts">
    import { userSettings } from "@/stores/writeUserSettings";
    import { currentState } from "@/stores/derivedState";
    import { gameMeta } from "@/stores/writeGameMeta";
    import { commands } from "@/stores/writeCommands";
    import { appendGameCommand, appendGameCommands, popMasterCommands } from "@/lib/game/appendCommand";
    import { pushShipDestroyedCommands } from "@/lib/game/resolveCombat";
    import { shipDestroyedByHullDamage } from "@/lib/game/thresholds";
    import ThresholdCheck from "./Commands/Select/ThresholdCheck.svelte";
    import type { FullThrustGameCommand } from "@/schemas/commands";
    import type { FleetLimit } from "@/lib/game/types";
    import type { CoreState } from "@/lib/game/coreSystems";
    import { toast } from "@zerodevx/svelte-toast";
    import { fighterGroupOptionLabel, normalizeCallsign } from "@/lib/game/fighterLabel";
    import { SET_FIGHTER_TYPES } from "@/lib/game/fighterTypeCommand";

    $: isMod = ($userSettings.role ?? "player") === "moderator";
    $: players = $currentState.state?.players ?? [];
    $: ships =
        $currentState.state?.objects?.filter((o) => o.objType === "ship") ?? [];

    let adjShip = "";
    let adjHull = 0;
    let adjArmour = "";
    let adjSystem = "";
    let adjSysState: "damaged" | "destroyed" = "damaged";
    let customMsg = "";
    let vpPlayer = "";
    let vpAmt = 0;
    let limitPlayer = "";
    let limitPoints = "";
    let limitShips = "";
    let limitNotes = "";

    let boardShip = "";
    let boardOwner = "";
    let boardDcp = 0;
    let boardMarines = 0;

    let ownerShip = "";
    let ownerPlayer = "";
    let prevOwnerShip = "";

    $: ownerShipObj = ships.find((s) => s.id === ownerShip) as
        | { boardingCapture?: { by: string; resolved?: boolean } }
        | undefined;
    $: if (ownerShip && ownerShip !== prevOwnerShip) {
        prevOwnerShip = ownerShip;
        const cap = ownerShipObj?.boardingCapture;
        if (cap && !cap.resolved) {
            ownerPlayer = cap.by;
        }
    }

    let coreShip = "";
    let abandonNote = "";

    let callsignFighterId = "";
    let callsignValue = "";
    let lastCallsignFighterId = "";
    let typeFighterId = "";
    let typeFighterType = "standard";
    const fighterTypeOptions = [...SET_FIGHTER_TYPES].sort();

    $: fighterGroups =
        $currentState.state?.objects?.filter((o) => o.objType === "fighters") ?? [];
    $: if (callsignFighterId !== lastCallsignFighterId) {
        lastCallsignFighterId = callsignFighterId;
        const fighter = fighterGroups.find((f) => f.id === callsignFighterId);
        callsignValue = (fighter as { callsign?: string } | undefined)?.callsign ?? "";
    }

    const setFighterCallsign = () => {
        if (!callsignFighterId) return;
        const callsign = normalizeCallsign(callsignValue);
        appendGameCommand(
            {
                name: "setFighterCallsign",
                id: callsignFighterId,
                ...(callsign ? { callsign } : {}),
            } as FullThrustGameCommand,
            true
        );
        toast.push(callsign ? "Callsign updated" : "Callsign cleared");
    };

    const clearFighterCallsign = () => {
        if (!callsignFighterId) return;
        callsignValue = "";
        appendGameCommand(
            { name: "setFighterCallsign", id: callsignFighterId } as FullThrustGameCommand,
            true
        );
        toast.push("Callsign cleared");
    };

    const setFighterType = () => {
        if (!typeFighterId || !typeFighterType) return;
        appendGameCommand(
            {
                name: "setFighterType",
                id: typeFighterId,
                type: typeFighterType,
            } as FullThrustGameCommand,
            true
        );
        toast.push(`Fighter type set to ${typeFighterType}`);
    };

    $: coreShipObj = ships.find((s) => s.id === coreShip);
    $: coreState = (coreShipObj as { coreState?: CoreState } | undefined)?.coreState;

    const dumpReactor = () => {
        if (!coreShip) return;
        appendGameCommands(
            [
                {
                    name: "setCoreState",
                    ship: coreShip,
                    dumped: true,
                    powerless: true,
                } as FullThrustGameCommand,
                {
                    name: "_custom",
                    msg: `${coreShip}: reactor dumped at player request — ship is powerless and drifts out of the battle.`,
                } as FullThrustGameCommand,
            ],
            true
        );
        toast.push(`Reactor dumped for ${coreShip}`);
    };

    const abandonShip = () => {
        if (!coreShip) return;
        const msg =
            abandonNote.trim() ||
            `${coreShip}: crew abandoned ship — reactor remains unstable; explosion rolls continue.`;
        appendGameCommands(
            [
                {
                    name: "setCoreState",
                    ship: coreShip,
                    abandonedSinceTurn: $gameMeta.turn,
                } as FullThrustGameCommand,
                {
                    name: "_custom",
                    msg,
                } as FullThrustGameCommand,
            ],
            true
        );
        abandonNote = "";
        toast.push("Abandon ship logged");
    };

    const setBoarders = () => {
        if (!boardShip || !boardOwner) return;
        appendGameCommand(
            {
                name: "setBoarders",
                ship: boardShip,
                owner: boardOwner,
                dcp: boardDcp,
                marines: boardMarines,
            } as FullThrustGameCommand,
            true
        );
        toast.push("Boarders set");
    };

    const adjustBoarders = () => {
        if (!boardShip || !boardOwner) return;
        appendGameCommand(
            {
                name: "adjustBoarders",
                ship: boardShip,
                owner: boardOwner,
                dcp: boardDcp,
                marines: boardMarines,
            } as FullThrustGameCommand,
            true
        );
        toast.push("Boarders adjusted");
    };

    const transferShipOwner = () => {
        if (!ownerShip || !ownerPlayer) return;
        appendGameCommand(
            {
                name: "setShipOwner",
                ship: ownerShip,
                owner: ownerPlayer,
            } as FullThrustGameCommand,
            true
        );
        toast.push(`Ownership of ${ownerShip} transferred to ${ownerPlayer}`);
    };

    const applyDamage = () => {
        if (!adjShip) return;
        const ship = ships.find((s) => s.id === adjShip);
        if (!ship) return;
        const armour = adjArmour.trim()
            ? adjArmour.split(",").map((s) => Number(s.trim()))
            : undefined;
        const cmds: FullThrustGameCommand[] = [
            {
                name: "dmgShip",
                ship: adjShip,
                hull: adjHull,
                armour,
            } as FullThrustGameCommand,
        ];
        if (shipDestroyedByHullDamage(ship, adjHull)) {
            pushShipDestroyedCommands(cmds, adjShip);
        }
        appendGameCommands(cmds, true);
        toast.push("Damage applied");
    };

    const disableSys = () => {
        if (!adjShip || !adjSystem) return;
        appendGameCommand(
            {
                name: "sysDisable",
                ship: adjShip,
                system: adjSystem,
                state: adjSysState,
            } as FullThrustGameCommand,
            true
        );
        toast.push("System disabled");
    };

    const enableSys = () => {
        if (!adjShip || !adjSystem) return;
        appendGameCommand(
            {
                name: "sysEnable",
                ship: adjShip,
                system: adjSystem,
                state: "repaired",
            } as FullThrustGameCommand,
            true
        );
        toast.push("System enabled/repaired");
    };

    const destroyObj = () => {
        if (!adjShip) return;
        appendGameCommand(
            { name: "objDestroy", uuid: adjShip } as FullThrustGameCommand,
            true
        );
        toast.push("Object destroyed");
    };

    const addCustom = () => {
        if (!customMsg.trim()) return;
        appendGameCommand(
            { name: "_custom", msg: customMsg } as FullThrustGameCommand,
            true
        );
        customMsg = "";
        toast.push("Log note added");
    };

    const award = () => {
        if (!vpPlayer) return;
        appendGameCommand(
            { name: "awardVP", player: vpPlayer, vp: vpAmt } as FullThrustGameCommand,
            true
        );
        toast.push("VP awarded");
    };

    const setFleetLimits = () => {
        if (!limitPlayer) return;
        const existing = [...($gameMeta.fleetLimits ?? [])];
        const entry: FleetLimit = {
            playerId: limitPlayer,
            maxPoints: limitPoints ? Number(limitPoints) : undefined,
            maxShips: limitShips ? Number(limitShips) : undefined,
            notes: limitNotes || undefined,
        };
        const idx = existing.findIndex((f) => f.playerId === limitPlayer);
        if (idx >= 0) existing[idx] = entry;
        else existing.push(entry);
        appendGameCommand(
            { name: "setMeta", fleetLimits: existing } as FullThrustGameCommand,
            true
        );
        // Also update baseline store so UI reflects immediately before fold quirks
        gameMeta.update((m) => ({ ...m, fleetLimits: existing }));
        toast.push("Fleet limits updated");
    };

    const undoLast = () => {
        try {
            const removed = popMasterCommands(1);
            if (removed === 0) {
                toast.push("Master log is empty");
                return;
            }
            toast.push(`Removed ${removed} command${removed === 1 ? "" : "s"} from master log`);
        } catch (e) {
            toast.push(e instanceof Error ? e.message : "Could not remove command");
        }
    };
</script>

{#if !isMod}
    <div class="notification is-warning">
        Switch to <strong>Moderator</strong> role in Settings to use these tools.
    </div>
{:else}
    <div class="content">
        <p class="help mb-3">
            Initiative and phase dice are prompted automatically when you advance phases.
            Use this tab for damage, VP, fleet limits, and log adjustments.
        </p>

        <h2 class="title is-5">Adjustments</h2>
        <div class="field">
            <div class="select">
                <select bind:value={adjShip}>
                    <option value="">object / ship</option>
                    {#each ships as s}
                        <option value={s.id}>{s.id}</option>
                    {/each}
                </select>
            </div>
        </div>
        <div class="field is-grouped">
            <div class="control">
                <input class="input" type="number" min="0" bind:value={adjHull} placeholder="hull" />
            </div>
            <div class="control">
                <input class="input" bind:value={adjArmour} placeholder="armour 1,0" />
            </div>
            <div class="control">
                <button class="button" on:click={applyDamage}>Apply damage</button>
            </div>
        </div>
        <div class="field is-grouped">
            <div class="control">
                <input class="input" bind:value={adjSystem} placeholder="system id" />
            </div>
            <div class="control">
                <div class="select">
                    <select bind:value={adjSysState}>
                        <option value="damaged">damaged</option>
                        <option value="destroyed">destroyed</option>
                    </select>
                </div>
            </div>
            <div class="control">
                <button class="button" on:click={disableSys}>Disable</button>
            </div>
            <div class="control">
                <button class="button" on:click={enableSys}>Repair</button>
            </div>
            <div class="control">
                <button class="button is-danger" on:click={destroyObj}>Destroy object</button>
            </div>
        </div>

        <h2 class="title is-5">Fighter callsigns</h2>
        <p class="help mb-2">
            Assign or change display names for fighter wings. Internal ids stay unchanged; changes
            are logged for replay.
        </p>
        <div class="field is-grouped is-grouped-multiline">
            <div class="control">
                <div class="select">
                    <select bind:value={callsignFighterId}>
                        <option value="">fighter group</option>
                        {#each fighterGroups as f}
                            <option value={f.id}>{fighterGroupOptionLabel(f)}</option>
                        {/each}
                    </select>
                </div>
            </div>
            <div class="control">
                <input
                    class="input"
                    type="text"
                    maxlength="32"
                    bind:value={callsignValue}
                    placeholder="callsign"
                    disabled={!callsignFighterId}
                />
            </div>
            <div class="control">
                <button class="button" on:click={setFighterCallsign} disabled={!callsignFighterId}>
                    Set / update
                </button>
            </div>
            <div class="control">
                <button
                    class="button"
                    on:click={clearFighterCallsign}
                    disabled={!callsignFighterId}
                >
                    Clear
                </button>
            </div>
        </div>

        <h2 class="title is-5">Fighter type (multiRole)</h2>
        <p class="help mb-2">
            Wings placed as <strong>multiRole</strong> must be configured before combat. Sets
            operational type and refreshes the map counter.
        </p>
        <div class="field is-grouped is-grouped-multiline">
            <div class="control">
                <div class="select">
                    <select bind:value={typeFighterId}>
                        <option value="">fighter group</option>
                        {#each fighterGroups as f}
                            <option value={f.id}>{fighterGroupOptionLabel(f)}</option>
                        {/each}
                    </select>
                </div>
            </div>
            <div class="control">
                <div class="select">
                    <select bind:value={typeFighterType} disabled={!typeFighterId}>
                        {#each fighterTypeOptions as t}
                            <option value={t}>{t}</option>
                        {/each}
                    </select>
                </div>
            </div>
            <div class="control">
                <button class="button" on:click={setFighterType} disabled={!typeFighterId}>
                    Set type
                </button>
            </div>
        </div>

        <h2 class="title is-5">Boarders</h2>
        <p class="help mb-2">
            Place or adjust <strong>attacking</strong> boarder units aboard a defender ship. Only two
            types: DCP and Marine. Pick defender ship and attacking player, then unit counts.
        </p>
        <div class="field is-grouped is-grouped-multiline">
            <div class="control">
                <div class="select">
                    <select bind:value={boardShip}>
                        <option value="">defender ship</option>
                        {#each ships as s}
                            <option value={s.id}>{s.id}</option>
                        {/each}
                    </select>
                </div>
            </div>
            <div class="control">
                <div class="select">
                    <select bind:value={boardOwner}>
                        <option value="">attacker player</option>
                        {#each players as p}
                            <option value={p.id}>{p.id}</option>
                        {/each}
                    </select>
                </div>
            </div>
            <div class="control">
                <label class="label is-small" for="board-dcp">DCP</label>
                <input
                    id="board-dcp"
                    class="input"
                    type="number"
                    min="0"
                    bind:value={boardDcp}
                />
            </div>
            <div class="control">
                <label class="label is-small" for="board-marines">Marines</label>
                <input
                    id="board-marines"
                    class="input"
                    type="number"
                    min="0"
                    bind:value={boardMarines}
                />
            </div>
            <div class="control">
                <button class="button" on:click={setBoarders}>Set boarders</button>
            </div>
            <div class="control">
                <button class="button" on:click={adjustBoarders}>Adjust (+/−)</button>
            </div>
        </div>
        <p class="help mb-4">
            <strong>DCP</strong> — non-marine boarders (rules “boarding parties”).<br />
            <strong>Marines</strong> — military boarders.<br />
            Defender repel pools come from the defending ship’s crew, not these counts.
        </p>

        <h2 class="title is-5">Captured ship ownership</h2>
        <p class="help mb-2">
            After boarding capture, transfer the defender ship to the capturing player so it appears
            as a valid target to the former owner and can be protected by the new owner’s ADS/PDS.
        </p>
        {#if ownerShipObj?.boardingCapture}
            <p class="help mb-2">
                {#if ownerShipObj.boardingCapture.resolved}
                    <strong>{ownerShip}</strong>: capture resolved (owner updated).
                {:else}
                    <strong>{ownerShip}</strong>: CAPTURED by
                    {ownerShipObj.boardingCapture.by} — ownership transfer pending.
                {/if}
            </p>
        {/if}
        <div class="field is-grouped is-grouped-multiline">
            <div class="control">
                <div class="select">
                    <select bind:value={ownerShip}>
                        <option value="">ship</option>
                        {#each ships as s}
                            <option value={s.id}>{s.id}</option>
                        {/each}
                    </select>
                </div>
            </div>
            <div class="control">
                <div class="select">
                    <select bind:value={ownerPlayer}>
                        <option value="">new owner</option>
                        {#each players as p}
                            <option value={p.id}>{p.id}</option>
                        {/each}
                    </select>
                </div>
            </div>
            <div class="control">
                <button
                    class="button is-primary"
                    on:click={transferShipOwner}
                    disabled={!ownerShip || !ownerPlayer}
                >
                    Transfer ownership
                </button>
            </div>
        </div>

        <h2 class="title is-5">Core / reactor (player requests)</h2>
        <p class="help mb-2">
            Phase 15 resolves unstable-reactor explosion rolls automatically when you advance into
            that phase. Use these controls when a player asks to dump the reactor or abandon ship
            before the roll.
        </p>
        <div class="field is-grouped is-grouped-multiline">
            <div class="control">
                <div class="select">
                    <select bind:value={coreShip}>
                        <option value="">ship</option>
                        {#each ships as s}
                            <option value={s.id}>{s.id}</option>
                        {/each}
                    </select>
                </div>
            </div>
            {#if coreState}
                <div class="control">
                    <p class="help">
                        powerless={String(!!coreState.powerless)} dumped={String(!!coreState.dumped)}
                    </p>
                </div>
            {/if}
            <div class="control">
                <button class="button" on:click={dumpReactor} disabled={!coreShip}>
                    Dump reactor
                </button>
            </div>
        </div>
        <div class="field has-addons">
            <div class="control is-expanded">
                <input
                    class="input"
                    bind:value={abandonNote}
                    placeholder="Abandon ship note (optional)"
                />
            </div>
            <div class="control">
                <button class="button" on:click={abandonShip} disabled={!coreShip}>
                    Log abandon ship
                </button>
            </div>
        </div>

        <h2 class="title is-5">Threshold check (manual)</h2>
        <p class="help mb-2">
            Fallback for edge corrections. Phase 13 normally resolves pending checks via the advance-phase prompt.
        </p>
        <ThresholdCheck />

        <h2 class="title is-5">VP / log / fleet limits</h2>
        <div class="field is-grouped">
            <div class="control">
                <div class="select">
                    <select bind:value={vpPlayer}>
                        <option value="">player</option>
                        {#each players as p}
                            <option value={p.id}>{p.id}</option>
                        {/each}
                    </select>
                </div>
            </div>
            <div class="control">
                <input class="input" type="number" bind:value={vpAmt} />
            </div>
            <div class="control">
                <button class="button" on:click={award}>Award VP</button>
            </div>
        </div>
        <div class="field has-addons">
            <div class="control is-expanded">
                <input class="input" bind:value={customMsg} placeholder="Combat log note" />
            </div>
            <div class="control">
                <button class="button" on:click={addCustom}>Add note</button>
            </div>
        </div>

        <div class="field is-grouped is-grouped-multiline">
            <div class="control">
                <div class="select">
                    <select bind:value={limitPlayer}>
                        <option value="">fleet limit player</option>
                        {#each players as p}
                            <option value={p.id}>{p.id}</option>
                        {/each}
                    </select>
                </div>
            </div>
            <div class="control">
                <input class="input" bind:value={limitPoints} placeholder="max points" />
            </div>
            <div class="control">
                <input class="input" bind:value={limitShips} placeholder="max ships" />
            </div>
            <div class="control">
                <input class="input" bind:value={limitNotes} placeholder="notes" />
            </div>
            <div class="control">
                <button class="button" on:click={setFleetLimits}>Set fleet limit</button>
            </div>
        </div>

        <h2 class="title is-5">Master log</h2>
        <p class="help">
            Remove entries from the end only. Return the replay scrubber to latest first.
        </p>
        {#if $commands.length}
            <p class="is-size-7">
                Last entry: <strong>{$commands[$commands.length - 1].name}</strong>
            </p>
        {/if}
        <button
            class="button is-warning"
            on:click={undoLast}
            disabled={$commands.length === 0}
        >
            Remove last master command
        </button>
    </div>
{/if}
