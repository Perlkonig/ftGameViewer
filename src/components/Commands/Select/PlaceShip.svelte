<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { clickMode } from "@/stores/writeClickMode";
    import { beacon } from "@/stores/writeBeacon";
    import { annotations, type IAnnotation } from "@/stores/writeAnnotations";
    import { currentState } from "@/stores/derivedState";
    import { nanoid } from "nanoid";
    import { toast } from "@zerodevx/svelte-toast";
    import deepclone from "rfdc/default";
    import { XMLBuilder, XMLValidator, XMLParser } from "fast-xml-parser";
    import { validateShipJson } from "@/lib/shipValidation";
    import type { Position, FullThrustShip, FullThrustGameCommand } from "@/schemas/commands";
    import RenderSSD from "@/components/RenderSSD.svelte";
    import RenderCounter from "@/components/RenderCounter.svelte";
    import presets from "@/stores/counters.json";
    import Clock from "@/assets/clock.svg.svelte";
    import { appendGameCommand } from "@/lib/game/appendCommand";
    import { gameMeta } from "@/stores/writeGameMeta";
    import { facingToCourse } from "@/lib/game/vectorMovement";
    import HtmlUidInput from "@/components/HtmlUidInput.svelte";
    import { isValidHtmlUid, gameUidCollision } from "@/lib/htmlId";
    import {
        fleetShipLabel,
        loadFleetPresets,
        renameShipJson,
        type FleetFaction,
    } from "@/lib/game/fleetPresets";
    import {
        autoDeployedSquadrons,
        ftlSquadronsNeedingDeployment,
        validateFtlDeployDistance,
        type FtlDeployEntry,
    } from "@/lib/game/ftlPlaceDeployment";
    import { normalizeCallsign } from "@/lib/game/fighterLabel";

    type ShipInputMode = "paste" | "fleet";
    type Facing = 1|2|3|4|5|6|7|8|9|10|11|12;

    interface PlacementTemplate {
        shipJSON: string;
        counterType: "preset" | "custom";
        counterBase: number;
        counterVariant: number;
        customCounter?: string;
        owner?: string;
        facing: Facing;
        speed: number;
        courseEnabled: boolean;
        course?: number;
    }

    /** Persists across PlaceShip mount/unmount so "Place another copy" works after leaving the action. */
    let savedPlacementTemplate: PlacementTemplate | undefined;

    interface ICommand {
        [k: string]: unknown;
        name: "placeShip";
        id: string;
        object?: FullThrustShip;
        svg: string;
        owner?: string;
        position?: Position | null;
        facing: Facing;
        course?: number;
        movementMode?: "cinematic" | "vector";
        speed: number;
        deployedSquadrons?: Array<{
            objType: "fighters" | "gunboats";
            id: string;
            position: { x: number; y: number };
            endurance?: number;
            facing?: number;
            callsign?: string;
        }>;
    }

    let cmd: ICommand = {
        name: "placeShip",
        id: nanoid(10),
        object: undefined,
        svg: "",
        owner: "",
        position: undefined,
        facing: 12,
        speed: 0,
    };

    $: vectorAllowed =
        ($gameMeta.allowVectorMovement ?? $currentState.meta?.allowVectorMovement) === true;

    let shipInputMode: ShipInputMode = "paste";
    let prevShipInputMode: ShipInputMode = "paste";
    let fleetFactions: FleetFaction[] = [];
    let fleetsLoadError = "";
    let selectedFactionName = "";
    let selectedShipIndex = 0;
    let renameDraft = "";

    $: fleetShipsForFaction =
        fleetFactions.find((f) => f.name === selectedFactionName)?.ships ?? [];

    const syncRenameDraftFromJson = () => {
        if (!shipJSON?.trim()) {
            renameDraft = "";
            return;
        }
        try {
            const parsed = JSON.parse(shipJSON) as { name?: string };
            renameDraft = typeof parsed.name === "string" ? parsed.name : "";
        } catch {
            renameDraft = "";
        }
    };

    const maybeApplyCounterFromMass = (ship: FullThrustShip) => {
        const mass = Number((ship as { mass?: number }).mass);
        if (!Number.isFinite(mass)) return;
        if (presets.some((p) => p.base === mass)) {
            counterBase = mass;
            counterVariant = 1;
        }
    };

    const applyFleetShipSelection = () => {
        const idx = Number(selectedShipIndex);
        const ship = fleetShipsForFaction[Number.isFinite(idx) ? idx : 0];
        if (!ship) return;
        const clone = deepclone(ship) as FullThrustShip;
        shipJSON = JSON.stringify(clone, null, 2);
        maybeApplyCounterFromMass(clone);
        syncRenameDraftFromJson();
    };

    $: if (
        shipInputMode === "fleet" &&
        prevShipInputMode !== "fleet" &&
        fleetFactions.length > 0 &&
        selectedFactionName
    ) {
        applyFleetShipSelection();
    }
    $: prevShipInputMode = shipInputMode;

    const onFactionChange = () => {
        selectedShipIndex = 0;
        applyFleetShipSelection();
    };

    const onFleetShipChange = () => {
        applyFleetShipSelection();
    };

    const applyRename = () => {
        if (!shipJSON?.trim()) {
            toast.push("Select or paste a ship first");
            return;
        }
        try {
            shipJSON = renameShipJson(shipJSON, renameDraft);
            syncRenameDraftFromJson();
            toast.push(`Renamed design to “${renameDraft.trim()}”`);
        } catch (e) {
            toast.push(e instanceof Error ? e.message : "Could not rename ship");
        }
    };

    let shipJSON: string;
    let shipJsonCheck: ReturnType<typeof validateShipJson> | undefined;
    $: if (shipJSON !== undefined) {
        shipJsonCheck = validateShipJson(shipJSON);
        if (shipJsonCheck.wellFormed) {
            try {
                cmd.object = JSON.parse(shipJSON) as FullThrustShip;
            } catch {
                cmd.object = undefined;
            }
        } else {
            cmd.object = undefined;
        }
    }

    let counterType: "preset"|"custom" = "preset";
    let counterBase = 1;
    let counterVariant = 1;
    let counterSymbol: string|undefined;
    $: if (counterType === "preset" && counterBase !== undefined && counterVariant !== undefined) {
        const counter = presets.find(x => x.base === counterBase && x.variant === counterVariant);
        if (counter !== undefined) {
            counterSymbol = counter.svg;
        } else {
            counterSymbol = undefined;
        }
        cmd.svg = counterSymbol ?? "";
    }

    let customCounter: string;
    const processCustomCounter = () => {
        if ( (customCounter !== null) && (customCounter !== undefined) && (customCounter.length > 30) ) {
            // Process customCounter
            const result = XMLValidator.validate(customCounter, {
                allowBooleanAttributes: true
            });
            if ( (typeof result === "boolean") && (result === true) ) {
                let interim = customCounter.trim();
                // Parse the well-formed XML and do basic sanity check
                const parser = new XMLParser({
                    ignoreAttributes: false,
                    attributeNamePrefix : "@_",
                    allowBooleanAttributes: true,
                    preserveOrder: true,
                    ignoreDeclaration: true,
                    removeNSPrefix: true,
                });
                const output = parser.parse(interim);
                // Can only be one root tag
                if (output.length > 1) {
                    toast.push("The custom counter has multiple root nodes.");
                    return;
                }
                const root = output[0];
                // Must be an SVG or symbol tag
                const rootName = [...Object.keys(root)][0] as string;
                if ( (rootName !== "svg") && (rootName !== "symbol") ) {
                    toast.push("You must provide either an &lt;svg&gt; or a &lt;symbol&gt; tag.");
                    return;
                }
                // Must have a viewbox attribute
                const rootAttrs = root[":@"];
                if (rootAttrs === undefined || !rootAttrs.hasOwnProperty("@_viewBox")) {
                    toast.push("No `viewBox` attribute found.");
                    return;
                }
                // Strip ID if present
                if (rootAttrs.hasOwnProperty("@_id")) {
                    delete rootAttrs["@_id"];
                }
                // Rename <svg> to <symbol>
                if (rootName === "svg") {
                    const desc = Object.getOwnPropertyDescriptor(root, "svg");
                    if (desc !== undefined) {
                        Object.defineProperty(root, "symbol", desc);
                    }
                    delete root["svg"];
                }

                // Save the result
                const builder = new XMLBuilder({
                    ignoreAttributes: false,
                    attributeNamePrefix : "@_",
                    preserveOrder: true,
                });
                let built = builder.build(output);
                customCounter = built;
            } else {
                toast.push("The custom counter code you provided is not well formed.")
            }
        }
    }
    $: if (
        counterType === "custom" &&
        customCounter !== undefined &&
        customCounter !== null &&
        customCounter.length >= 30
    ) {
        processCustomCounter();
        counterSymbol = customCounter;
        cmd.svg = counterSymbol ?? "";
    } else if (counterType === "custom") {
        cmd.svg = "";
    }

    let owner: string | undefined;
    let ownerColour: string | undefined;
    $: if (owner !== undefined) {
        if ($currentState.state !== undefined) {
            const obj = $currentState.state.players?.find(x => x.id === owner);
            if (obj !== undefined) {
                ownerColour = obj.colour;
                cmd.owner = obj.id;
            } else {
                ownerColour = undefined;
                cmd.owner = undefined;
            }
        }
    }

    onMount(() => {
        clickMode.set("beacon");
        void loadFleetPresets().then((factions) => {
            fleetFactions = factions;
            if (factions.length === 0) {
                fleetsLoadError = "Fleet library not available";
                return;
            }
            selectedFactionName = factions[0].name;
            selectedShipIndex = 0;
        }).catch(() => {
            fleetsLoadError = "Could not load fleet library";
        });
    });

    let placementStep: "ship" | "ftl" = "ship";
    /** Mutable ref for beacon subscription (avoids stale closure). */
    const placementCtx = { step: "ship" as "ship" | "ftl" };
    $: placementCtx.step = placementStep;

    let posStr: string;
    const unsubBeacon = beacon.subscribe((val) => {
        if (placementCtx.step === "ftl") {
            return;
        }
        if (val !== undefined) {
            posStr = `${val.x}, ${val.y}`;
            cmd.position = { x: val.x, y: val.y };
        } else {
            posStr = "";
            cmd.position = undefined;
        }
    });

    let facing: Facing  = 12;
    const handleClockClick = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.id.startsWith("face")) {
            facing = parseInt(target.id.substring(4), 10) as Facing;
        } else {
            facing = 12;
        }
        cmd.facing = facing;
    }

    let speed = 0;
    let courseEnabled = false;

    $: if (courseEnabled && cmd.facing) {
        cmd.course = facingToCourse(cmd.facing);
    }
    $: if (!vectorAllowed) {
        courseEnabled = false;
    }

    $: idCollision = gameUidCollision($currentState.state, cmd.id);
    $: canPlaceId = isValidHtmlUid(cmd.id) && !idCollision;

    $: matchingDesignShipId = (() => {
        if (!shipJSON?.trim() || !cmd.object) return undefined;
        const hashseed = (cmd.object as { hashseed?: string }).hashseed;
        if (!hashseed) return undefined;
        const match = $currentState.state?.objects?.find(
            (o) =>
                o.objType === "ship" &&
                o.id !== cmd.id &&
                (o.object as { hashseed?: string })?.hashseed === hashseed
        );
        return match?.id;
    })();

    const capturePlacementTemplate = (): PlacementTemplate => ({
        shipJSON,
        counterType,
        counterBase,
        counterVariant,
        customCounter: counterType === "custom" ? customCounter : undefined,
        owner,
        facing: cmd.facing as Facing,
        speed: cmd.speed,
        courseEnabled,
        course: cmd.course,
    });

    const applyPlacementTemplate = (template: PlacementTemplate) => {
        shipJSON = template.shipJSON;
        counterType = template.counterType;
        counterBase = template.counterBase;
        counterVariant = template.counterVariant;
        if (template.customCounter !== undefined) {
            customCounter = template.customCounter;
        }
        owner = template.owner;
        facing = template.facing;
        cmd.facing = template.facing;
        cmd.speed = template.speed;
        speed = template.speed;
        courseEnabled = template.courseEnabled;
        if (template.courseEnabled && template.course !== undefined) {
            cmd.course = template.course;
        } else {
            cmd.course = undefined;
        }
        cmd.id = nanoid(10);
        cmd.position = undefined;
        posStr = "";
        $beacon = undefined;
        warnings = [];
        syncRenameDraftFromJson();
        clickMode.set("beacon");
    };

    const placeAnotherCopy = () => {
        if (!savedPlacementTemplate) return;
        applyPlacementTemplate(savedPlacementTemplate);
        toast.push("Ready to place another copy — click the map for position");
    };

    let ftlQueue: FtlDeployEntry[] = [];
    let ftlIndex = 0;
    let ftlShipPosition: Position | undefined;
    let deployedSquadrons: NonNullable<ICommand["deployedSquadrons"]> = [];
    let ftlPlaceWarning = "";
    let ftlCallsignDraft = "";

    $: currentFtlEntry = ftlQueue[ftlIndex];
    $: ftlRadius = currentFtlEntry?.radiusMu ?? 9;

    const updateFtlPlacementAnnotations = () => {
        const ann: IAnnotation[] = [];
        if (placementStep !== "ftl" || !ftlShipPosition) {
            annotations.set(ann);
            return;
        }
        const ship = ftlShipPosition;
        ann.push({
            id: "ftl_place_range",
            type: "CIRCLE",
            note: { c: ship, r: ftlRadius },
            color: currentFtlEntry?.objType === "gunboats" ? "#ccaa88" : "#88aacc",
            opacity: 0.4,
            strokeWidth: 2,
        });
        for (const dep of deployedSquadrons) {
            ann.push({
                id: `ftl_placed_${dep.id}`,
                type: "CIRCLE",
                note: { c: dep.position, r: 0.12 },
                color: "#66dd66",
                opacity: 0.85,
                strokeWidth: 2,
            });
        }
        annotations.set(ann);
    };

    $: if (placementStep === "ftl") {
        currentFtlEntry;
        ftlRadius;
        ftlShipPosition;
        deployedSquadrons;
        updateFtlPlacementAnnotations();
    } else {
        annotations.set([]);
    }

    $: if (placementStep === "ftl" && ftlShipPosition && $beacon) {
        ftlPlaceWarning =
            validateFtlDeployDistance(ftlShipPosition, $beacon, ftlRadius) ?? "";
    } else if (placementStep !== "ftl") {
        ftlPlaceWarning = "";
    }
    let validShip = false;
    let warnings: string[] = [];

    const commitPlaceShip = (payload: Record<string, unknown> & FullThrustGameCommand) => {
        const dest = appendGameCommand(payload as FullThrustGameCommand);
        const placedId = cmd.id;
        savedPlacementTemplate = capturePlacementTemplate();
        applyPlacementTemplate(savedPlacementTemplate);
        placementStep = "ship";
        placementCtx.step = "ship";
        ftlQueue = [];
        ftlIndex = 0;
        ftlShipPosition = undefined;
        deployedSquadrons = [];
        annotations.set([]);
        toast.push(
            dest === "master"
                ? `Placed ${placedId}. Click the map for the next copy.`
                : `Added ${placedId} to proposals. Click the map for the next copy.`
        );
        if (shipJsonCheck?.warnings.length) {
            toast.push(`Ship design warnings: ${shipJsonCheck.warnings.join("; ")}`);
        }
    };

    const ftlDeployCallsign = (): string | undefined => normalizeCallsign(ftlCallsignDraft);

    const buildFtlDeployedRecord = (position: { x: number; y: number }) => {
        if (!currentFtlEntry) {
            throw new Error("No FTL squadron selected");
        }
        const callsign = ftlDeployCallsign();
        return {
            objType: currentFtlEntry.objType,
            id: currentFtlEntry.id,
            position,
            endurance: currentFtlEntry.endurance,
            facing: cmd.facing,
            ...(callsign ? { callsign } : {}),
        };
    };

    const finishFtlSquadronStep = () => {
        ftlIndex += 1;
        $beacon = undefined;
        ftlCallsignDraft = "";
        advanceFtlQueueOrCommit();
    };

    const autoPlaceCurrentFtlSquadron = () => {
        if (!currentFtlEntry || !ftlShipPosition || !cmd.object) return;
        const [one] = autoDeployedSquadrons(
            cmd.id,
            ftlShipPosition,
            [currentFtlEntry],
            cmd.facing
        );
        if (!one) return;
        const callsign = ftlDeployCallsign();
        deployedSquadrons = [
            ...deployedSquadrons,
            callsign ? { ...one, callsign } : one,
        ];
        finishFtlSquadronStep();
    };

    const advanceFtlQueueOrCommit = () => {
        if (ftlIndex >= ftlQueue.length) {
            const payload = deepclone(cmd) as Record<string, unknown> & FullThrustGameCommand;
            const shipPos = ftlShipPosition ?? cmd.position;
            if (!shipPos || typeof shipPos !== "object" || !("x" in shipPos)) {
                toast.push("Ship position was lost — place the ship on the map again.");
                placementStep = "ship";
                placementCtx.step = "ship";
                return;
            }
            payload.position = { x: shipPos.x, y: shipPos.y };
            payload.deployedSquadrons = deployedSquadrons;
            if (courseEnabled && vectorAllowed) {
                payload.movementMode = "vector";
            } else {
                payload.movementMode = "cinematic";
                delete payload.course;
            }
            commitPlaceShip(payload);
        } else {
            toast.push(`Next: ${ftlQueue[ftlIndex]?.label ?? "done"}`);
        }
    };

    const skipOptionalFtlWing = () => {
        if (!currentFtlEntry?.optional) return;
        ftlCallsignDraft = "";
        ftlIndex += 1;
        $beacon = undefined;
        ftlPlaceWarning = "";
        advanceFtlQueueOrCommit();
    };

    const skipFtlWithAuto = () => {
        autoPlaceCurrentFtlSquadron();
    };

    const confirmFtlPlacement = () => {
        if (!currentFtlEntry || !ftlShipPosition) {
            toast.push("Ship position required");
            return;
        }
        if (!$beacon) {
            toast.push("Click the map within range of the ship for this squadron");
            return;
        }
        ftlPlaceWarning = validateFtlDeployDistance(ftlShipPosition, $beacon, ftlRadius) ?? "";
        if (ftlPlaceWarning) {
            toast.push(ftlPlaceWarning);
            return;
        }
        deployedSquadrons = [
            ...deployedSquadrons,
            buildFtlDeployedRecord({ x: $beacon.x, y: $beacon.y }),
        ];
        finishFtlSquadronStep();
    };

    const validateCommand = () => {
        warnings = [];
        if (!isValidHtmlUid(cmd.id)) {
            validShip = false;
            warnings.push("Invalid ID");
            return;
        }
        if (idCollision) {
            validShip = false;
            warnings.push(idCollision);
            return;
        }
        if (cmd.object !== undefined) {
            if (cmd.svg !== undefined && cmd.svg !== null && cmd.svg.length >= 30) {
                if (
                    cmd.owner !== undefined &&
                    cmd.owner.length > 0 &&
                    $currentState.state?.players?.find((x) => x.id === cmd.owner) !== undefined
                ) {
                    if (
                        cmd.position != null &&
                        cmd.position.hasOwnProperty("x") &&
                        cmd.position.x !== undefined &&
                        cmd.position.hasOwnProperty("y") &&
                        cmd.position.y !== undefined
                    ) {
                        if (cmd.facing !== undefined && cmd.facing >= 1 && cmd.facing <= 12) {
                            if (cmd.speed !== undefined && typeof cmd.speed === "number") {
                                if (courseEnabled && vectorAllowed) {
                                    if (
                                        cmd.course !== undefined &&
                                        typeof cmd.course === "number" &&
                                        cmd.course >= 0 &&
                                        cmd.course <= 360
                                    ) {
                                        validShip = true;
                                    } else {
                                        validShip = false;
                                        warnings.push("Invalid course");
                                    }
                                } else {
                                    cmd.course = undefined;
                                    validShip = true;
                                }
                            } else {
                                validShip = false;
                                warnings.push("Invalid speed");
                            }
                        } else {
                            validShip = false;
                            warnings.push("Invalid facing");
                        }
                    } else {
                        validShip = false;
                        warnings.push("Invalid position");
                    }
                } else {
                    validShip = false;
                    warnings.push("Missing owner");
                }
            } else {
                validShip = false;
                warnings.push("Invalid ship object");
            }
        } else {
            validShip = false;
            if (shipJsonCheck?.blockingMessages.length) {
                warnings.push(...shipJsonCheck.blockingMessages);
            } else {
                warnings.push("Invalid ship JSON");
            }
        }

        if (validShip) {
            const needs = ftlSquadronsNeedingDeployment(cmd.id, cmd.object as FullThrustShip);
            if (needs.length > 0) {
                ftlQueue = needs;
                ftlIndex = 0;
                deployedSquadrons = [];
                ftlCallsignDraft = "";
                ftlShipPosition = cmd.position
                    ? { x: cmd.position.x, y: cmd.position.y }
                    : undefined;
                placementStep = "ftl";
                placementCtx.step = "ftl";
                $beacon = undefined;
                clickMode.set("beacon");
                toast.push(
                    `Place FTL squadrons one at a time (${needs.length} total). First: ${needs[0].label}.`
                );
                return;
            }
            const payload = deepclone(cmd) as Record<string, unknown> & FullThrustGameCommand;
            if (courseEnabled && vectorAllowed) {
                payload.movementMode = "vector";
            } else {
                payload.movementMode = "cinematic";
                delete payload.course;
            }
            commitPlaceShip(payload);
        }
    }

    onDestroy(() => {
        unsubBeacon();
        $clickMode = undefined;
        $beacon = undefined;
        annotations.set([]);
    });
