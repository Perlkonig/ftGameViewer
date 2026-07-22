<script lang="ts">
    import { createEventDispatcher, onDestroy, onMount } from "svelte";
    import { currentState } from "@/stores/derivedState";
    import { clickMode } from "@/stores/writeClickMode";
    import { beacon, type IBeacon } from "@/stores/writeBeacon";
    import { annotations, type IAnnotation } from "@/stores/writeAnnotations";
    import { appendGameCommands } from "@/lib/game/appendCommand";
    import type { FullThrustGameCommand } from "@/schemas/commands";
    import { toast } from "@zerodevx/svelte-toast";
    import ActError from "./ActError.svelte";
    import type { ShipGameState } from "@/lib/game/shipSystems";
    import { launchableWings, wingIdForHangar } from "@/lib/hangars";
    import {
        dockedFighterForHangar,
        normalizeCallsign,
        wingLaunchRowLabel,
    } from "@/lib/game/fighterLabel";
    import {
        validateLaunchFightersDeclaration,
        validateMoveShipLaunchFighters,
    } from "@/lib/game/fighterLaunchDeclare";
    import { pendingMoveForShip } from "@/lib/game/movementResolve";
    import { distance } from "@/lib/game/movement";
    import type { ResolvedHangarOccupancy } from "ftlibship";
    import type { FoldState } from "@/lib/game/applyCommand";
    import { DEFAULT_META } from "@/lib/game/types";
    import { focusMapOnShipId } from "@/lib/actMapInteraction";

    const dispatch = createEventDispatcher();

    $: pendingMoves = $currentState.pendingMoves ?? [];
    $: carriers =
        $currentState.state?.objects?.filter(
            (o) => o.objType === "ship" && o.position
        ) ?? [];

    let shipId = "";
    let lastShipId = "";
    let selectedHangars: Record<string, boolean> = {};
    let wingPositions: Record<string, { x: number; y: number }> = {};
    let wingCallsigns: Record<string, string> = {};
    let placingHangarId: string | null = null;
    let lastAssignedBeaconKey = "";

    $: carrier = carriers.find((s) => s.id === shipId) as ShipGameState | undefined;
    $: wings =
        carrier && $currentState.state
            ? launchableWings(carrier, $currentState.state)
            : [];
    $: pickedWings = wings.filter((w) => selectedHangars[w.hangarId]);
    $: launchIssues =
        carrier && shipId && $currentState.state
            ? [
                  ...validateLaunchFightersDeclaration(
                      {
                          meta: $currentState.meta ?? DEFAULT_META(),
                          position: $currentState.state,
                          pendingMoves,
                      } as FoldState,
                      shipId
                  ),
                  ...(() => {
                      const move = pendingMoveForShip(pendingMoves, shipId);
                      return move
                          ? validateMoveShipLaunchFighters(carrier, move)
                          : [];
                  })(),
              ]
            : [];

    $: if (shipId !== lastShipId) {
        lastShipId = shipId;
        selectedHangars = {};
        wingPositions = {};
        wingCallsigns = {};
        placingHangarId = null;
        lastAssignedBeaconKey = "";
        beacon.set(undefined);
        if (shipId) focusMapOnShipId(shipId, carriers as import("@/schemas/position").FullThrustGameObjects[]);
    }

    const assignBeacon = (val: IBeacon) => {
        if (!carrier) return;
        const picked = wings.filter((w) => selectedHangars[w.hangarId]);
        if (picked.length === 0) {
            toast.push("Check at least one wing before clicking the map");
            return;
        }
        let target = placingHangarId;
        if (!target || !selectedHangars[target]) {
            const unplaced = picked.find((w) => !wingPositions[w.hangarId]);
            target = unplaced?.hangarId ?? null;
        }
        if (!target) return;
        wingPositions = { ...wingPositions, [target]: { x: val.x, y: val.y } };
        placingHangarId = target;
        const next = picked.find(
            (w) => w.hangarId !== target && !wingPositions[w.hangarId]
        );
        if (next) {
            placingHangarId = next.hangarId;
            lastAssignedBeaconKey = "";
        }
    };

    $: if ($beacon && carrier) {
        const key = `${$beacon.x.toFixed(4)},${$beacon.y.toFixed(4)}`;
        if (key !== lastAssignedBeaconKey) {
            const picked = wings.filter((w) => selectedHangars[w.hangarId]);
            if (picked.length === 0) {
                toast.push("Check at least one wing before clicking the map");
            } else {
                lastAssignedBeaconKey = key;
                assignBeacon($beacon);
            }
        }
    }

    onMount(() => {
        clickMode.set("beacon");
        beacon.set(undefined);
    });

    onDestroy(() => {
        clickMode.set(undefined);
        beacon.set(undefined);
        annotations.set([]);
    });

    const placementWarning = (pos: { x: number; y: number }): string | undefined => {
        if (!carrier?.position || !("x" in carrier.position)) return undefined;
        const d = distance(carrier.position, pos);
        if (d > 1.05) return `${d.toFixed(2)} MU from carrier (max 1 MU)`;
        return undefined;
    };

    $: {
        const ann: IAnnotation[] = [];
        if (carrier?.position && "x" in carrier.position) {
            ann.push({
                id: "fighter_launch_zone",
                type: "CIRCLE",
                note: { c: carrier.position, r: 1 },
                color: "#66ccff",
                opacity: 0.12,
                strokeWidth: 2,
            });
            for (const w of pickedWings) {
                const p = wingPositions[w.hangarId];
                if (p) {
                    ann.push({
                        id: `fighter_launch_${w.hangarId}`,
                        type: "CIRCLE",
                        note: { c: p, r: 0.12 },
                        color: "#88ff88",
                        opacity: 0.85,
                        strokeWidth: 2,
                    });
                }
            }
        }
        annotations.set(ann);
    }

    const wingLabel = (w: ResolvedHangarOccupancy) => {
        const fighterObj = dockedFighterForHangar($currentState.state, shipId, w.hangarId);
        return wingLaunchRowLabel(w.hangarId, w, fighterObj);
    };

    const wingHasCallsign = (hangarId: string): boolean => {
        const fighterObj = dockedFighterForHangar($currentState.state, shipId, hangarId);
        return !!normalizeCallsign((fighterObj as { callsign?: string } | undefined)?.callsign);
    };

    const toggleWing = (hangarId: string) => {
        const next = !(selectedHangars[hangarId] ?? false);
        selectedHangars = { ...selectedHangars, [hangarId]: next };
        if (!next) {
            const { [hangarId]: _, ...rest } = wingPositions;
            wingPositions = rest;
            if (placingHangarId === hangarId) {
                placingHangarId =
                    wings.find((w) => selectedHangars[w.hangarId])?.hangarId ?? null;
            }
        } else {
            placingHangarId = hangarId;
        }
    };

    const focusWing = (hangarId: string) => {
        placingHangarId = hangarId;
        lastAssignedBeaconKey = "";
        const existing = wingPositions[hangarId];
        beacon.set(existing ?? undefined);
    };

    const submit = () => {
        if (!carrier) {
            toast.push("Select a carrier");
            return;
        }
        if (pickedWings.length === 0) {
            toast.push("Select at least one wing to launch");
            return;
        }
        const missing = pickedWings.filter((w) => !wingPositions[w.hangarId]);
        if (missing.length > 0) {
            toast.push(`Set map positions for: ${missing.map((w) => w.hangarId).join(", ")}`);
            placingHangarId = missing[0].hangarId;
            return;
        }
        for (const w of pickedWings) {
            const pos = wingPositions[w.hangarId];
            const warn = placementWarning(pos);
            if (warn) {
                toast.push(`${w.hangarId}: ${warn}`);
                placingHangarId = w.hangarId;
                return;
            }
        }
        const cmds: FullThrustGameCommand[] = [];
        for (const w of pickedWings) {
            const pos = wingPositions[w.hangarId];
            const id = wingIdForHangar(shipId, w.hangarId);
            const existing = dockedFighterForHangar($currentState.state, shipId, w.hangarId);
            const hasCallsign = !!normalizeCallsign(
                (existing as { callsign?: string } | undefined)?.callsign
            );
            const callsign = hasCallsign
                ? undefined
                : normalizeCallsign(wingCallsigns[w.hangarId]);
            const cmd = {
                name: "launchFighters",
                ship: shipId,
                id,
                hangarId: w.hangarId,
                position: { x: pos.x, y: pos.y },
                facing: carrier.facing,
            } as FullThrustGameCommand & { callsign?: string };
            if (callsign) cmd.callsign = callsign;
            cmds.push(cmd);
        }
        appendGameCommands(cmds);
        toast.push(`Launched ${pickedWings.length} wing(s)`);
        dispatch("done");
    };
