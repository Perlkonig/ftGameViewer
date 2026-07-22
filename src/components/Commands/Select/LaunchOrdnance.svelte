<script lang="ts">
    import { createEventDispatcher, onDestroy, onMount, tick } from "svelte";
    import { currentState } from "@/stores/derivedState";
    import { clickMode } from "@/stores/writeClickMode";
    import { beacon, type IBeacon } from "@/stores/writeBeacon";
    import { annotations, type IAnnotation } from "@/stores/writeAnnotations";
    import { focusMapOnBounds, focusMapOnPoint } from "@/stores/writeMapView";
    import { focusMapOnShipId, focusMapOnOrdnanceId } from "@/lib/actMapInteraction";
    import { appendGameCommand, appendGameCommands } from "@/lib/game/appendCommand";
    import type { FullThrustGameCommand } from "@/schemas/commands";
    import type { FullThrustShip } from "ftlibship";
    import { nanoid } from "nanoid";
    import { toast } from "@zerodevx/svelte-toast";
    import ActError from "./ActError.svelte";
    import RenderSsd from "@/components/RenderSSD.svelte";
    import { buildShipRenderOpts } from "@/lib/ssdRenderOpts";
    import { boundsFromAnnotations } from "@/lib/weaponAnnotations";
    import { currentActivationId } from "@/lib/game/phase";
    import { findShipSystem, type ShipGameState } from "@/lib/game/shipSystems";
    import {
        listLaunchableSystems,
        validatePlacement,
        validateRocketTarget,
        multistageIntermediatePoint,
        launchRange,
        launchAnnotationsForSystem,
        isOrdnanceLauncherSystem,
        type LaunchableSystem,
    } from "@/lib/game/ordnanceLaunch";
    import { distance } from "@/lib/game/movement";
    import type { ValidationIssue } from "@/lib/game/commandValidation";
    import type { Facing } from "@/lib/genArcs";
    import type { Position } from "@/schemas/position";

    const dispatch = createEventDispatcher();

    $: meta = $currentState.meta ?? { phase: 1, turn: 1, segment: "orders" };
    $: segment = meta.segment ?? "orders";
    $: activationId = currentActivationId(meta);
    $: turn = meta.turn ?? 1;

    $: ships =
        $currentState.state?.objects?.filter((o) => {
            if (o.objType !== "ship" || !o.position) return false;
            if (segment === "orders" && activationId) {
                return o.id === activationId;
            }
            return true;
        }) ?? [];

    $: msTokens =
        $currentState.state?.objects?.filter((o) => {
            if (o.objType !== "ordnance") return false;
            const ord = o as { stage?: number; id: string };
            if (ord.stage !== 1) return false;
            if (segment === "orders" && activationId) return ord.id === activationId;
            return true;
        }) ?? [];

    let activatorKind: "ship" | "ms" = "ship";
    let shipId = "";
    let lastShipId = "";
    let msId = "";
    let selectedSystems: Record<string, boolean> = {};
    let systemPlacements: Record<string, { x: number; y: number }> = {};
    let rocketTargets: Record<string, string> = {};
    let amtOpenSpace: Record<string, boolean> = {};
    let placingSystemId: string | null = null;
    let previewSystemId = "";
    let autoLauncherForShip = "";
    let lastAssignedBeaconKey = "";
    let prevMsId = "";

    $: mapObjects = ($currentState.state?.objects ?? []) as import("@/schemas/position").FullThrustGameObjects[];

    $: if (ships.length && !shipId && activatorKind === "ship") shipId = ships[0].id;
    $: if (msTokens.length && !msId && activatorKind === "ms") msId = msTokens[0].id;

    $: if (shipId !== lastShipId) {
        lastShipId = shipId;
        selectedSystems = {};
        systemPlacements = {};
        rocketTargets = {};
        amtOpenSpace = {};
        placingSystemId = null;
        previewSystemId = "";
        autoLauncherForShip = "";
        lastAssignedBeaconKey = "";
        beacon.set(undefined);
        if (shipId) focusMapOnShipId(shipId, mapObjects);
    }

    $: if (msId && msId !== prevMsId) {
        prevMsId = msId;
        focusMapOnOrdnanceId(msId, mapObjects);
    }

    $: launchShip = ships.find((s) => s.id === shipId) as ShipGameState | undefined;
    $: systems = launchShip ? listLaunchableSystems(launchShip) : [];
    $: shipJson = launchShip ? JSON.stringify(launchShip.object) : "";
    $: renderOpts = launchShip ? buildShipRenderOpts(launchShip) : { minimal: true };
    $: pickedSystems = systems.filter((s) => selectedSystems[s.systemId]);
    $: mapSystems = pickedSystems.filter((s) => s.gameType !== "rocket");
    $: previewSystem = previewSystemId
        ? systems.find((s) => s.systemId === previewSystemId)
        : undefined;

    $: if (shipId && systems.length === 1 && autoLauncherForShip !== shipId) {
        autoLauncherForShip = shipId;
        const systemId = systems[0].systemId;
        void tick().then(() => selectLauncher(systemId));
    }
    $: rocketSystems = pickedSystems.filter((s) => s.gameType === "rocket");

    $: enemyShips =
        $currentState.state?.objects?.filter((o) => {
            if (o.objType !== "ship" || !o.position) return false;
            if (!launchShip?.owner) return true;
            return o.owner !== launchShip.owner;
        }) ?? [];

    $: mapPlacement =
        activatorKind === "ms" ||
        (activatorKind === "ship" &&
            launchShip !== undefined &&
            (mapSystems.length > 0 ||
                (previewSystemId !== "" &&
                    previewSystem !== undefined &&
                    previewSystem.gameType !== "rocket")));

    $: clickMode.set(mapPlacement ? "beacon" : undefined);

    const buildLauncherAnnotations = (): IAnnotation[] => {
        const ann: IAnnotation[] = [];
        if (
            activatorKind === "ship" &&
            launchShip?.position &&
            "x" in launchShip.position &&
            previewSystem
        ) {
            ann.push(
                ...launchAnnotationsForSystem(
                    launchShip.object as FullThrustShip,
                    launchShip.position,
                    (launchShip.facing ?? 12) as Facing,
                    previewSystem
                )
            );
            for (const sys of mapSystems) {
                const p = systemPlacements[sys.systemId];
                if (p) {
                    ann.push({
                        id: `launch_pt_${sys.systemId}`,
                        type: "CIRCLE",
                        note: { c: p, r: 0.12 },
                        color: "#88ff88",
                        opacity: 0.85,
                        strokeWidth: 2,
                    });
                }
            }
        }
        return ann;
    };

    const syncLauncherAnnotations = () => {
        annotations.set(buildLauncherAnnotations());
    };

    $: if (previewSystemId && launchShip && systems.length) {
        syncLauncherAnnotations();
    }

    const focusPreviewOnMap = (sys: LaunchableSystem) => {
        if (!launchShip?.position || !("x" in launchShip.position)) return;
        const anns = launchAnnotationsForSystem(
            launchShip.object as FullThrustShip,
            launchShip.position,
            (launchShip.facing ?? 12) as Facing,
            sys
        );
        const bounds = boundsFromAnnotations(anns);
        if (bounds) {
            focusMapOnBounds(bounds, 2);
        } else {
            const pos = launchShip.position as Position;
            focusMapOnPoint(pos.x, pos.y, 24);
        }
    };

    function selectLauncher(systemId: string, opts: { check?: boolean } = { check: true }) {
        const sys = systems.find((s) => s.systemId === systemId);
        if (!sys) return;
        previewSystemId = systemId;
        placingSystemId = systemId;
        if (opts.check) {
            selectedSystems = { ...selectedSystems, [systemId]: true };
        }
        lastAssignedBeaconKey = "";
        if (sys.gameType === "rocket") {
            beacon.set(undefined);
        } else {
            beacon.set(systemPlacements[systemId] ?? undefined);
        }
        focusPreviewOnMap(sys);
        syncLauncherAnnotations();
    }

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
        if (!launchShip) return;
        const ele = getInnermostHovered();
        if (!ele?.id) return;
        const entry = findShipSystem(launchShip, ele.id);
        if (!entry || !isOrdnanceLauncherSystem(entry)) {
            toast.push("Select an ordnance launcher on the SSD");
            return;
        }
        const launchable = systems.find((s) => s.systemId === entry.id);
        if (!launchable) {
            toast.push("That launcher has no ammunition remaining");
            return;
        }
        selectLauncher(entry.id);
    };

    const assignBeacon = (val: IBeacon) => {
        if (!launchShip || activatorKind !== "ship") return;
        let target = placingSystemId;
        const targetSys = target ? systems.find((s) => s.systemId === target) : undefined;
        if (!target || targetSys?.gameType === "rocket") {
            const unplaced = mapSystems.find((s) => !systemPlacements[s.systemId]);
            target = unplaced?.systemId ?? null;
        }
        if (
            !target &&
            previewSystem &&
            previewSystem.gameType !== "rocket" &&
            !systemPlacements[previewSystem.systemId]
        ) {
            target = previewSystem.systemId;
        }
        if (!target) return;
        if (!selectedSystems[target]) {
            selectedSystems = { ...selectedSystems, [target]: true };
        }
        previewSystemId = target;
        systemPlacements = { ...systemPlacements, [target]: { x: val.x, y: val.y } };
        placingSystemId = target;
        const nextSys = mapSystems.find(
            (s) => s.systemId !== target && !systemPlacements[s.systemId]
        );
        if (nextSys) {
            placingSystemId = nextSys.systemId;
            previewSystemId = nextSys.systemId;
            lastAssignedBeaconKey = "";
        }
        syncLauncherAnnotations();
    };

    $: if (
        $beacon &&
        launchShip &&
        activatorKind === "ship" &&
        (mapSystems.length > 0 ||
            (previewSystem !== undefined && previewSystem.gameType !== "rocket"))
    ) {
        const key = `${$beacon.x.toFixed(4)},${$beacon.y.toFixed(4)}`;
        if (key !== lastAssignedBeaconKey) {
            if (mapSystems.length === 0) {
                toast.push("Check at least one non-rocket launcher before clicking the map");
            } else {
                lastAssignedBeaconKey = key;
                assignBeacon($beacon);
            }
        }
    }

    onMount(() => {
        beacon.set(undefined);
    });

    onDestroy(() => {
        clickMode.set(undefined);
        beacon.set(undefined);
        annotations.set([]);
    });

    const systemLabel = (sys: LaunchableSystem) => {
        let s = `${sys.label} (${sys.systemId}) — ${sys.gameType}`;
        if (sys.remaining !== undefined) s += ` · ${sys.remaining} left`;
        s += ` · ${launchRange(sys.gameType, sys.modifier)} MU`;
        if (sys.leftArc && sys.numArcs) s += ` · arc ${sys.leftArc}×${sys.numArcs}`;
        return s;
    };

    const toggleSystem = (systemId: string) => {
        const sys = systems.find((s) => s.systemId === systemId);
        if (!sys) return;
        const next = !(selectedSystems[systemId] ?? false);
        selectedSystems = { ...selectedSystems, [systemId]: next };
        if (!next) {
            const { [systemId]: _p, ...restP } = systemPlacements;
            systemPlacements = restP;
            const { [systemId]: _t, ...restT } = rocketTargets;
            rocketTargets = restT;
            if (placingSystemId === systemId) {
                placingSystemId =
                    systems.find((s) => selectedSystems[s.systemId])?.systemId ?? null;
            }
        } else {
            selectLauncher(systemId);
        }
    };

    const focusSystem = (systemId: string) => {
        selectLauncher(systemId);
    };

    const issuesForSystem = (sys: LaunchableSystem): ValidationIssue[] => {
        if (!launchShip) return [];
        if (sys.gameType === "rocket") {
            const tgtId = rocketTargets[sys.systemId];
            if (!tgtId) return [];
            const tgt = enemyShips.find((s) => s.id === tgtId) as ShipGameState | undefined;
            if (!tgt) return [];
            return validateRocketTarget(launchShip, sys, tgt, turn);
        }
        const pos = systemPlacements[sys.systemId];
        if (!pos) return [];
        return validatePlacement({
            ship: launchShip,
            system: sys,
            target: pos,
            turn,
            phase: 3,
        });
    };

    const buildLaunchCommand = (
        sys: LaunchableSystem
    ): FullThrustGameCommand | undefined => {
        if (!launchShip) return undefined;
        if (sys.gameType === "rocket") {
            const targetShipId = rocketTargets[sys.systemId];
            if (!targetShipId) return undefined;
            return {
                name: "declareLaunchOrdnance",
                ship: shipId,
                systemId: sys.systemId,
                type: "rocket",
                targetShip: targetShipId,
                rocketIds: [nanoid(8), nanoid(8)],
            } as FullThrustGameCommand;
        }
        const pos = systemPlacements[sys.systemId];
        if (!pos) return undefined;
        const shipPos = launchShip.position as { x: number; y: number };
        const isMs = sys.modifier === "twostage";
        let position = pos;
        let stage: 1 | 2 | undefined;
        let aimPosition: { x: number; y: number } | undefined;
        if (isMs) {
            position = multistageIntermediatePoint(shipPos, pos);
            aimPosition = pos;
            stage = 1;
        }
        const ordType =
            sys.gameType === "missile" && sys.modifier === "er" ? "missile" : sys.gameType;
        return {
            name: "launchOrdnance",
            ship: shipId,
            id: nanoid(8),
            systemId: sys.systemId,
            position,
            type: ordType,
            stage,
            aimPosition,
            deployedTurn: turn,
            range: sys.gameType === "plasmaBolt" ? 6 : undefined,
            detonateOpenSpace:
                sys.gameType === "amt" && amtOpenSpace[sys.systemId] ? true : undefined,
        } as FullThrustGameCommand;
    };

    const submit = () => {
        if (activatorKind === "ms") {
            if (!msId || !$beacon) {
                toast.push("Select multistage token and click new position");
                return;
            }
            appendGameCommand({
                name: "moveOrdnance",
                id: msId,
                position: { x: $beacon.x, y: $beacon.y },
                stage: 2,
            } as FullThrustGameCommand);
            toast.push("Multistage marker repositioned");
            dispatch("done");
            return;
        }

        if (!launchShip) {
            toast.push("Select launching ship");
            return;
        }
        if (pickedSystems.length === 0) {
            toast.push("Select at least one ordnance system to launch");
            return;
        }

        for (const sys of pickedSystems) {
            if (sys.gameType === "rocket") {
                if (!rocketTargets[sys.systemId]) {
                    toast.push(`Select target ship for ${sys.systemId}`);
                    return;
                }
            } else if (!systemPlacements[sys.systemId]) {
                toast.push(`Set map position for ${sys.systemId}`);
                placingSystemId = sys.systemId;
                return;
            }
            const issues = issuesForSystem(sys).filter((i) => i.severity === "error");
            if (issues.length > 0) {
                toast.push(`${sys.systemId}: ${issues[0].message}`);
                placingSystemId = sys.systemId;
                return;
            }
        }

        const cmds = pickedSystems
            .map((sys) => buildLaunchCommand(sys))
            .filter((c): c is FullThrustGameCommand => c !== undefined);
        if (cmds.length === 0) {
            toast.push("Nothing to launch");
            return;
        }
        const rockets = cmds.filter((c) => c.name === "declareLaunchOrdnance").length;
        const immediate = cmds.length - rockets;
        appendGameCommands(cmds);
        if (rockets && immediate) {
            toast.push(`Launched ${immediate} ordnance; ${rockets} rocket pod(s) declared`);
        } else if (rockets) {
            toast.push("Rocket launch(es) declared — advance to resolve segment to roll");
        } else {
            toast.push(`Launched ${immediate} ordnance system(s)`);
        }
        dispatch("done");
    };

    $: submitIssues = pickedSystems.flatMap((sys) => issuesForSystem(sys));
    $: allReady =
        pickedSystems.length > 0 &&
        pickedSystems.every((sys) => {
            if (sys.gameType === "rocket") return !!rocketTargets[sys.systemId];
            return !!systemPlacements[sys.systemId];
        });
