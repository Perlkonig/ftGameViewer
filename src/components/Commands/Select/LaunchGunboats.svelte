<script lang="ts">
    import { createEventDispatcher, onDestroy, onMount } from "svelte";
    import { currentState } from "@/stores/derivedState";
    import { clickMode } from "@/stores/writeClickMode";
    import { beacon } from "@/stores/writeBeacon";
    import { annotations, type IAnnotation } from "@/stores/writeAnnotations";
    import { appendGameCommands } from "@/lib/game/appendCommand";
    import type { FullThrustGameCommand } from "@/schemas/commands";
    import { toast } from "@zerodevx/svelte-toast";
    import type { ShipGameState } from "@/lib/game/shipSystems";
    import {
        launchableFromBay,
        launchableFromRack,
        mapTokenIdForSquadron,
    } from "@/lib/gunboatRacks";
    import { gunboatGroupOptionLabel } from "@/lib/game/gunboatLabel";
    import { normalizeCallsign } from "@/lib/game/fighterLabel";
    import { focusMapOnShipId } from "@/lib/actMapInteraction";
    import { distance } from "@/lib/game/movement";
    import ActError from "./ActError.svelte";
    import { validateFighterCallsignField } from "@/lib/game/commandValidation";

    /** Rack/bay launch in phase 3 — same as fighter wings (see LaunchFighters). */
    const LAUNCH_RADIUS_MU = 1;

    const dispatch = createEventDispatcher();

    $: carriers =
        $currentState.state?.objects?.filter((o) => o.objType === "ship" && o.position) ?? [];

    let shipId = "";
    let source: "rack" | "bay" = "rack";
    let rackId = "";
    let bayId = "";
    let squadronTokenId = "";
    let launchPos: { x: number; y: number } | undefined;
    let callsignDraft = "";

    $: selectedGunboat =
        squadronTokenId && $currentState.state
            ? ($currentState.state.objects?.find(
                  (o) => o.id === squadronTokenId && o.objType === "gunboats"
              ) as { id: string; callsign?: string } | undefined)
            : undefined;
    $: squadronHasCallsign = !!normalizeCallsign(selectedGunboat?.callsign);

    $: callsignIssues =
        squadronTokenId && !squadronHasCallsign
            ? validateFighterCallsignField(callsignDraft, { required: true })
            : callsignDraft.trim()
              ? validateFighterCallsignField(callsignDraft)
              : [];

    $: carrier = carriers.find((s) => s.id === shipId) as ShipGameState | undefined;
    $: rackSquads =
        carrier && $currentState.state ? launchableFromRack(carrier, $currentState.state) : [];
    $: baySquads = carrier ? launchableFromBay(carrier) : [];

    $: if (shipId) {
        focusMapOnShipId(shipId, carriers as import("@/schemas/position").FullThrustGameObjects[]);
    }

    $: if ($beacon && carrier && squadronTokenId) {
        launchPos = { x: $beacon.x, y: $beacon.y };
    }

    const placementWarning = (pos: { x: number; y: number }): string | undefined => {
        if (!carrier?.position || !("x" in carrier.position)) return undefined;
        const d = distance(carrier.position, pos);
        if (d > LAUNCH_RADIUS_MU + 0.05) {
            return `${d.toFixed(2)} MU from carrier (max ${LAUNCH_RADIUS_MU} MU)`;
        }
        return undefined;
    };

    $: launchWarn = launchPos ? placementWarning(launchPos) : undefined;

    $: {
        const ann: IAnnotation[] = [];
        if (carrier?.position && "x" in carrier.position) {
            ann.push({
                id: "gunboat_launch_zone",
                type: "CIRCLE",
                note: { c: carrier.position, r: LAUNCH_RADIUS_MU },
                color: "#e8a838",
                opacity: 0.14,
                strokeWidth: 2,
            });
            if (launchPos) {
                ann.push({
                    id: "gunboat_launch_pick",
                    type: "CIRCLE",
                    note: { c: launchPos, r: 0.15 },
                    color: launchWarn ? "#ff6688" : "#88dd66",
                    opacity: 0.9,
                    strokeWidth: 2,
                });
            }
        }
        annotations.set(ann);
    }

    const pickRack = (r: (typeof rackSquads)[0]) => {
        rackId = r.rackId;
        squadronTokenId = mapTokenIdForSquadron(shipId, r.squadronKey ?? r.rackId);
        source = "rack";
        bayId = "";
        launchPos = undefined;
        callsignDraft = "";
        beacon.set(undefined);
    };

    const pickBay = (b: (typeof baySquads)[0]) => {
        bayId = b.bayId;
        squadronTokenId = mapTokenIdForSquadron(shipId, b.squadronKey ?? b.bayId);
        source = "bay";
        rackId = "";
        launchPos = undefined;
        callsignDraft = "";
        beacon.set(undefined);
    };

    $: if (squadronTokenId && selectedGunboat && squadronHasCallsign) {
        callsignDraft = normalizeCallsign(selectedGunboat.callsign) ?? "";
    }

    const submit = () => {
        if (!carrier || !launchPos || !squadronTokenId) {
            toast.push("Select carrier, squadron, and map position");
            return;
        }
        const warn = placementWarning(launchPos);
        if (warn) {
            toast.push(warn);
            return;
        }
        if (callsignIssues.some((i) => i.severity === "error")) {
            toast.push(callsignIssues.find((i) => i.severity === "error")?.message ?? "Invalid callsign");
            return;
        }
        const callsign = squadronHasCallsign
            ? undefined
            : normalizeCallsign(callsignDraft);
        if (!squadronHasCallsign && !callsign) {
            toast.push("Enter a squadron callsign");
            return;
        }
        const cmd: FullThrustGameCommand = {
            name: "launchGunboats",
            ship: shipId,
            id: squadronTokenId,
            position: launchPos,
            facing: carrier.facing,
            source,
            ...(source === "rack" ? { rackId } : { bayId }),
            ...(callsign ? { callsign } : {}),
        };
        appendGameCommands([cmd]);
        toast.push("Gunboats launched");
        dispatch("done");
    };

    onMount(() => {
        clickMode.set("beacon");
        beacon.set(undefined);
    });
    onDestroy(() => {
        clickMode.set(undefined);
        beacon.set(undefined);
        annotations.set([]);
    });
