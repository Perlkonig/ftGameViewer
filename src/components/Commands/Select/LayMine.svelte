<script lang="ts">
    import { createEventDispatcher, onDestroy } from "svelte";
    import { currentState } from "@/stores/derivedState";
    import { clickMode } from "@/stores/writeClickMode";
    import { beacon } from "@/stores/writeBeacon";
    import { annotations } from "@/stores/writeAnnotations";
    import { appendGameCommand } from "@/lib/game/appendCommand";
    import type { FullThrustGameCommand } from "@/schemas/commands";
    import { toast } from "@zerodevx/svelte-toast";
    import ActError from "./ActError.svelte";
    import { validateLayMine } from "@/lib/game/commandValidation";
    import type { ShipGameState } from "@/lib/game/shipSystems";
    import { declaredMineLayersFromPending, mineOrdnanceId } from "@/lib/game/mineMovement";
    import { previewPathForShip } from "@/lib/game/movementResolve";
    import {
        nearestPointOnPath,
        pointOnPathAtFraction,
        PATH_SNAP_TOLERANCE_MU,
    } from "@/lib/game/mineMovement";
    import { ammunitionRemaining, systemDesignCapacity } from "@/lib/ammunition";
    import { focusMapOnShipId } from "@/lib/actMapInteraction";

    const dispatch = createEventDispatcher();

    $: pendingMoves = $currentState.pendingMoves ?? [];
    $: pendingLayMines = $currentState.pendingLayMines ?? [];

    $: eligibleShips =
        $currentState.state?.objects?.filter((o) => {
            if (o.objType !== "ship" || !o.position) return false;
            const layers = declaredMineLayersFromPending(pendingMoves, o.id);
            return layers.some(
                (systemId) =>
                    !pendingLayMines.some(
                        (l) =>
                            l.name === "layMine" &&
                            (l as { ship?: string }).ship === o.id &&
                            (l as { systemId?: string }).systemId === systemId
                    )
            );
        }) ?? [];

    let shipId = "";
    let systemId = "";
    let pathFraction = 50;
    let prevShipId = "";

    $: if (shipId && shipId !== prevShipId) {
        prevShipId = shipId;
        focusMapOnShipId(
            shipId,
            eligibleShips as import("@/schemas/position").FullThrustGameObjects[]
        );
    }

    $clickMode = "beacon";
    onDestroy(() => {
        $clickMode = undefined;
        $beacon = undefined;
        annotations.set([]);
    });

    $: layShip = eligibleShips.find((s) => s.id === shipId) as ShipGameState | undefined;
    $: declaredLayers = layShip ? declaredMineLayersFromPending(pendingMoves, layShip.id) : [];
    $: availableLayers = declaredLayers.filter(
        (id) =>
            !pendingLayMines.some(
                (l) =>
                    l.name === "layMine" &&
                    (l as { ship?: string }).ship === shipId &&
                    (l as { systemId?: string }).systemId === id
            )
    );
    $: if (availableLayers.length && !availableLayers.includes(systemId)) {
        systemId = availableLayers[0];
    }
    $: path = layShip ? previewPathForShip(layShip, pendingMoves) : [];
    $: snappedBeacon =
        $beacon && path.length
            ? nearestPointOnPath(path, { x: $beacon.x, y: $beacon.y })
            : undefined;
    $: sliderPosition = path.length ? pointOnPathAtFraction(path, pathFraction / 100) : undefined;
    $: placementPosition = snappedBeacon ?? sliderPosition;

    $: if (layShip && path.length) {
        annotations.set([
            {
                id: "lay_mine_path",
                type: "POLY",
                note: { points: path },
                color: "#ffaa00",
                strokeWidth: 4,
            },
            ...(placementPosition
                ? [
                      {
                          id: "lay_mine_point",
                          type: "CIRCLE" as const,
                          note: {
                              c: {
                                  x: placementPosition.x,
                                  y: placementPosition.y,
                              },
                              r: PATH_SNAP_TOLERANCE_MU,
                          },
                          color: "#ff4444",
                          strokeWidth: 2,
                      },
                  ]
                : []),
        ]);
    } else {
        annotations.set([]);
    }

    $: draftCmd = placementPosition
        ? ({
              name: "layMine",
              ship: shipId,
              systemId,
              position: placementPosition,
              id: mineOrdnanceId(
                  { ship: shipId, systemId, position: placementPosition },
                  $currentState.meta?.turn ?? 1
              ),
          } as FullThrustGameCommand)
        : undefined;

    $: actIssues =
        draftCmd && layShip
            ? validateLayMine(
                  {
                      meta: $currentState.meta!,
                      position: $currentState.state!,
                      pendingMoves,
                      pendingLayMines,
                  },
                  draftCmd as {
                      ship?: string;
                      systemId?: string;
                      position?: { x: number; y: number };
                  }
              )
            : [];

    const submit = () => {
        if (!shipId || !systemId || !placementPosition) {
            toast.push("Select ship, layer, and position along movement path");
            return;
        }
        const turn = $currentState.meta?.turn ?? 1;
        const cmd = {
            name: "layMine",
            ship: shipId,
            systemId,
            position: placementPosition,
            id: mineOrdnanceId({ ship: shipId, systemId, position: placementPosition }, turn),
        } as FullThrustGameCommand;
        appendGameCommand(cmd);
        toast.push("Mine placement recorded — resolves with movement");
        dispatch("done");
    };
</script>

<p class="help">
    Phase 5 only — place mines along each ship's pending movement path. Click the map to snap to
    the path, or use the slider.
</p>
<div class="field">
    <label class="label" for="ship">Ship</label>
    <div class="select">
        <select id="ship" bind:value={shipId}>
            <option value="">--</option>
            {#each eligibleShips as s}
                <option value={s.id}>{s.id}</option>
            {/each}
        </select>
    </div>
</div>

{#if layShip}
    <div class="field">
        <label class="label" for="layer">Minelayer</label>
        <div class="select">
            <select id="layer" bind:value={systemId}>
                {#each availableLayers as id}
                    {@const remaining = ammunitionRemaining(layShip, id)}
                    {@const cap = systemDesignCapacity(layShip, id) ?? remaining}
                    <option value={id}>
                        {id} ({remaining}/{cap} loads)
                    </option>
                {/each}
            </select>
        </div>
    </div>

    <div class="field">
        <label class="label" for="pathFrac">Position along path ({pathFraction}%)</label>
        <input
            id="pathFrac"
            class="slider is-fullwidth"
            type="range"
            min="0"
            max="100"
            bind:value={pathFraction}
        />
    </div>

    <p class="help">
        Map click snaps to path
        {#if placementPosition}
            — ({placementPosition.x.toFixed(2)}, {placementPosition.y.toFixed(2)})
        {/if}
    </p>

    <button class="button is-primary" on:click={submit}>Record placement</button>
    <ActError issues={actIssues} />
{:else if shipId}
    <p class="help has-text-warning">No undeclared minelayer placements for this ship.</p>
{/if}