</script>

<p class="help">Phase 3 — launch docked fighter wings within 1 MU of the carrier.</p>

<div class="field">
    <label class="label" for="ship">Carrier</label>
    <div class="select">
        <select id="ship" bind:value={shipId}>
            <option value="">--</option>
            {#each carriers as s}
                <option value={s.id}>{s.id}</option>
            {/each}
        </select>
    </div>
</div>

{#if carrier}
    <ActError issues={launchIssues} />
    {#if wings.length === 0}
        <p class="help has-text-warning">No docked wings available to launch.</p>
    {:else}
        <div class="field">
            <p class="label">Wings to launch</p>
            <p class="help mb-2">
                Check wings, then click the map for each wing's launch position (within 1 MU of the
                carrier). The highlighted wing receives the next map click.
            </p>
            {#each wings as w}
                {@const pos = wingPositions[w.hangarId]}
                {@const warn = pos ? placementWarning(pos) : undefined}
                <div
                    class="wing-row"
                    class:is-active={placingHangarId === w.hangarId && selectedHangars[w.hangarId]}
                >
                    <label class="checkbox wing-check">
                        <input
                            type="checkbox"
                            checked={selectedHangars[w.hangarId] ?? false}
                            on:change={() => toggleWing(w.hangarId)}
                        />
                        {wingLabel(w)}
                    </label>
                    {#if selectedHangars[w.hangarId]}
                        {#if !wingHasCallsign(w.hangarId)}
                            <div class="wing-name">
                                <label class="label is-size-7" for="wing-name-{w.hangarId}">
                                    Wing name (optional)
                                </label>
                                <input
                                    id="wing-name-{w.hangarId}"
                                    class="input is-small"
                                    type="text"
                                    maxlength="32"
                                    placeholder="e.g. Red 1"
                                    bind:value={wingCallsigns[w.hangarId]}
                                />
                            </div>
                        {/if}
                        <div class="wing-placement">
                            <button
                                type="button"
                                class="button is-small"
                                class:is-info={placingHangarId === w.hangarId}
                                on:click={() => focusWing(w.hangarId)}
                            >
                                {pos ? "Reposition" : "Place on map"}
                            </button>
                            {#if pos}
                                <span class="help placement-coords">
                                    ({pos.x.toFixed(2)}, {pos.y.toFixed(2)})
                                    {#if warn}
                                        <span class="has-text-warning"> — {warn}</span>
                                    {/if}
                                </span>
                            {:else if placingHangarId === w.hangarId}
                                <span class="help has-text-info">Click map…</span>
                            {/if}
                        </div>
                    {/if}
                </div>
            {/each}
        </div>

        <button
            class="button is-primary"
            disabled={pickedWings.length === 0 ||
                !pickedWings.every((w) => wingPositions[w.hangarId])}
            on:click={submit}
        >
            Launch selected wings
        </button>
    {/if}
{/if}

<style>
    .wing-row {
        border: 1px solid transparent;
        border-radius: 4px;
        margin-bottom: 0.35rem;
    }

    .wing-row.is-active {
        border-color: #3273dc;
        background: rgba(50, 115, 220, 0.06);
    }

    .wing-check {
        display: block;
        padding: 0.55rem 0.75rem;
    }

    .wing-name {
        padding: 0 0.75rem 0.35rem 2.1rem;
    }

    .wing-placement {
        padding: 0 0.75rem 0.55rem 2.1rem;
    }

    .placement-coords {
        display: inline-block;
        margin-left: 0.5rem;
    }
</style>