</script>

<p class="help">
    Phase 3 — launch a gunboat squadron from a rack or boat bay within
    <strong>{LAUNCH_RADIUS_MU} MU</strong> of the carrier. The amber ring on the map shows the
    allowed zone.
</p>

<h3 class="title is-6">Launch gunboats</h3>
<label class="label" for="gb-ship">Carrier</label>
<select id="gb-ship" class="select" bind:value={shipId}>
    <option value="">—</option>
    {#each carriers as s}
        <option value={s.id}>{s.id}</option>
    {/each}
</select>

{#if carrier}
    <p class="help">Racks</p>
    {#each rackSquads as r}
        <label class="checkbox">
            <input
                type="radio"
                name="gb-src"
                checked={rackId === r.rackId}
                on:change={() => pickRack(r)}
            />
            Rack {r.rackId} ({r.boats.length} boats)
        </label>
    {/each}
    <p class="help">Boat bays</p>
    {#each baySquads as b}
        <label class="checkbox">
            <input
                type="radio"
                name="gb-src"
                checked={bayId === b.bayId}
                on:change={() => pickBay(b)}
            />
            Bay {b.bayId} ({b.boats.length} boats)
        </label>
    {/each}
    {#if squadronTokenId}
        {#if selectedGunboat}
            <p class="mb-2">{gunboatGroupOptionLabel(selectedGunboat)}</p>
        {/if}
        <div class="field">
            <label class="label" for="gb-callsign">Squadron callsign</label>
            {#if squadronHasCallsign}
                <p class="help">
                    <strong>{normalizeCallsign(selectedGunboat?.callsign)}</strong> (already set)
                </p>
            {:else}
                <input
                    id="gb-callsign"
                    class="input"
                    type="text"
                    maxlength="32"
                    placeholder="e.g. Grey Wolves"
                    bind:value={callsignDraft}
                />
                <p class="help">Required on first launch. Shown on the map and in logs.</p>
            {/if}
        </div>
        <ActError issues={callsignIssues} />
        <p class="help mb-2">
            {#if launchPos}
                Position ({launchPos.x.toFixed(2)}, {launchPos.y.toFixed(2)})
                {#if launchWarn}
                    <span class="has-text-warning"> — {launchWarn}</span>
                {:else}
                    <span class="has-text-success"> — in zone</span>
                {/if}
            {:else}
                Click inside the amber ring on the map to set the launch position.
            {/if}
        </p>
        <button
            class="button is-primary"
            disabled={
                !launchPos ||
                !!launchWarn ||
                callsignIssues.some((i) => i.severity === "error") ||
                (!squadronHasCallsign && !normalizeCallsign(callsignDraft))
            }
            on:click={submit}
        >
            Launch
        </button>
    {:else}
        <p class="help">Select a rack or boat bay to launch.</p>
    {/if}
{/if}
