<script lang="ts">
    import { createEventDispatcher, onDestroy } from "svelte";
    import { currentState } from "@/stores/derivedState";
    import { selectedObject } from "@/stores/writeSelectedObject";
    import { clickMode } from "@/stores/writeClickMode";
    import { annotations } from "@/stores/writeAnnotations";
import {
    applyCinematicMovement,
    turnBudget,
    cinematicFinalSpeed,
    cinematicOrdersFromAllocation,
    type ClockFacing,
    type CinematicAllocation,
} from "@/lib/game/movement";
    import {
        applyVectorMovement,
        facingToCourse,
        isVectorShip,
        maneuverPoints,
        type PushDirection,
        type VectorManeuver,
    } from "@/lib/game/vectorMovement";
    import { appendGameCommand } from "@/lib/game/appendCommand";
    import type { FullThrustGameCommand } from "@/schemas/commands";
    import { toast } from "@zerodevx/svelte-toast";
    import ActError from "./ActError.svelte";
    import {
        validateCinematicAllocation,
        validateVectorManeuverQueue,
    } from "@/lib/game/commandValidation";
    import { shipThrust, type ShipGameState, operationalMineSweepers, operationalMinelayers, operationalHangars } from "@/lib/game/shipSystems";
    import { validateMoveShipLaunchFighters } from "@/lib/game/fighterLaunchDeclare";
    import { ammunitionRemaining, systemDesignCapacity } from "@/lib/ammunition";
    import { resolveMoveFromOrder } from "@/lib/game/movementResolve";
    import { validateMoveShipMineOptions } from "@/lib/game/commandValidation";
    import { focusMapOnShipId } from "@/lib/actMapInteraction";

    const dispatch = createEventDispatcher();

    $: phase = $currentState.meta?.phase ?? 1;
    $: submitLabel = phase < 5 ? "Write movement order" : "Apply movement";
    $: ships =
        $currentState.state?.objects?.filter((o) => o.objType === "ship" && o.position) ??
        [];

    let shipId = "";
    let speedChange: "hold" | "accel" | "decel" = "hold";
    let speedChangeThrust = 0;
    let turns = 0;
    let advancedDrives = false;

    // Vector maneuver inputs
    let rotateTurns = 0;
    let pushDirection: PushDirection = "port";
    let pushDistance = 0;
    let mainDriveThrust = 0;
    let maneuvers: VectorManeuver[] = [];
    let sweepForMines = false;
    let deployMineLayers: string[] = [];
    let launchFighters = false;

    $: selectedShip = ships.find((s) => s.id === shipId);
    $: thrust = selectedShip ? shipThrust(selectedShip as ShipGameState) : 4;
    $: maxTurns = turnBudget(thrust, advancedDrives);
    $: shipSpeed = Number(selectedShip?.speed ?? 0) || 0;
    $: vectorShip = selectedShip
        ? isVectorShip(
              selectedShip as { movementMode?: "cinematic" | "vector"; course?: number }
          )
        : false;
    $: maneuverBudget = maneuverPoints(thrust);
    $: shipCourse =
        selectedShip && vectorShip
            ? Number(selectedShip.course ?? facingToCourse(selectedShip.facing as ClockFacing))
            : 0;

    $: cinematicAllocation = {
        speedChange,
        speedChangeThrust,
        turns,
    } satisfies CinematicAllocation;
    $: finalSpeed =
        selectedShip != null
            ? cinematicFinalSpeed(shipSpeed, thrust, cinematicAllocation)
            : shipSpeed;
    $: speedThrustSpent =
        speedChange === "hold" ? 0 : Math.max(0, Number(speedChangeThrust) || 0);
    $: turnThrustSpent = Math.abs(Number(turns) || 0);

    $: fighterHangars =
        selectedShip && phase === 1
            ? operationalHangars(selectedShip as ShipGameState)
            : [];
    $: mineSweepers = selectedShip
        ? operationalMineSweepers(selectedShip as ShipGameState)
        : [];
    $: minelayers = selectedShip
        ? operationalMinelayers(selectedShip as ShipGameState)
        : [];
    $: mineOrderIssues =
        selectedShip && phase < 5
            ? validateMoveShipMineOptions(selectedShip as ShipGameState, {
                  sweepForMines,
                  deployMineLayers,
              })
            : [];

    $: draftMoveCommand = (): FullThrustGameCommand | undefined => {
        if (!selectedShip) return undefined;
        const mineOpts =
            phase < 5
                ? {
                      ...(sweepForMines ? { sweepForMines: true } : {}),
                      ...(deployMineLayers.length ? { deployMineLayers } : {}),
                  }
                : {};
        const fighterOpts =
            phase === 1 && launchFighters ? { launchFighters: true } : {};
        return vectorShip
            ? ({
                  name: "moveShip",
                  id: selectedShip.id,
                  vectorManeuvers: maneuvers,
                  ...mineOpts,
                  ...fighterOpts,
              } as FullThrustGameCommand)
            : ({
                  name: "moveShip",
                  id: selectedShip.id,
                  cinematicAllocation,
                  advancedDrives,
                  ...mineOpts,
                  ...fighterOpts,
              } as FullThrustGameCommand);
    };

    $: actIssues =
        selectedShip && selectedShip.position
            ? [
                  ...(vectorShip
                      ? validateVectorManeuverQueue(selectedShip as ShipGameState, maneuvers)
                      : validateCinematicAllocation(
                            selectedShip as ShipGameState,
                            cinematicAllocation,
                            advancedDrives
                        )),
                  ...mineOrderIssues,
                  ...(draftMoveCommand()
                      ? validateMoveShipLaunchFighters(
                            selectedShip as ShipGameState,
                            draftMoveCommand()!
                        )
                      : []),
              ]
            : [];

    $: if (selectedShip) {
        $selectedObject = `ship_${selectedShip.id}`;
        focusMapOnShipId(selectedShip.id, ships as import("@/schemas/position").FullThrustGameObjects[], {
            select: false,
        });
        preview();
    }

    onDestroy(() => {
        $clickMode = undefined;
        annotations.set([]);
    });

    const resetCinematicInputs = () => {
        speedChange = "hold";
        speedChangeThrust = 0;
        turns = 0;
        advancedDrives = false;
        sweepForMines = false;
        deployMineLayers = [];
        launchFighters = false;
    };

    const resetVectorInputs = () => {
        rotateTurns = 0;
        pushDistance = 0;
        mainDriveThrust = 0;
        maneuvers = [];
        sweepForMines = false;
        deployMineLayers = [];
        launchFighters = false;
    };

    const toggleMineLayer = (systemId: string, checked: boolean) => {
        if (checked) {
            if (!deployMineLayers.includes(systemId)) {
                deployMineLayers = [...deployMineLayers, systemId];
            }
        } else {
            deployMineLayers = deployMineLayers.filter((id) => id !== systemId);
        }
    };

    const addRotate = () => {
        if (rotateTurns === 0) {
            toast.push("Set rotation turns first");
            return;
        }
        maneuvers = [...maneuvers, { type: "rotate", turns: rotateTurns }];
        rotateTurns = 0;
        preview();
    };

    const addPush = () => {
        if (pushDistance <= 0) {
            toast.push("Push distance must be positive");
            return;
        }
        maneuvers = [
            ...maneuvers,
            { type: "push", direction: pushDirection, distance: pushDistance },
        ];
        pushDistance = 0;
        preview();
    };

    const addMainDrive = () => {
        if (mainDriveThrust <= 0) {
            toast.push("Main drive thrust must be positive");
            return;
        }
        maneuvers = [...maneuvers, { type: "mainDrive", thrust: mainDriveThrust }];
        mainDriveThrust = 0;
        preview();
    };

    const clearManeuvers = () => {
        maneuvers = [];
        preview();
    };

    const preview = () => {
        if (!selectedShip || !selectedShip.position) {
            annotations.set([]);
            return;
        }
        const pos = selectedShip.position as { x: number; y: number };
        if (vectorShip) {
            const result = applyVectorMovement(
                {
                    position: pos,
                    facing: selectedShip.facing as ClockFacing,
                    course: shipCourse,
                    speed: shipSpeed,
                    thrust,
                },
                { maneuvers }
            );
            annotations.set([
                {
                    id: "move_preview",
                    type: "POLY",
                    note: { points: result.path },
                    color: "#00ccff",
                    strokeWidth: 4,
                },
            ]);
            return;
        }
        const orders = cinematicOrdersFromAllocation(
            shipSpeed,
            thrust,
            cinematicAllocation
        );
        const result = applyCinematicMovement(
            {
                position: pos,
                facing: selectedShip.facing as ClockFacing,
                speed: shipSpeed,
                thrust,
                advancedDrives,
            },
            orders
        );
        annotations.set([
            {
                id: "move_preview",
                type: "POLY",
                note: { points: result.path },
                color: "#00ff88",
                strokeWidth: 4,
            },
        ]);
    };

    $: if (shipId) preview();

    const submit = () => {
        if (!selectedShip || !selectedShip.position) {
            toast.push("Select a ship");
            return;
        }
        if (vectorShip) {
            const issues = validateVectorManeuverQueue(
                selectedShip as ShipGameState,
                maneuvers
            );
            for (const issue of issues) {
                toast.push(issue.message);
            }
        } else {
            const issues = validateCinematicAllocation(
                selectedShip as ShipGameState,
                cinematicAllocation,
                advancedDrives
            );
            for (const issue of issues) {
                toast.push(issue.message);
            }
        }

        const mineOpts =
            phase < 5
                ? {
                      ...(sweepForMines ? { sweepForMines: true } : {}),
                      ...(deployMineLayers.length ? { deployMineLayers } : {}),
                  }
                : {};
        const fighterOpts =
            phase === 1 && launchFighters ? { launchFighters: true } : {};

        const cmd = vectorShip
            ? ({
                  name: "moveShip",
                  id: selectedShip.id,
                  vectorManeuvers: maneuvers,
                  ...mineOpts,
                  ...fighterOpts,
              } as FullThrustGameCommand)
            : ({
                  name: "moveShip",
                  id: selectedShip.id,
                  cinematicAllocation,
                  advancedDrives,
                  ...mineOpts,
                  ...fighterOpts,
              } as FullThrustGameCommand);

        const dest = appendGameCommand(cmd);
        const patch = resolveMoveFromOrder(selectedShip as ShipGameState, cmd);
        toast.push(
            dest === "master"
                ? phase < 5
                    ? `Movement order for ${selectedShip.id}`
                    : `Applied movement for ${selectedShip.id}`
                : `Movement for ${selectedShip.id} added to proposals`
        );
        if (patch.warnings.length) toast.push(patch.warnings.join("; "));
        annotations.set([]);
        if (vectorShip) resetVectorInputs();
        else resetCinematicInputs();
        dispatch("done");
    };
