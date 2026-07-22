<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { currentState } from "@/stores/derivedState";
    import { gameMeta } from "@/stores/writeGameMeta";
    import {
        systemFailsThreshold,
        nextDriveState,
        type DriveThresholdState,
    } from "@/lib/game/thresholds";
    import { createDiceFromPolicy, parseDiceString } from "@/lib/game/dice";
    import { formatThresholdResultNotes, makeLogDice } from "@/lib/game/rollResults";
    import { appendGameCommands } from "@/lib/game/appendCommand";
    import type { FullThrustGameCommand } from "@/schemas/commands";
    import { toast } from "@zerodevx/svelte-toast";
    import { userSettings } from "@/stores/writeUserSettings";
    import { focusMapOnShipId } from "@/lib/actMapInteraction";
    import { findShipSystem, isSingleUseOrdnanceRack } from "@/lib/game/shipSystems";

    const dispatch = createEventDispatcher();

    function thresholdFailState(sysId: string): "damaged" | "destroyed" {
        if (!ship) return "damaged";
        const entry = findShipSystem(
            { id: ship.id, object: ship.object, systems: ship.systems },
            sysId
        );
        if (!entry) return "damaged";
        const n = (entry.name ?? "").toLowerCase();
        if (n === "magazine" || n === "hangar" || isSingleUseOrdnanceRack(entry)) return "destroyed";
        return "damaged";
    }

    function isAmtRack(sysId: string): boolean {
        if (!ship) return false;
        const entry = findShipSystem(
            { id: ship.id, object: ship.object, systems: ship.systems },
            sysId
        );
        return (entry?.name ?? "").toLowerCase() === "amt";
    }

    $: ships =
        $currentState.state?.objects?.filter((o) => o.objType === "ship") ?? [];

    let shipId = "";
    let failOn = 6;
    let systemsText = "drive,firecon";
    let driveState: DriveThresholdState = "ok";
    let diceOverride = "";
    let prevShipId = "";

    $: if (shipId && shipId !== prevShipId) {
        prevShipId = shipId;
        focusMapOnShipId(shipId, ships as import("@/schemas/position").FullThrustGameObjects[]);
    }

    $: ship = ships.find((s) => s.id === shipId);
    $: existingDrive = ship?.systems?.find((s) => s.id === "drive");
    $: if (existingDrive?.state === "destroyed") driveState = "disabled";
    else if (existingDrive?.state === "damaged") driveState = "half";

    const resolve = () => {
        if (!shipId) {
            toast.push("Select ship");
            return;
        }
        const systems = systemsText
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        if (systems.length === 0) {
            toast.push("Enter at least one system id");
            return;
        }
        const meta = $currentState.meta ?? $gameMeta;
        let rolls: number[];
        try {
            rolls = diceOverride.trim()
                ? parseDiceString(diceOverride)
                : createDiceFromPolicy(meta.dicePolicy, { seed: meta.diceSeed }).roll(
                      systems.length
                  ).rolls;
        } catch (e) {
            toast.push(e instanceof Error ? e.message : "Dice error");
            return;
        }

        const usedRolls = rolls.slice(0, systems.length);
        const resultNotes = formatThresholdResultNotes(shipId, systems, usedRolls, failOn);

        const cmds: FullThrustGameCommand[] = [
            makeLogDice({
                purpose: `threshold ${shipId}`,
                rolls: usedRolls,
                source: diceOverride.trim() ? "moderatorSequence" : "client",
                result: resultNotes,
            }),
        ];

        let drive = driveState;
        systems.forEach((sys, i) => {
            const roll = rolls[i] ?? 1;
            const failed = systemFailsThreshold(roll, failOn);
            if (!failed) {
                cmds.push({
                    name: "_custom",
                    msg: `Threshold OK ${shipId}/${sys} rolled ${roll} (fail on ${failOn}+)`,
                } as FullThrustGameCommand);
                return;
            }
            if (sys === "drive" || sys.toLowerCase().includes("drive")) {
                const next = nextDriveState(drive, true);
                drive = next;
                if (next === "half") {
                    cmds.push({
                        name: "sysDisable",
                        ship: shipId,
                        system: sys,
                        state: "damaged",
                    } as FullThrustGameCommand);
                    cmds.push({
                        name: "_custom",
                        msg: `Drive half thrust on ${shipId}`,
                    } as FullThrustGameCommand);
                } else {
                    cmds.push({
                        name: "sysDisable",
                        ship: shipId,
                        system: sys,
                        state: "destroyed",
                    } as FullThrustGameCommand);
                }
            } else {
                const state = thresholdFailState(sys);
                cmds.push({
                    name: "sysDisable",
                    ship: shipId,
                    system: sys,
                    state,
                } as FullThrustGameCommand);
                if (isAmtRack(sys)) {
                    cmds.push({
                        name: "_custom",
                        msg: `AMT rack ${sys} exploded — roll 1d6 hull to carrier and 1d6 per unit within 1 MU (no screens/armour)`,
                    } as FullThrustGameCommand);
                }
            }
        });

        appendGameCommands(cmds, ($userSettings.role ?? "player") === "moderator");
        toast.push("Threshold checks applied");
        dispatch("done");
    };
</script>

<p class="help">
    Roll one d6 per listed system. Fail on the threshold number from the hull-row note (1st→6,
    2nd→5+, …). Drive: first fail = half thrust (damaged), second = disabled.
</p>

<div class="field">
    <label class="label" for="ship">Ship</label>
    <div class="select">
        <select id="ship" bind:value={shipId}>
            <option value="">--</option>
            {#each ships as s}
                <option value={s.id}>{s.id}</option>
            {/each}
        </select>
    </div>
</div>
<div class="field">
    <label class="label" for="fail">Fail on or above</label>
    <input id="fail" class="input" type="number" min="1" max="6" bind:value={failOn} />
</div>
<div class="field">
    <label class="label" for="sys">Systems (comma-separated ids)</label>
    <input id="sys" class="input" bind:value={systemsText} />
</div>
<div class="field">
    <label class="label" for="drive">Current drive threshold state</label>
    <div class="select">
        <select id="drive" bind:value={driveState}>
            <option value="ok">ok</option>
            <option value="half">half</option>
            <option value="disabled">disabled</option>
        </select>
    </div>
</div>
<div class="field">
    <label class="label" for="dice">Dice override</label>
    <input id="dice" class="input" bind:value={diceOverride} placeholder="Leave empty to auto-roll on demand" />
</div>
<button class="button is-primary" on:click={resolve}>Resolve thresholds</button>
