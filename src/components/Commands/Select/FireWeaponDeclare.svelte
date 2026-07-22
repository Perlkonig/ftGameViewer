<script lang="ts">
    import { createEventDispatcher, onDestroy, tick } from "svelte";
    import { currentState } from "@/stores/derivedState";
    import { clickMode } from "@/stores/writeClickMode";
    import { selectedObject } from "@/stores/writeSelectedObject";
    import { annotations, type IAnnotation } from "@/stores/writeAnnotations";
    import { focusMapOnPoint, focusMapOnBounds } from "@/stores/writeMapView";
    import { focusMapOnShipId } from "@/lib/actMapInteraction";
    import { appendGameCommands } from "@/lib/game/appendCommand";
    import { validateDeclareShipFire } from "@/lib/game/commandValidation";
    import {
        shipsCompletedActivation,
        shipsWithPendingFireOrders,
    } from "@/lib/game/segmentApply";
    import {
        findWeaponEntry,
        type ShipGameState,
        type ShipSystemEntry,
    } from "@/lib/game/shipSystems";
    import {
        boundsFromAnnotations,
        defaultBeamClassForWeapon,
        defaultPdsDiceForWeapon,
        inferShipFireProfile,
        weaponAnnotationsForSystem,
        type ShipFireProfileKey,
    } from "@/lib/weaponAnnotations";
    import { encodeFireDeclarationNotes } from "@/lib/game/resolveCombat";
    import { effectiveScreensForIncomingFire } from "@/lib/game/areaScreens";
