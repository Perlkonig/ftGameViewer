<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { currentState } from "@/stores/derivedState";
    import { appendGameCommands } from "@/lib/game/appendCommand";
    import {
        validateDeclareTransporterDelivery,
        validateTransporterDeliveryBatch,
    } from "@/lib/game/commandValidation";
    import { transporterFirerCapacity } from "@/lib/game/transporterFire";
    import type { TransporterDeliveryMode } from "@/lib/game/transporterFire";
    import type { FullThrustGameCommand } from "@/schemas/commands";
    import type { FullThrustGameObjects } from "@/schemas/position";
    import { toast } from "@zerodevx/svelte-toast";
    import { userSettings } from "@/stores/writeUserSettings";
    import ActError from "./ActError.svelte";
    import RenderSsd from "@/components/RenderSSD.svelte";
    import { buildShipRenderOpts } from "@/lib/ssdRenderOpts";
    import type { ShipWithCrewDeployment } from "@/lib/game/crewDeployment";
    import { focusMapOnShipId } from "@/lib/actMapInteraction";

    const dispatch = createEventDispatcher();

    let selectedSlotKey = "";
    let mode: TransporterDeliveryMode = "boarding";
    let payload: "marine" | "dcp" = "marine";
    let commandoSystemId = "";
    let diceOverride = "";
    let prevSlotKey = "";

    $: ships =
        ($currentState.state?.objects?.filter((o) => o.objType === "ship") ??
            []) as FullThrustGameObjects[];
    $: pending = $currentState.pendingTransporterDeliveries ?? [];
    $: slots = pending.filter((p) => p.remaining > 0);
    $: slotOptions = slots.map((s) => ({
        key: `${s.firerShipId}|${s.targetShipId}|${s.weaponId}`,
        ...s,
    }));
    $: if (slotOptions.length && !selectedSlotKey) {
        selectedSlotKey = slotOptions[0].key;
    }
    $: if (selectedSlotKey && selectedSlotKey !== prevSlotKey) {
        prevSlotKey = selectedSlotKey;
        const slot = slotOptions.find((s) => s.key === selectedSlotKey);
        if (slot) focusMapOnShipId(slot.firerShipId, ships);
    }
    $: selectedSlot = slotOptions.find((s) => s.key === selectedSlotKey);
    $: firer = selectedSlot
        ? (ships.find((s) => s.id === selectedSlot.firerShipId) as
              | (FullThrustGameObjects & ShipWithCrewDeployment)
              | undefined)
        : undefined;
    $: target = selectedSlot
        ? ships.find((s) => s.id === selectedSlot.targetShipId)
        : undefined;
    $: capacity = firer ? transporterFirerCapacity(firer) : { marinesAvailable: 0, dcpAvailable: 0 };
    $: shipJson = target ? JSON.stringify(target.object) : "";
    $: renderOpts = target ? buildShipRenderOpts(target) : { minimal: true };

    $: foldStub = {
        meta: $currentState.meta ?? {
            phase: 11,
            turn: 1,
            version: "",
            name: "",
            createdAt: "",
            dicePolicy: "hybrid",
        },
        position: $currentState.state ?? { map: { mode: "fixed", width: 72, height: 48 } },
        pendingTransporterDeliveries: pending,
    };

    $: draftCmd = selectedSlot
        ? ({
              name: "declareTransporterDelivery",
              firerShip: selectedSlot.firerShipId,
              targetShip: selectedSlot.targetShipId,
              weapon: selectedSlot.weaponId,
              attackerOwner: firer && "owner" in firer ? String(firer.owner ?? "") : undefined,
              choice: {
                  mode,
                  payload: mode === "commando" ? "marine" : payload,
                  commandoSystemId: mode === "commando" ? commandoSystemId : undefined,
              },
          } as FullThrustGameCommand)
        : null;

    $: actIssues = draftCmd
        ? [
              ...validateDeclareTransporterDelivery(foldStub, draftCmd),
              ...validateTransporterDeliveryBatch(
                  foldStub,
                  selectedSlot?.firerShipId ?? "",
                  [draftCmd]
              ),
          ]
        : [];
    $: hasErrors = actIssues.some((i) => i.severity === "error");
    $: marineDisabled = capacity.marinesAvailable < 1;
    $: dcpDisabled = capacity.dcpAvailable < 1;

    const getInnermostHovered = (): Element | undefined => {
        let n = document.querySelector(":hover");
        let nn: Element | undefined;
        while (n) {
            nn = n;
            n = nn.querySelector(":hover");
        }
        return nn;
    };

    const handleSsdClick = () => {
        if (mode !== "commando") return;
        const ele = getInnermostHovered();
        if (ele?.id) commandoSystemId = ele.id;
    };

    const declare = () => {
        if (!draftCmd || !selectedSlot) {
            toast.push("Select a pending transporter slot");
            return;
        }
        if (hasErrors) {
            toast.push(actIssues.find((i) => i.severity === "error")?.message ?? "Invalid delivery");
            return;
        }
        if (mode === "commando" && !commandoSystemId) {
            toast.push("Select a target system on the defender SSD");
            return;
        }
        const rolls = diceOverride
            .split(/[\s,]+/)
            .map((s) => parseInt(s.trim(), 10))
            .filter((n) => n >= 1 && n <= 6);
        const cmd = {
            ...draftCmd,
            ...(rolls.length ? { rolls } : {}),
        } as FullThrustGameCommand;
        const dest = appendGameCommands(
            [cmd],
            ($userSettings.role ?? "player") === "moderator"
        );
        toast.push(
            dest === "master" ? "Transporter delivery logged" : "Delivery added to proposals"
        );
        commandoSystemId = "";
        diceOverride = "";
        dispatch("done");
    };