</script>

<div class="columns">
    <div class="column is-three-fifths">
        <div class="field">
            <label class="label" for="shipID">Unique ID</label>
            <div class="control">
                <HtmlUidInput
                    id="shipID"
                    name="shipID"
                    bind:value={cmd.id}
                    gameState={$currentState.state}
                    help="Map object id — must be unique on the board. Reusing the same ship-builder JSON for multiple counters is fine; only this id needs to change each time."
                />
            </div>
        </div>
        <div class="field">
            <span class="label">Ship design</span>
            <div class="control">
                <label class="radio">
                    <input type="radio" bind:group={shipInputMode} value="paste" />
                    Paste JSON
                </label>
                <label class="radio" class:is-disabled={fleetFactions.length === 0}>
                    <input
                        type="radio"
                        bind:group={shipInputMode}
                        value="fleet"
                        disabled={fleetFactions.length === 0}
                    />
                    Fleet library
                </label>
            </div>
            {#if fleetsLoadError}
                <p class="help has-text-warning">{fleetsLoadError}</p>
            {/if}
        </div>

        {#if shipInputMode === "fleet"}
            <div class="field">
                <label class="label" for="fleetFaction">Faction</label>
                <div class="select is-fullwidth">
                    <select
                        id="fleetFaction"
                        bind:value={selectedFactionName}
                        on:change={onFactionChange}
                    >
                        {#each fleetFactions as faction}
                            <option value={faction.name}>{faction.name}</option>
                        {/each}
                    </select>
                </div>
            </div>
            <div class="field">
                <label class="label" for="fleetShip">Ship</label>
                <div class="select is-fullwidth">
                    <select
                        id="fleetShip"
                        bind:value={selectedShipIndex}
                        on:change={onFleetShipChange}
                    >
                        {#each fleetShipsForFaction as ship, i}
                            <option value={i}>{fleetShipLabel(ship)}</option>
                        {/each}
                    </select>
                </div>
                <p class="help">
                    Fleet presets from <code>ftlibship</code> (copied at build to
                    <code>public/presets/fleets.json</code>). You can still rename the
                    design before placing.
                </p>
            </div>
        {:else}
            <div class="field">
                <label class="label" for="shipJSON">Ship JSON</label>
                <div class="control">
                    <textarea
                        class="textarea"
                        name="shipJSON"
                        bind:value={shipJSON}
                        on:input={syncRenameDraftFromJson}
                    ></textarea>
                </div>
                <p class="help">
                    Paste JSON from
                    <a href="https://www.perlkonig.com/ftShipBuilder" target="_blank">the ship builder</a>.
                    You can paste the <strong>same JSON</strong> for every copy of a design — SSD system ids are
                    per-ship and commands always target a specific ship.
                </p>
            </div>
        {/if}

        {#if shipJSON?.trim()}
            <div class="field has-addons">
                <div class="control is-expanded">
                    <label class="label" for="renameDesign">Design name</label>
                    <input
                        id="renameDesign"
                        class="input"
                        bind:value={renameDraft}
                        placeholder="Name in ship JSON"
                    />
                </div>
                <div class="control">
                    <label class="label">&nbsp;</label>
                    <button
                        type="button"
                        class="button is-light"
                        on:click={applyRename}
                        disabled={!renameDraft.trim()}
                    >
                        Rename
                    </button>
                </div>
            </div>
            <p class="help mb-3">
                Updates the <code>name</code> field in the ship JSON (paste or fleet selection).
            </p>
        {/if}

        {#if matchingDesignShipId}
            <p class="help has-text-info">
                Same design as ship “{matchingDesignShipId}” — system ids are per-ship; this is OK.
            </p>
        {/if}
        <div class="field">
            <label class="label" for="counterType">Map Counter</label>
            <div class="control">
                <label class="radio">
                    <input type="radio" name="counterType" bind:group={counterType} value="preset">
                    Preset
                </label>
                <label class="radio">
                    <input type="radio" name="counterType" bind:group={counterType} value="custom">
                    Custom
                </label>
            </div>
            <p class="help">This is the image on the playing field that represents this ship. It is automatically resized based on the ship's mass.</p>
        </div>
    {#if (counterType !== undefined) && (counterType === "preset")}
        <div class="columns">
            <div class="column">
                <div class="field">
                    <label class="label" for="baseClass">Base</label>
                    <div class="control">
                        <div class="select">
                            <select name="baseClass" bind:value={counterBase} on:change={() => counterVariant = 1}>
                            {#each [...new Set(presets.map(x => x.base))].sort((a, b) => a - b) as n}
                                <option value="{n}">{n}</option>
                            {/each}
                            </select>
                        </div>
                    </div>
                </div>
            </div>
        {#key counterBase}
            <div class="column">
                <div class="field">
                    <label class="label" for="classVariant">Variant</label>
                    <div class="control">
                        <div class="select">
                            <select name="classVariant" bind:value={counterVariant}>
                            {#each presets.filter(x => x.base === counterBase).map(x => x.variant).sort((a,b) => a-b) as n}
                                <option value="{n}" selected={n === 1}>{n}</option>
                            {/each}
                            </select>
                        </div>
                    </div>
                </div>
            </div>
            <div class="column">
            {#key cmd.svg}
                {#if cmd.svg !== undefined}
                    <RenderCounter
                        svg={cmd.svg}
                    />
                {/if}
            {/key}
            </div>
        {/key}
        </div>
    {:else if (counterType !== undefined) && (counterType === "custom")}
        <div class="columns">
            <div class="column is-two-thirds">
                <div class="field">
                    <label class="label" for="customSvg">Custom counter</label>
                    <div class="control">
                        <textarea class="textarea" name="customSvg" bind:value={customCounter}></textarea>
                    </div>
                    <p class="help">Must be a valid <code>&lt;svg&gt;</code> or <code>&lt;symbol&gt;</code> tag with a <code>viewBox</code> attribute.</p>
                </div>
            </div>
            <div class="column">
            {#key cmd.svg}
                {#if customCounter !== undefined}
                    <RenderCounter
                        svg={cmd.svg}
                    />
                {/if}
            {/key}
            </div>
        </div>
    {/if}
        <div class="columns">
            <div class="column">
            {#if $currentState.state !== undefined}
                <div class="field">
                    <label class="label" for="owner">Owner</label>
                    <div class="control">
                    {#each $currentState.state.players as p}
                        <label class="radio">
                            <input type="radio" name="owner" bind:group={owner} value="{p.id}">
                            {p.id}
                        </label>
                        {/each}
                    </div>
                </div>
            {/if}
            </div>
            <div class="column">
                <div class="field">
                    <label class="label" for="position">Position</label>
                    <div class="control">
                        <input class="input" type="text" name="position" bind:value={posStr} readonly>
                    </div>
                    <p class="help">
                        {#if placementStep === "ftl"}
                            Ship is fixed at ({ftlShipPosition?.x.toFixed(2)},
                            {ftlShipPosition?.y.toFixed(2)}). Click inside the placement ring for
                            the current squadron.
                        {:else}
                            Left-click on the map where you want the ship to go. A beacon will appear.
                            You can zoom into the map to get more precise. Additional left-clicks will
                            move the beacon. You can also right-click to clear it.
                        {/if}
                    </p>
                </div>
            </div>
            <div class="column">
                <div class="field">
                    <label class="label" for="shipSpeed">Speed</label>
                    <div class="control">
                        <input class="input" name="shipSpeed" type="number" min="0" step="1" bind:value={cmd.speed}>
                    </div>
                </div>
            </div>
        </div>
        <div class="columns">
            <div class="column">
                <div class="field">
                    <label class="label" for="facing">Facing</label>
                    <div class="control" style="max-width: 15vw" on:click={handleClockClick}>
                        <Clock />
                    </div>
                    <p class="help">Select the ship's initial facing by clicking on the appropriate number.</p>
                </div>
            </div>
            <div class="column">
                <div class="field">
                    <div class="control">
                        {#if vectorAllowed}
                        <label class="checkbox">
                            <input type="checkbox" bind:checked={courseEnabled}>
                            Vector movement (cannot be changed later)
                        </label>
                        {:else}
                        <p class="help">Vector movement is not enabled for this game.</p>
                        {/if}
                    </div>
                    {#if courseEnabled && vectorAllowed}
                    <div class="control mt-2">
                        <label class="label" for="shipCourse">Starting course (°)</label>
                        <input class="input" name="shipCourse" type="number" min="0" max="360" bind:value={cmd.course}>
                        <p class="help">0° = starboard, increases counter-clockwise. Defaults from facing.</p>
                    </div>
                    {/if}
                </div>
            </div>
            <div class="column">
            {#key cmd.svg}
                {#if ownerColour !== undefined && facing !== undefined && speed !== undefined}
                    <RenderCounter
                        svg={cmd.svg}
                        colour={ownerColour}
                        facing={cmd.facing}
                        speed={cmd.speed}
                        course={courseEnabled ? cmd.course : undefined}
                    />
                {/if}
            {/key}
            </div>
        </div>
    </div>
    <div class="column">
{#key cmd.object}
    {#if shipJSON?.trim() && shipJsonCheck?.wellFormed}
        <RenderSSD json={shipJSON} />
    {/if}
{/key}
    </div>
</div>
<div class="control buttons">
    {#if placementStep === "ftl" && currentFtlEntry}
        <p class="notification is-info is-light">
            {#if currentFtlEntry.optional}
                <strong>{currentFtlEntry.label}</strong>
                ({ftlIndex + 1} of {ftlQueue.length}). Deploy on the map within the
                <strong>{ftlRadius} MU</strong> ring, or keep the wing in its hangar.
            {:else}
                Place <strong>{currentFtlEntry.label}</strong> within the
                <strong>{ftlRadius} MU</strong> ring around the ship ({ftlIndex + 1} of
                {ftlQueue.length}). Click inside the ring, then confirm.
            {/if}
            {#if deployedSquadrons.length > 0}
                <span class="is-block mt-1">Green dots show squadrons already placed this turn.</span>
            {/if}
        </p>
        {#if ftlPlaceWarning}
            <p class="help is-danger">{ftlPlaceWarning}</p>
        {/if}
        <div class="field mb-3">
            <label class="label" for="ftlCallsign">Squadron callsign (optional)</label>
            <input
                id="ftlCallsign"
                class="input"
                type="text"
                maxlength="32"
                bind:value={ftlCallsignDraft}
                placeholder="e.g. Red Flight"
            />
            <p class="help">Shown on the map and in logs for this wing or gunboat squadron.</p>
        </div>
        <button type="button" class="button is-primary" on:click={confirmFtlPlacement}>
            {#if currentFtlEntry.optional}
                Deploy this wing
            {:else}
                Confirm squadron position
            {/if}
        </button>
        {#if currentFtlEntry.optional}
            <button type="button" class="button is-light" on:click={skipOptionalFtlWing}>
                Keep in hangar
            </button>
        {/if}
        <button type="button" class="button is-light" on:click={skipFtlWithAuto}>
            Auto-place this squadron
        </button>
    {:else}
    <button class="button is-primary" on:click={validateCommand} disabled={!canPlaceId}>
        Place ship
    </button>
    {/if}
    {#if savedPlacementTemplate}
        <button type="button" class="button is-light" on:click={placeAnotherCopy}>
            Place another copy
        </button>
    {/if}
</div>
{#each warnings as w}
    <p class="help is-danger">{w}</p>
{/each}
{#if shipJsonCheck?.blockingMessages.length}
    {#each shipJsonCheck.blockingMessages as msg}
        <p class="help is-danger">{msg}</p>
    {/each}
{/if}
{#if shipJsonCheck?.warnings.length}
    {#each shipJsonCheck.warnings as msg}
        <p class="help has-text-warning-dark">{msg}</p>
    {/each}
{/if}

<style></style>