import type { ShipGameState } from "@/lib/game/shipSystems";
    import { distance, bearingArc, type ClockFacing } from "@/lib/game/movement";
    import { parseObjectRef } from "@/lib/objectRef";
    import type { FullThrustGameCommand } from "@/schemas/commands";
    import type { FullThrustShip } from "ftlibship";
    import type { FullThrustGameObjects, Position } from "@/schemas/position";
    import { toast } from "@zerodevx/svelte-toast";
    import { userSettings } from "@/stores/writeUserSettings";
    import RenderSsd from "@/components/RenderSSD.svelte";
    import { buildShipRenderOpts } from "@/lib/ssdRenderOpts";
    import ActError from "./ActError.svelte";
    import { get } from "svelte/store";

    export let ships: FullThrustGameObjects[] = [];
    export let selectedOwner = "";

    const dispatch = createEventDispatcher();

    type DeclareStep = "pickWeapon" | "pickTarget" | "confirm";

    let firerId = "";
    let weaponId = "";
    let weaponLabel = "";
    let selectedWeapon: ShipSystemEntry | undefined;
    let targetId = "";
    let targetLabel = "";
    let declareStep: DeclareStep = "pickWeapon";

    let profile: ShipFireProfileKey = "beam";
    let beamClass = 2;
    let defaultBeamClass = 2;
    let screens = 0;
    let defaultScreens = 0;
    let autoScreens = true;
    let pdsDice = 1;
    let defaultPdsDice = 1;

    let shipJson = "";
    let renderOpts: import("ftlibship").RenderOpts = { minimal: true };
    const mapAnnotationIds = new Set<string>();
    let prevFirerId = "";

    $: players = $currentState.state?.players ?? [];
    $: completedFire = new Set(
        shipsCompletedActivation(
            $currentState.meta ?? {
                phase: 11,
                turn: 1,
                version: "",
                name: "",
                createdAt: "",
                dicePolicy: "hybrid",
            }
        )
    );
    $: pendingFireShips = shipsWithPendingFireOrders($currentState.pendingFireDeclarations);

    $: firer = ships.find((s) => s.id === firerId) as FullThrustGameObjects | undefined;
    $: allObjects = $currentState.state?.objects ?? [];

    $: targetObj = targetId
        ? allObjects.find((o) => o.id === targetId)
        : undefined;
    $: targetShip =
        targetObj?.objType === "ship" ? targetObj : undefined;
    $: targetFighter =
        targetObj?.objType === "fighters" ? targetObj : undefined;
    $: targetOrdnance =
        targetObj?.objType === "ordnance" ? targetObj : undefined;
    $: pdsTarget = targetFighter ?? targetOrdnance;

    $: if (autoScreens && targetShip) {
        const firerPos =
            firer?.position && typeof firer.position === "object" && "x" in firer.position
                ? (firer.position as { x: number; y: number })
                : undefined;
        screens = effectiveScreensForIncomingFire(
            $currentState.state ?? undefined,
            targetShip as ShipGameState,
            firerPos
        );
        defaultScreens = screens;
    }

    $: range =
        firer?.position && targetShip?.position
            ? distance(
                  firer.position as Position,
                  targetShip.position as Position
              )
            : firer?.position &&
                pdsTarget?.position &&
                typeof pdsTarget.position === "object" &&
                "x" in pdsTarget.position
              ? distance(
                    firer.position as Position,
                    pdsTarget.position as Position
                )
              : 0;
    $: arc =
        firer?.position && targetShip?.position
            ? bearingArc(
                  firer.position as Position,
                  firer.facing as ClockFacing,
                  targetShip.position as Position
              )
            : undefined;

    $: alteredFromDefaults = (() => {
        const altered: string[] = [];
        if (profile !== "pds" && beamClass !== defaultBeamClass) altered.push("beamClass");
        if ((profile === "beam" || profile === "plasma") && !autoScreens && screens !== defaultScreens) {
            altered.push("screens");
        }
        if (profile === "pds" && pdsDice !== defaultPdsDice) altered.push("pdsDice");
        return altered;
    })();

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
        pendingFireDeclarations: $currentState.pendingFireDeclarations,
    };

    $: actIssues = (() => {
        const issues = firerId
            ? validateDeclareShipFire(foldStub, firerId, weaponId || undefined)
            : [];
        for (const field of alteredFromDefaults) {
            issues.push({
                message: `Non-default ${field} selected — moderator should verify.`,
                severity: "warning",
            });
        }
        return issues;
    })();

    const shipOptionLabel = (id: string, owner?: string): string => {
        const bits = [id];
        if (owner) bits.push(`(${owner})`);
        if (completedFire.has(id)) bits.push("[activated]");
        else if (pendingFireShips.has(id)) bits.push("[orders pending]");
        return bits.join(" ");
    };

    const removeMapAnnotations = () => {
        if (mapAnnotationIds.size === 0) return;
        annotations.update((list) => list.filter((n) => !mapAnnotationIds.has(n.id)));
        mapAnnotationIds.clear();
    };

    const pushMapAnnotations = (items: IAnnotation[]) => {
        removeMapAnnotations();
        for (const a of items) {
            mapAnnotationIds.add(a.id);
        }
        annotations.update((list) => [...list, ...items]);
    };

    const loadFirerSsd = (ship: FullThrustGameObjects) => {
        shipJson = JSON.stringify(ship.object);
        renderOpts = buildShipRenderOpts(ship);
    };

    const resetWeaponAndTarget = () => {
        weaponId = "";
        weaponLabel = "";
        selectedWeapon = undefined;
        targetId = "";
        targetLabel = "";
        declareStep = "pickWeapon";
        removeMapAnnotations();
    };

    const onFirerChange = async () => {
        if (!firerId || firerId === prevFirerId) return;
        prevFirerId = firerId;
        resetWeaponAndTarget();
        const ship = ships.find((s) => s.id === firerId);
        if (!ship?.position) return;
        loadFirerSsd(ship);
        focusMapOnShipId(firerId, ships);
        clickMode.set(undefined);
        await tick();
    };

    $: if (firerId) {
        void onFirerChange();
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

    const applyWeaponSelection = (weapon: ShipSystemEntry) => {
        weaponId = weapon.id;
        weaponLabel = `${weapon.name ?? "weapon"} (${weapon.id})`;
        selectedWeapon = weapon;
        profile = inferShipFireProfile(weapon);
        defaultBeamClass = defaultBeamClassForWeapon(weapon);
        beamClass = defaultBeamClass;
        defaultPdsDice = defaultPdsDiceForWeapon(weapon);
        pdsDice = defaultPdsDice;
        autoScreens = profile === "beam" || profile === "plasma";

        targetId = "";
        targetLabel = "";
        selectedObject.set(undefined);

        const shipSrc = firer!.object as FullThrustShip;
        const anns = weaponAnnotationsForSystem(
            shipSrc,
            firer!.position as Position,
            firer!.facing as import("@/lib/genArcs").Facing,
            weapon
        );
        pushMapAnnotations(anns);
        const bounds = boundsFromAnnotations(anns);
        if (bounds) {
            focusMapOnBounds(bounds, 2);
        }

        declareStep = "pickTarget";
        clickMode.set("select");
    };

    const handleSsdClick = () => {
        if (!firer) return;
        const ele = getInnermostHovered();
        if (!ele?.id) return;

        const weapon = findWeaponEntry(firer as ShipGameState, ele.id);
        if (!weapon) {
            toast.push("Select a weapon system on the SSD (not fire control or other systems).");
            return;
        }

        const wasFirstPick = declareStep === "pickWeapon";
        const changed = weapon.id !== weaponId;
        applyWeaponSelection(weapon);
        if (changed || wasFirstPick) {
            toast.push("Click an enemy ship, fighter group, or ordnance token on the map.");
        }
    };

    const resolveTargetFromSelection = (refKey: string | undefined) => {
        if (!refKey || !firer || declareStep !== "pickTarget") return;
        const ref = parseObjectRef(refKey);
        if (!ref) return;
        const obj = allObjects.find((o) => o.objType === ref.objType && o.id === ref.objId);
        if (!obj) return;
        const owner = "owner" in obj && typeof obj.owner === "string" ? obj.owner : undefined;
        if (!owner || owner === firer.owner) {
            toast.push("Target must belong to another player.");
            return;
        }
        if (profile !== "pds" && obj.objType !== "ship") {
            toast.push("This weapon must target an enemy ship.");
            return;
        }
        if (!obj.position) {
            toast.push("Target has no map position.");
            return;
        }
        targetId = obj.id;
        targetLabel = `${obj.objType} ${obj.id} (${owner})`;
        declareStep = "confirm";
        clickMode.set(undefined);
    };

    $: resolveTargetFromSelection($selectedObject);

    const declare = () => {
        if (!firer || !weaponId) {
            toast.push("Select firing ship and weapon on the SSD");
            return;
        }
        if (profile === "pds" ? !pdsTarget : !targetShip) {
            toast.push("Select a valid enemy target on the map");
            return;
        }

        const dest = appendGameCommands(
            [
                {
                    name: "declareShipFire",
                    ship: firerId,
                    weapon: weaponId,
                    target: targetId,
                    notes: encodeFireDeclarationNotes({
                        profile,
                        beamClass,
                        screens,
                        pdsDice,
                        range,
                        arc: arc !== undefined ? Number(arc) : undefined,
                        weaponName: selectedWeapon?.name,
                        alteredFromDefaults:
                            alteredFromDefaults.length > 0 ? alteredFromDefaults : undefined,
                    }),
                } as FullThrustGameCommand,
            ],
            ($userSettings.role ?? "player") === "moderator"
        );

        const warn = actIssues.filter((i) => i.severity === "warning");
        if (warn.length) {
            toast.push(warn.map((w) => w.message).join(" "));
        }
        toast.push(
            dest === "master" ? "Fire declaration logged" : "Declaration added to proposals"
        );
        dispatch("done");
    };

    onDestroy(() => {
        removeMapAnnotations();
        if (get(clickMode) === "select") {
            clickMode.set(undefined);
        }
        selectedObject.set(undefined);
    });
</script>

{#if players.length > 1}
    <div class="field">
        <label class="label" for="owner">Player</label>
        <div class="select">
            <select id="owner" bind:value={selectedOwner}>
                {#each players as p}
                    <option value={p.id}>{p.id}</option>
                {/each}
            </select>
        </div>
    </div>
{/if}

<div class="field">
    <label class="label" for="firer">Firing ship</label>
    <div class="select">
        <select id="firer" bind:value={firerId}>
            <option value="">--</option>
            {#each ships as s}
                <option value={s.id}
                    >{shipOptionLabel(
                        s.id,
                        typeof s.owner === "string" ? s.owner : undefined
                    )}</option
                >
            {/each}
        </select>
    </div>
    <p class="help">Pick a ship, then click a weapon on its SSD below.</p>
</div>

{#if firerId && shipJson}
    <div class="field">
        <p class="help mb-2">
            {#if declareStep === "pickWeapon"}
                <strong>Step 2:</strong> Click a weapon system on the SSD.
            {:else if declareStep === "pickTarget"}
                <strong>Step 3:</strong> Click an enemy token on the map (or pick another weapon on the SSD).
            {:else}
                <strong>Step 4:</strong> Confirm options and declare fire (or pick another weapon on the SSD).
            {/if}
        </p>
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <div class="ssd-picker" on:click={handleSsdClick}>
            <RenderSsd json={shipJson} opts={renderOpts} />
        </div>
    </div>

    <div class="field">
        <label class="label" for="weaponSel">Selected weapon</label>
        <input
            id="weaponSel"
            class="input"
            readonly
            value={weaponLabel}
            placeholder="— click a weapon on the SSD —"
        />
    </div>

    <div class="field">
        <label class="label" for="targetSel">Selected target</label>
        <input
            id="targetSel"
            class="input"
            readonly
            value={targetLabel}
            placeholder="— click an enemy on the map —"
        />
    </div>

    {#if weaponId && (profile === "beam" || profile === "plasma" || profile === "graserStd" || profile === "kgun")}
        <div class="field">
            <label class="label" for="bc">Class / dice at band 1</label>
            <input id="bc" class="input" type="number" min="1" max="5" bind:value={beamClass} />
        </div>
    {/if}

    {#if weaponId && profile === "pds"}
        <div class="field">
            <label class="label" for="pdsDice">PDS dice</label>
            <input id="pdsDice" class="input" type="number" min="1" max="12" bind:value={pdsDice} />
        </div>
    {/if}

    {#if weaponId && (profile === "beam" || profile === "plasma")}
        <div class="field">
            <label class="checkbox">
                <input type="checkbox" bind:checked={autoScreens} /> Auto screens from target SSD
            </label>
        </div>
        <div class="field">
            <label class="label" for="scr">Target screens</label>
            <div class="select">
                <select id="scr" bind:value={screens} disabled={autoScreens}>
                    <option value={0}>0</option>
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                </select>
            </div>
        </div>
    {/if}

    {#if firer && (targetShip || pdsTarget)}
        <p class="help">
            Range {range.toFixed(2)} MU
            {#if arc}· Arc {arc}{/if}
        </p>
    {/if}

    <button
        class="button is-primary"
        disabled={!weaponId || declareStep !== "confirm"}
        on:click={declare}
    >
        Declare fire
    </button>
    <ActError issues={actIssues} />
{/if}

<style>
    .ssd-picker {
        max-width: 320px;
        cursor: crosshair;
    }
    .ssd-picker :global(svg [id]) {
        cursor: pointer;
    }
</style>