</script>

{#if slots.length === 0}
    <p class="help">No pending transporter delivery slots.</p>
{:else}
    <div class="field">
        <label class="label" for="slot">Pending delivery</label>
        <div class="select is-fullwidth">
            <select id="slot" bind:value={selectedSlotKey}>
                {#each slotOptions as opt}
                    <option value={opt.key}>
                        {opt.firerShipId} → {opt.targetShipId} ({opt.weaponId}) — {opt.remaining} left
                    </option>
                {/each}
            </select>
        </div>
    </div>

    {#if firer}
        <p class="help is-size-7">
            Marines available: <strong>{capacity.marinesAvailable}</strong> —
            DCP available: <strong>{capacity.dcpAvailable}</strong>
        </p>
    {/if}

    <div class="field">
        <span class="label">Delivery mode</span>
        <div class="control">
            <label class="radio">
                <input type="radio" bind:group={mode} value="boarding" />
                Boarding transfer
            </label>
            <label class="radio ml-3">
                <input
                    type="radio"
                    bind:group={mode}
                    value="commando"
                    disabled={marineDisabled}
                />
                Commando raid
            </label>
        </div>
    </div>

    {#if mode === "boarding"}
        <div class="field">
            <span class="label">Payload</span>
            <div class="control">
                <label class="radio">
                    <input
                        type="radio"
                        bind:group={payload}
                        value="marine"
                        disabled={marineDisabled}
                    />
                    Marine
                </label>
                <label class="radio ml-3">
                    <input type="radio" bind:group={payload} value="dcp" disabled={dcpDisabled} />
                    DCP
                </label>
            </div>
        </div>
    {:else if target}
        <p class="help is-size-7">Click a system on the target SSD for the commando raid.</p>
        <div class="ssd-wrap mb-3 ssd-picker" on:click={handleSsdClick}>
            <RenderSsd json={shipJson} opts={renderOpts} />
        </div>
        {#if commandoSystemId}
            <p class="help">Target system: <strong>{commandoSystemId}</strong></p>
        {/if}
    {/if}

    <div class="field">
        <label class="label" for="dice">Commando dice (optional)</label>
        <input id="dice" class="input" bind:value={diceOverride} placeholder="e.g. 5" />
    </div>

    <ActError issues={actIssues} />

    <div class="field mt-3">
        <div class="control">
            <button
                type="button"
                class="button is-primary"
                disabled={hasErrors || (mode === "commando" && !commandoSystemId)}
                on:click={declare}
            >
                Declare delivery
            </button>
        </div>
    </div>
{/if}

<style>
    .ssd-wrap {
        max-width: 320px;
    }
    .ssd-picker {
        cursor: pointer;
    }
</style>