</script>

<p class="help">Phase 3 — launch ordnance for the current activation. Rockets declare a target then resolve with dice.</p>

{#if msTokens.length > 0}
    <div class="field">
        <label class="radio">
            <input type="radio" bind:group={activatorKind} value="ship" /> Ship launch
        </label>
        <label class="radio">
            <input type="radio" bind:group={activatorKind} value="ms" /> Multistage token ({msTokens.length})
        </label>
    </div>
{/if}

{#if activatorKind === "ms"}
    <div class="field">
        <label class="label" for="ms">Multistage marker</label>
        <div class="select">
            <select id="ms" bind:value={msId}>
                {#each msTokens as t}
                    <option value={t.id}>{t.id}</option>
                {/each}
            </select>
        </div>
    </div>
    <p class="help">Click map for stage-2 position (16–24 MU in front arc).</p>
    <button class="button is-primary" on:click={submit}>Place stage 2</button>
{:else}
    <div class="field">
        <label class="label" for="ship">Launching ship</label>
        <div class="select">
            <select id="ship" bind:value={shipId}>
                <option value="">--</option>
                {#each ships as s}
                    <option value={s.id}>{s.id}</option>
                {/each}
            </select>
        </div>
    </div>

    {#if launchShip}
        {#if systems.length === 0}
            <p class="help has-text-warning">No launchable ordnance systems on this ship.</p>
        {:else}
            <div class="field">
                <label class="label" for="launcher">Launcher</label>
                <div class="select">
                    <select
                        id="launcher"
                        value={previewSystemId}
                        on:change={(e) => {
                            const id = (e.currentTarget as HTMLSelectElement).value;
                            previewSystemId = id;
                            if (id) {
                                selectLauncher(id, { check: false });
                            } else {
                                syncLauncherAnnotations();
                            }
                        }}
                    >
                        <option value="">-- select launcher --</option>
                        {#each systems as sys}
                            <option value={sys.systemId}>{systemLabel(sys)}</option>
                        {/each}
                    </select>
                </div>
                <p class="help">
                    Pick a launcher to preview arc and range on the map, or click one on the SSD
                    below.
                </p>
            </div>

            {#if shipJson}
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <div class="ssd-picker mb-3" on:click={handleSsdClick}>
                    <RenderSsd json={shipJson} opts={renderOpts} />
                </div>
            {/if}

            <div class="field">
                <p class="label">Ordnance systems to launch</p>
                <p class="help mb-2">
                    Check each launcher you want to fire. Map-based systems need a click per
                    launcher; rocket pods need a target ship each (line of sight is not checked).
                </p>
                {#each systems as sys}
                    {@const pos = systemPlacements[sys.systemId]}
                    {@const sysIssues = issuesForSystem(sys)}
                    <div
                        class="system-row"
                        class:is-active={previewSystemId === sys.systemId && selectedSystems[sys.systemId]}
                    >
                        <label class="checkbox system-check">
                            <input
                                type="checkbox"
                                checked={selectedSystems[sys.systemId] ?? false}
                                on:change={() => toggleSystem(sys.systemId)}
                            />
                            {systemLabel(sys)}
                        </label>
                        {#if selectedSystems[sys.systemId]}
                            {#if sys.gameType === "rocket"}
                                <div class="system-detail">
                                    <div class="select is-small">
                                        <select
                                            bind:value={rocketTargets[sys.systemId]}
                                            on:change={() => {
                                                rocketTargets = { ...rocketTargets };
                                            }}
                                        >
                                            <option value="">Target ship…</option>
                                            {#each enemyShips as e}
                                                {@const d =
                                                    launchShip?.position &&
                                                    "x" in launchShip.position &&
                                                    e.position &&
                                                    "x" in e.position
                                                        ? distance(launchShip.position, e.position)
                                                        : null}
                                                <option value={e.id}>
                                                    {e.id}{d !== null ? ` (${d.toFixed(1)} MU)` : ""}
                                                </option>
                                            {/each}
                                        </select>
                                    </div>
                                </div>
                            {:else}
                                <div class="system-detail">
                                    {#if sys.gameType === "amt"}
                                        <label class="checkbox is-size-7">
                                            <input
                                                type="checkbox"
                                                checked={amtOpenSpace[sys.systemId] ?? false}
                                                on:change={(e) => {
                                                    amtOpenSpace = {
                                                        ...amtOpenSpace,
                                                        [sys.systemId]: (e.currentTarget as HTMLInputElement).checked,
                                                    };
                                                }}
                                            />
                                            Explode in open space
                                        </label>
                                    {/if}
                                    <button
                                        type="button"
                                        class="button is-small"
                                        class:is-info={previewSystemId === sys.systemId}
                                        on:click={() => focusSystem(sys.systemId)}
                                    >
                                        {pos ? "Reposition" : "Place on map"}
                                    </button>
                                    {#if pos}
                                        <span class="help placement-coords">
                                            ({pos.x.toFixed(2)}, {pos.y.toFixed(2)})
                                        </span>
                                    {:else if previewSystemId === sys.systemId}
                                        <span class="help has-text-info">Click map…</span>
                                    {/if}
                                    {#if sys.modifier === "twostage"}
                                        <span class="help"> — aim point (marker 16–24 MU out)</span>
                                    {/if}
                                </div>
                            {/if}
                            {#if sysIssues.length > 0}
                                <div class="system-issues">
                                    <ActError issues={sysIssues} />
                                </div>
                            {/if}
                        {/if}
                    </div>
                {/each}
            </div>

            <button class="button is-primary" disabled={!allReady} on:click={submit}>
                Launch selected systems
            </button>
            {#if submitIssues.length > 0}
                <ActError issues={submitIssues} />
            {/if}
        {/if}
    {/if}
{/if}

<style>
    .system-row {
        border: 1px solid transparent;
        border-radius: 4px;
        margin-bottom: 0.35rem;
    }

    .system-row.is-active {
        border-color: #3273dc;
        background: rgba(50, 115, 220, 0.06);
    }

    .system-check {
        display: block;
        padding: 0.55rem 0.75rem;
    }

    .system-detail {
        padding: 0 0.75rem 0.55rem 2.1rem;
    }

    .system-issues {
        padding: 0 0.75rem 0.55rem 2.1rem;
    }

    .placement-coords {
        display: inline-block;
        margin-left: 0.5rem;
    }

    .ssd-picker {
        max-width: 320px;
        cursor: crosshair;
    }

    .ssd-picker :global(svg [id]) {
        cursor: pointer;
    }
</style>