</script>

<div class="field">
    <label class="label" for="ship">Ship</label>
    <div class="select">
        <select id="ship" bind:value={shipId} on:change={() => { resetVectorInputs(); resetCinematicInputs(); preview(); }}>
            <option value="">-- select --</option>
            {#each ships as s}
                <option value={s.id}>
                    {s.id} ({s.owner}){isVectorShip(s as { movementMode?: "cinematic" | "vector"; course?: number })
                        ? " [vector]"
                        : ""}
                </option>
            {/each}
        </select>
    </div>
</div>

{#if selectedShip}
    {#if vectorShip}
        <p class="help">
            Vector ship — thrust {thrust}, maneuver points {maneuverBudget}, speed {shipSpeed},
            course {shipCourse.toFixed(0)}°, facing {selectedShip.facing}
        </p>
        <p class="help is-size-7">
            Drift along course, then execute maneuvers in order. New speed/course come from total
            displacement.
        </p>

        <div class="box">
            <p class="heading">Maneuver queue</p>
            {#if maneuvers.length === 0}
                <p class="is-size-7 has-text-grey">No maneuvers queued</p>
            {:else}
                <ol class="is-size-7">
                    {#each maneuvers as m, i}
                        <li>
                            {#if m.type === "rotate"}Rotate {m.turns} clock
                            {:else if m.type === "push"}Push {m.distance} MU {m.direction}
                            {:else}Main drive {m.thrust} MU{/if}
                        </li>
                    {/each}
                </ol>
            {/if}
            <button type="button" class="button is-small is-light mt-1" on:click={clearManeuvers}>
                Clear queue
            </button>
        </div>

        <div class="field is-grouped is-grouped-multiline">
            <div class="control">
                <label class="label is-small" for="rot">Rotate (clock faces)</label>
                <input id="rot" class="input is-small" type="number" bind:value={rotateTurns} />
            </div>
            <div class="control">
                <label class="label is-small">&nbsp;</label>
                <button type="button" class="button is-small" on:click={addRotate}>Add rotate</button>
            </div>
        </div>

        <div class="field is-grouped is-grouped-multiline">
            <div class="control">
                <label class="label is-small" for="pushd">Push MU</label>
                <input id="pushd" class="input is-small" type="number" min="0" bind:value={pushDistance} />
            </div>
            <div class="control">
                <label class="label is-small" for="pushdir">Direction</label>
                <div class="select is-small">
                    <select id="pushdir" bind:value={pushDirection}>
                        <option value="port">port</option>
                        <option value="starboard">starboard</option>
                        <option value="reverse">reverse</option>
                    </select>
                </div>
            </div>
            <div class="control">
                <label class="label is-small">&nbsp;</label>
                <button type="button" class="button is-small" on:click={addPush}>Add push</button>
            </div>
        </div>

        <div class="field is-grouped is-grouped-multiline">
            <div class="control">
                <label class="label is-small" for="md">Main drive MU</label>
                <input id="md" class="input is-small" type="number" min="0" bind:value={mainDriveThrust} />
            </div>
            <div class="control">
                <label class="label is-small">&nbsp;</label>
                <button type="button" class="button is-small" on:click={addMainDrive}>Add main drive</button>
            </div>
        </div>
    {:else}
        <p class="help">
            Cinematic — thrust {thrust}, turn budget {maxTurns}, speed {shipSpeed}, facing
            {selectedShip.facing}
        </p>
        <p class="help is-size-7">
            Allocate thrust to speed change and turning. Up to {thrust} for velocity change,
            up to {maxTurns} clock faces for turns. Final speed is computed.
        </p>

        <div class="box">
            <p class="heading">Thrust allocation</p>
            <p class="is-size-7">
                Speed thrust {speedThrustSpent}/{thrust} · Turns {turnThrustSpent}/{maxTurns}
            </p>
            <p class="is-size-7">
                Final speed: <strong>{finalSpeed}</strong> MU (current {shipSpeed})
            </p>
        </div>

        <div class="field is-grouped is-grouped-multiline">
            <div class="control">
                <label class="label is-small" for="speedChg">Speed change</label>
                <div class="select is-small">
                    <select
                        id="speedChg"
                        bind:value={speedChange}
                        on:change={() => {
                            if (speedChange === "hold") speedChangeThrust = 0;
                            preview();
                        }}
                    >
                        <option value="hold">Hold speed</option>
                        <option value="accel">Accelerate</option>
                        <option value="decel">Decelerate</option>
                    </select>
                </div>
            </div>
            <div class="control">
                <label class="label is-small" for="speedThrust">Thrust (MU)</label>
                <input
                    id="speedThrust"
                    class="input is-small"
                    type="number"
                    min="0"
                    max={thrust}
                    bind:value={speedChangeThrust}
                    disabled={speedChange === "hold"}
                    on:input={preview}
                />
            </div>
        </div>

        <div class="field is-grouped is-grouped-multiline">
            <div class="control">
                <label class="label is-small" for="turns">Turns (+ starboard / − port)</label>
                <input
                    id="turns"
                    class="input is-small"
                    type="number"
                    bind:value={turns}
                    on:input={preview}
                />
            </div>
        </div>

        <label class="checkbox">
            <input type="checkbox" bind:checked={advancedDrives} on:change={preview} />
            Advanced drives (full thrust for turns)
        </label>
    {/if}

    {#if phase === 1 && fighterHangars.length > 0}
        <div class="box mt-3">
            <p class="heading">Fighters</p>
            <label class="checkbox">
                <input type="checkbox" bind:checked={launchFighters} />
                Launch fighters (phase 3) — movement may not use thrust
            </label>
        </div>
    {/if}

    {#if phase < 5 && (mineSweepers.length > 0 || minelayers.length > 0)}
        <div class="box mt-3">
            <p class="heading">Mines</p>
            {#if mineSweepers.length > 0}
                <label class="checkbox">
                    <input type="checkbox" bind:checked={sweepForMines} />
                    Sweep for mines
                </label>
            {/if}
            {#each minelayers as layer}
                {@const remaining = ammunitionRemaining(selectedShip as ShipGameState, layer.id)}
                {@const cap = systemDesignCapacity(selectedShip as ShipGameState, layer.id) ?? remaining}
                <label class="checkbox is-block">
                    <input
                        type="checkbox"
                        checked={deployMineLayers.includes(layer.id)}
                        disabled={remaining <= 0}
                        on:change={(e) =>
                            toggleMineLayer(layer.id, e.currentTarget.checked)}
                    />
                    Lay mine from layer {layer.id} ({remaining}/{cap})
                </label>
            {/each}
        </div>
    {/if}

    <div class="control mt-3">
        <button class="button is-primary" on:click={submit}>
            {submitLabel}
        </button>
        <ActError issues={actIssues} />
    </div>
{/if}
