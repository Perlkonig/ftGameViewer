<script lang="ts">
    import { createEventDispatcher, onDestroy, tick } from "svelte";
    import { currentState } from "@/stores/derivedState";
    import { commands } from "@/stores/writeCommands";
    import { headOffset } from "@/stores/writeHeadOffset";
    import { gameMeta } from "@/stores/writeGameMeta";
    import { initialState } from "@/stores/writeInitialState";
    import { annotations, type IAnnotation } from "@/stores/writeAnnotations";
    import { focusMapOnBounds } from "@/stores/writeMapView";
    import { focusMapOnShipId } from "@/lib/actMapInteraction";
    import { appendGameCommands } from "@/lib/game/appendCommand";
    import { validateDeclareShipFireBatch, summarizeFireDeclaration, fireOrderIneffectiveAtRangeIssue, fireDeclarationModeratorLogMessages } from "@/lib/game/commandValidation";
    import {
        shipsCompletedActivation,
        pendingFireForShip,
        filterNewFireDeclarations,
        applyExclusiveFireControlTarget,
        enemyTargetsForFireControl,
        shipsWithDeclaredFire,
        declaredFireWeaponIdsForShip,
    } from "@/lib/game/segmentApply";
    import { commandsInCurrentPhaseSegment } from "@/lib/game/moderatorStatus";
    import type { GamePhase } from "@/lib/game/types";
    import {
        findWeaponEntry,
        functionalFireControls,
        installedFireControls,
        isSystemDamaged,
        isSystemDamagedOrDestroyed,
        isSystemDestroyed,
        operationalFireControls,
        shipFireWeaponEntries,
        shipRequiresFireControl,
        type ShipGameState,
        type ShipSystemEntry,
    } from "@/lib/game/shipSystems";
    import {
        boundsFromAnnotations,
        defaultBeamClassForWeapon,
        inferShipFireProfile,
        weaponAnnotationsForSystem,
    } from "@/lib/weaponAnnotations";
    import { shipFireProfile, type ShipFireProfileKey } from "@/lib/game/shipFireProfiles";
    import { canOperateAsShipFire } from "@/lib/game/shipFireProfiles";
    import { encodeFireDeclarationNotes, decodeFireDeclarationNotes } from "@/lib/game/resolveCombat";
    import { screenLevelFromSystems } from "@/lib/game/combat";
    import { distance, bearingArc, type ClockFacing, type FireArc } from "@/lib/game/movement";
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

    interface WeaponAssignment {
        weapon: ShipSystemEntry;
        targetId: string;
        fireControlId: string;
        profile: ShipFireProfileKey;
        beamClass: number;
        defaultBeamClass: number;
        screens: number;
        defaultScreens: number;
        autoScreens: boolean;
        needleSystemId: string;
    }

    let firerId = "";
    let fcTargets: Record<string, string> = {};
    let assignments: WeaponAssignment[] = [];
    let activeFireControlId = "";

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
    $: phase = ($currentState.meta?.phase ?? 11) as GamePhase;
    $: visibleCommands = $commands.slice(0, Math.max(0, $commands.length - $headOffset));
    $: phaseCommands =
        $currentState.state && $currentState.meta
            ? commandsInCurrentPhaseSegment(
                  visibleCommands,
                  { turn: $currentState.meta.turn, phase },
                  $gameMeta,
                  $initialState
              )
            : [];
    $: shipsWithExistingFire = shipsWithDeclaredFire(
        phaseCommands,
        $currentState.pendingFireDeclarations
    );
    $: firer = ships.find((s) => s.id === firerId) as FullThrustGameObjects | undefined;
    $: allObjects = $currentState.state?.objects ?? [];
    $: installedFc = firer ? installedFireControls(firer as ShipGameState) : [];
    $: functionalFc = firer ? functionalFireControls(firer as ShipGameState) : [];
    $: requiresFc = firer ? shipRequiresFireControl(firer as ShipGameState) : false;
    $: shipWeapons = firer ? shipFireWeaponEntries(firer as ShipGameState) : [];

    $: enemyShips = allObjects.filter(
        (o) =>
            o.objType === "ship" &&
            o.position &&
            "owner" in o &&
            typeof o.owner === "string" &&
            o.owner !== firer?.owner
    ) as FullThrustGameObjects[];

    const rangeToTarget = (targetId: string): number => {
        const tgt = allObjects.find((o) => o.objType === "ship" && o.id === targetId);
        if (!firer?.position || !tgt?.position) return 0;
        return distance(firer.position as Position, tgt.position as Position);
    };

    $: enemyTargetsByDistance = enemyShips
        .map((es) => ({ ship: es, range: rangeToTarget(es.id) }))
        .sort((a, b) => a.range - b.range || a.ship.id.localeCompare(b.ship.id));

    const targetOptionLabel = (shipId: string, owner?: string): string => {
        const range = rangeToTarget(shipId);
        const ownerPart = owner ? ` (${owner})` : "";
        return `${shipId}${ownerPart} — ${range.toFixed(1)} MU`;
    };

    $: fcAssignedTargets = [
        ...new Set(Object.values(fcTargets).filter((t) => t && t.length > 0)),
    ];

    $: armedFcs = functionalFc.filter((fc) => !!fcTargets[fc.id]);

    $: if (fcAssignedTargets.length <= 1) {
        activeFireControlId = "";
    } else if (!activeFireControlId || !fcTargets[activeFireControlId]) {
        activeFireControlId = armedFcs[0]?.id ?? "";
    }

    $: existingFireWarnings = (() => {
        if (!firerId) return [];
        const issues: { message: string; severity: "warning" }[] = [];
        if (shipsWithExistingFire.has(firerId)) {
            const n = declaredFireWeaponIdsForShip(
                firerId,
                phaseCommands,
                $currentState.pendingFireDeclarations
            ).size;
            issues.push({
                message: `${firerId} already has fire declarations this phase (${n} weapon(s)). Additional orders may duplicate weapons already declared.`,
                severity: "warning",
            });
        }
        if (completedFire.has(firerId)) {
            issues.push({
                message: `${firerId} already completed its fire activation this phase — additional orders are typically not allowed.`,
                severity: "warning",
            });
        }
        return issues;
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

    $: firerFireconIssues = (() => {
        if (!firerId || !firer) return [];
        const ship = firer as ShipGameState;
        if (!requiresFc) return [];
        if (functionalFc.length > 0) return [];
        return [
            {
                message: `${firerId} has no functional fire control (all damaged or destroyed) — you cannot assign targets.`,
                severity: "warning" as const,
            },
        ];
    })();

    $: actIssues = firerId
        ? validateDeclareShipFireBatch(foldStub, firerId, buildNewDecls(), fcTargets)
        : [];

    const shipOptionLabel = (id: string, owner?: string): string => {
        const ownerPart = owner ? ` (${owner})` : "";
        const alreadyFired = shipsWithExistingFire.has(id) || completedFire.has(id);
        return `${id}${ownerPart}${alreadyFired ? " *" : ""}`;
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

    const loadAssignmentsFromPending = (ship: FullThrustGameObjects) => {
        const fold = {
            meta: get(currentState).meta ?? foldStub.meta,
            position: get(currentState).state ?? foldStub.position,
            pendingFireDeclarations: get(currentState).pendingFireDeclarations,
        };
        const pending = pendingFireForShip(fold, ship.id);
        if (pending.length === 0) return;

        const hydrated: WeaponAssignment[] = [];
        const hydratedFc = { ...fcTargets };
        for (const cmd of pending) {
            const summary = summarizeFireDeclaration(cmd);
            if (!summary || summary.profile === "pds") continue;
            const weapon = findWeaponEntry(ship as ShipGameState, summary.weaponId);
            if (!weapon) continue;

            const meta = decodeFireDeclarationNotes((cmd as { notes?: string }).notes);
            const profile =
                meta.profile ?? inferShipFireProfile(weapon);
            const defaultBeamClass = defaultBeamClassForWeapon(weapon);
            const tgt = targetShip(summary.targetId);
            const systems = (tgt?.object as { systems?: { name?: string; type?: string; level?: number }[] })
                ?.systems;
            const defaultScreens = screenLevelFromSystems(Array.isArray(systems) ? systems : []);
            const beamClass = meta.beamClass ?? defaultBeamClass;
            const screens = meta.screens ?? defaultScreens;
            const autoScreens =
                (profile === "beam" || profile === "plasma") &&
                !meta.alteredFromDefaults?.includes("screens");

            if (summary.fireControlId) {
                hydratedFc[summary.fireControlId] = summary.targetId;
            }
            hydrated.push({
                weapon,
                targetId: summary.targetId,
                fireControlId: summary.fireControlId ?? "",
                profile,
                beamClass,
                defaultBeamClass,
                screens,
                defaultScreens,
                autoScreens,
                needleSystemId: meta.needleSystemId ?? "",
            });
        }
        if (hydrated.length > 0) {
            assignments = hydrated;
            fcTargets = hydratedFc;
        }
    };

    const targetsForFc = (fcId: string) => {
        const ids = enemyTargetsForFireControl(
            fcId,
            fcTargets,
            enemyTargetsByDistance.map(({ ship }) => ship.id)
        );
        const idSet = new Set(ids);
        return enemyTargetsByDistance.filter(({ ship }) => idSet.has(ship.id));
    };

    const onFcTargetChange = (fcId: string, targetId: string) => {
        if (firer && isSystemDamagedOrDestroyed(firer as ShipGameState, fcId)) {
            toast.push(`Fire control ${fcId} is damaged or destroyed — cannot assign a target`);
            return;
        }
        fcTargets = applyExclusiveFireControlTarget(fcTargets, fcId, targetId);
    };

    const resetFirerState = () => {
        assignments = [];
        activeFireControlId = "";
        fcTargets = {};
        removeMapAnnotations();
    };

    const onFirerChange = async () => {
        if (!firerId || firerId === prevFirerId) return;
        prevFirerId = firerId;
        resetFirerState();
        const ship = ships.find((s) => s.id === firerId);
        if (!ship?.position) return;
        loadFirerSsd(ship);
        focusMapOnShipId(firerId, ships);
        const fcs = operationalFireControls(ship as ShipGameState);
        for (const fc of fcs) {
            fcTargets[fc.id] = "";
        }
        fcTargets = fcTargets;
        loadAssignmentsFromPending(ship);
        await tick();
    };

    $: if (firerId) {
        void onFirerChange();
    }

    const fcForTarget = (targetId: string): string | undefined =>
        Object.entries(fcTargets).find(([, t]) => t === targetId)?.[0];

    const assignmentFc = (): { fcId: string; targetId: string } | undefined => {
        if (fcAssignedTargets.length === 0) return undefined;
        if (fcAssignedTargets.length === 1) {
            const targetId = fcAssignedTargets[0];
            const fcId = fcForTarget(targetId);
            return fcId && targetId ? { fcId, targetId } : undefined;
        }
        const targetId = fcTargets[activeFireControlId];
        if (!activeFireControlId || !targetId) return undefined;
        return { fcId: activeFireControlId, targetId };
    };

    const targetShip = (targetId: string) =>
        allObjects.find((o) => o.objType === "ship" && o.id === targetId) as
            | FullThrustGameObjects
            | undefined;

    const arcToTarget = (targetId: string): FireArc | undefined => {
        const tgt = targetShip(targetId);
        if (!firer?.position || !tgt?.position) return undefined;
        return bearingArc(
            firer.position as Position,
            firer.facing as ClockFacing,
            tgt.position as Position
        );
    };

    const profileLabel = (profile: ShipFireProfileKey): string =>
        shipFireProfile(profile).label;

    const assignmentRangeWarning = (a: WeaponAssignment): string | undefined => {
        const range = rangeToTarget(a.targetId);
        const tgt = targetShip(a.targetId);
        return fireOrderIneffectiveAtRangeIssue({
            weaponId: a.weapon.id,
            weaponName: a.weapon.name,
            profileKey: a.profile,
            beamClass: a.beamClass,
            rangeMu: range,
            weapon: a.weapon,
            targetShip: tgt as ShipGameState,
        })?.message;
    };

    const getInnermostHovered = (): Element | undefined => {
        let n = document.querySelector(":hover");
        let nn: Element | undefined;
        while (n) {
            nn = n;
            n = nn.querySelector(":hover");
        }
        return nn;
    };

    const addAssignment = (
        weapon: ShipSystemEntry,
        targetId: string,
        fireControlId: string
    ) => {
        if (!fireControlId || fcTargets[fireControlId] !== targetId) {
            toast.push("Assign fire control to that target first");
            return;
        }
        if (assignments.some((a) => a.weapon.id === weapon.id)) {
            toast.push(`Weapon ${weapon.id} is already assigned`);
            return;
        }
        const profile = inferShipFireProfile(weapon);
        const defaultBeamClass = defaultBeamClassForWeapon(weapon);
        const range = rangeToTarget(targetId);
        const tgt = targetShip(targetId);
        const systems = (tgt?.object as { systems?: { name?: string; type?: string; level?: number }[] })
            ?.systems;
        const defaultScreens = screenLevelFromSystems(Array.isArray(systems) ? systems : []);
        const rangeIssue = fireOrderIneffectiveAtRangeIssue({
            weaponId: weapon.id,
            weaponName: weapon.name,
            profileKey: profile,
            beamClass: defaultBeamClass,
            rangeMu: range,
            weapon,
            targetShip: tgt as ShipGameState,
        });
        if (rangeIssue) toast.push(rangeIssue.message);
        assignments = [
            ...assignments,
            {
                weapon,
                targetId,
                fireControlId,
                profile,
                beamClass: defaultBeamClass,
                defaultBeamClass,
                screens: defaultScreens,
                defaultScreens,
                autoScreens: profile === "beam" || profile === "plasma",
                needleSystemId: "",
            },
        ];

        const shipSrc = firer!.object as FullThrustShip;
        const anns = weaponAnnotationsForSystem(
            shipSrc,
            firer!.position as Position,
            firer!.facing as import("@/lib/genArcs").Facing,
            weapon
        );
        pushMapAnnotations(anns);
        const bounds = boundsFromAnnotations(anns);
        if (bounds) focusMapOnBounds(bounds, 2);
    };

    const handleSsdClick = () => {
        if (!firer) return;
        const ship = firer as ShipGameState;
        if (requiresFc && functionalFc.length === 0) {
            toast.push("No functional fire control — cannot assign weapon targets");
            return;
        }
        if (fcAssignedTargets.length === 0) {
            toast.push("Assign at least one fire control to a target first");
            return;
        }
        const ele = getInnermostHovered();
        if (!ele?.id) return;
        const weapon = findWeaponEntry(ship, ele.id);
        if (!weapon || !canOperateAsShipFire(weapon)) {
            toast.push("Select a ship-fire weapon on the SSD (not PDS or fire control)");
            return;
        }
        if (isSystemDamagedOrDestroyed(ship, weapon.id)) {
            toast.push(
                `Weapon ${weapon.name ?? weapon.id} is ${isSystemDestroyed(ship, weapon.id) ? "destroyed" : "damaged"} — fire order may be invalid`
            );
        }
        if (assignments.some((a) => a.weapon.id === weapon.id)) {
            removeAssignment(weapon.id);
            toast.push(`Removed ${weapon.name ?? weapon.id} from fire orders`);
            return;
        }
        const pair = assignmentFc();
        if (!pair) {
            if (fcAssignedTargets.length > 1) {
                toast.push("Choose which fire control you are arming above the SSD");
            }
            return;
        }
        addAssignment(weapon, pair.targetId, pair.fcId);
    };

    const removeAssignment = (weaponId: string) => {
        assignments = assignments.filter((a) => a.weapon.id !== weaponId);
        if (assignments.length === 0) removeMapAnnotations();
    };

    const clearAllAssignments = () => {
        assignments = [];
        removeMapAnnotations();
    };

    const buildDecls = (): FullThrustGameCommand[] => {
        if (!firer) return [];
        return assignments.map((a) => {
            const range = rangeToTarget(a.targetId);
            const arc = arcToTarget(a.targetId);
            const altered: string[] = [];
            if (a.profile !== "pds" && a.beamClass !== a.defaultBeamClass) altered.push("beamClass");
            if (
                (a.profile === "beam" || a.profile === "plasma") &&
                !a.autoScreens &&
                a.screens !== a.defaultScreens
            ) {
                altered.push("screens");
            }
            return {
                name: "declareShipFire",
                ship: firerId,
                weapon: a.weapon.id,
                target: a.targetId,
                notes: encodeFireDeclarationNotes({
                    profile: a.profile,
                    beamClass: a.beamClass,
                    screens: a.screens,
                    range,
                    arc: arc !== undefined ? Number(arc) : undefined,
                    weaponName: a.weapon.name,
                    fireControlId: a.fireControlId,
                    needleSystemId:
                        a.profile === "needle" && a.needleSystemId ? a.needleSystemId : undefined,
                    alteredFromDefaults: altered.length ? altered : undefined,
                }),
            } as FullThrustGameCommand;
        });
    };

    const buildNewDecls = (): FullThrustGameCommand[] =>
        filterNewFireDeclarations(foldStub, firerId, buildDecls());

    const resetFormAfterDeclare = () => {
        resetFirerState();
        firerId = "";
        prevFirerId = "";
        shipJson = "";
        activeFireControlId = "";
    };

    const submit = () => {
        if (!firer || assignments.length === 0) {
            toast.push("Assign at least one weapon to a fire-control target");
            return;
        }
        for (const a of assignments) {
            if (a.profile === "needle" && !a.needleSystemId.trim()) {
                toast.push(`Needle ${a.weapon.id} needs a target system id`);
                return;
            }
        }
        const decls = buildNewDecls();
        if (decls.length === 0) {
            toast.push("No new fire declarations to add — orders for these weapons are already logged");
            return;
        }
        const issues = validateDeclareShipFireBatch(foldStub, firerId, decls, fcTargets);
        const modMsgs = fireDeclarationModeratorLogMessages(
            firerId,
            firer as ShipGameState,
            decls,
            fcTargets
        );
        const cmds = [
            ...decls,
            ...modMsgs.map(
                (msg) => ({ name: "_custom", msg }) as FullThrustGameCommand
            ),
        ];
        const dest = appendGameCommands(
            cmds,
            ($userSettings.role ?? "player") === "moderator"
        );
        const warn = issues.filter((i) => i.severity === "warning");
        if (warn.length) toast.push(warn.map((w) => w.message).join(" "));
        toast.push(
            dest === "master"
                ? `Declared fire for ${decls.length} weapon(s)`
                : `Added ${decls.length} declaration(s) to proposals`
        );
        resetFormAfterDeclare();
        dispatch("done");
    };

    onDestroy(() => {
        removeMapAnnotations();
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
    <p class="help">* — already has fire declarations this phase</p>
</div>

{#if firerId && shipJson}
    {#if firerFireconIssues.length > 0}
        <ActError issues={firerFireconIssues} />
    {/if}
    {#if existingFireWarnings.length > 0}
        <ActError issues={existingFireWarnings} />
    {/if}

    {#if installedFc.length > 0}
        <h3 class="title is-6">Fire control → target</h3>
        <p class="help mb-2">
            Each fire control must track a different enemy ship. Assign one target per FC before
            arming weapons. Damaged fire control cannot assign targets.
        </p>
        {#each installedFc as fc}
            {@const destroyed = isSystemDestroyed(firer as ShipGameState, fc.id)}
            {@const damaged = !destroyed && isSystemDamaged(firer as ShipGameState, fc.id)}
            {#if destroyed}
                <p class="help fc-status fc-status--destroyed">
                    Fire control {fc.id} — destroyed
                </p>
            {:else}
                <div class="field">
                    <label class="label" for="fc-{fc.id}">
                        Fire control {fc.id}
                        {#if damaged}<span class="fc-status fc-status--damaged">(damaged)</span>{/if}
                    </label>
                    <div class="select is-fullwidth">
                        <select
                            id="fc-{fc.id}"
                            value={fcTargets[fc.id] ?? ""}
                            disabled={damaged}
                            on:change={(e) =>
                                onFcTargetChange(
                                    fc.id,
                                    (e.currentTarget as HTMLSelectElement).value
                                )}
                        >
                        <option value="">— no target —</option>
                        {#each targetsForFc(fc.id) as { ship: es }}
                            <option value={es.id}
                                >{targetOptionLabel(
                                    es.id,
                                    typeof es.owner === "string" ? es.owner : undefined
                                )}</option
                            >
                        {/each}
                    </select>
                </div>
                    {#if damaged}
                        <p class="help range-warning">Damaged — cannot assign a target.</p>
                    {/if}
            </div>
            {/if}
        {/each}
    {:else}
        <p class="help">No fire-control modules — weapon targets are not limited by FC count.</p>
    {/if}

    <div class="columns fire-layout mt-4">
        <div class="column">
            <h3 class="title is-6">Weapons</h3>
            <p class="help mb-2">
                With one FC target armed, click weapons on the SSD to assign or unassign them (click
                again to remove). With multiple FC targets, choose which fire control you are arming
                above the SSD, then click weapons.
                {#if shipWeapons.length === 0}
                    No operational ship-fire weapons on this SSD.
                {/if}
            </p>
            {#if fcAssignedTargets.length > 1}
                <div class="notification is-light active-fc-picker mb-3">
                    <p class="label mb-2">Assigning weapons for</p>
                    {#each armedFcs as fc}
                        <label class="radio mr-3">
                            <input type="radio" bind:group={activeFireControlId} value={fc.id} />
                            FC {fc.id} → {targetOptionLabel(fcTargets[fc.id])}
                        </label>
                    {/each}
                </div>
            {/if}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <div class="ssd-picker" on:click={handleSsdClick}>
                <RenderSsd json={shipJson} opts={renderOpts} />
            </div>
        </div>

        <div class="column">
            <div class="level is-mobile mb-2">
                <div class="level-left">
                    <h3 class="title is-6 mb-0">Assigned weapons ({assignments.length})</h3>
                </div>
                {#if assignments.length > 0}
                    <div class="level-right">
                        <button
                            type="button"
                            class="button is-small is-light"
                            on:click={clearAllAssignments}
                        >
                            Clear all
                        </button>
                    </div>
                {/if}
            </div>

            <div class="assignment-list">
                {#if assignments.length === 0}
                    <p class="help">Click weapons on the SSD to assign fire orders.</p>
                {:else}
                    <ul class="is-size-7">
                        {#each assignments as a (a.weapon.id)}
                            <li class="mb-3 assignment-row">
                                <div class="assignment-header">
                                    <span>
                                        <strong>{a.weapon.name} ({a.weapon.id})</strong>
                                        → {a.targetId}
                                        <span class="has-text-grey">
                                            · {profileLabel(a.profile)} · FC {a.fireControlId}</span
                                        >
                                    </span>
                                    <button
                                        type="button"
                                        class="button is-small is-danger is-light"
                                        title="Remove this weapon from fire orders"
                                        on:click={() => removeAssignment(a.weapon.id)}
                                    >
                                        Remove
                                    </button>
                                </div>
                                {#if assignmentRangeWarning(a)}
                                    <p class="help range-warning">{assignmentRangeWarning(a)}</p>
                                {/if}
                                {#if firer && isSystemDamagedOrDestroyed(firer as ShipGameState, a.weapon.id)}
                                    <p class="help range-warning">
                                        Weapon is {isSystemDestroyed(firer as ShipGameState, a.weapon.id)
                                            ? "destroyed"
                                            : "damaged"} — fire order may be invalid.
                                    </p>
                                {/if}
                                {#if a.profile === "beam" || a.profile === "plasma" || a.profile === "graserStd" || a.profile === "graserHeavy" || a.profile === "phaser" || a.profile === "kgun"}
                                    <div class="field mt-1">
                                        <label class="label is-size-7" for="bc-{a.weapon.id}">Class</label>
                                        <input
                                            id="bc-{a.weapon.id}"
                                            class="input is-small"
                                            type="number"
                                            min="1"
                                            max="5"
                                            bind:value={a.beamClass}
                                        />
                                    </div>
                                {/if}
                                {#if a.profile === "beam" || a.profile === "plasma"}
                                    <label class="checkbox is-size-7">
                                        <input type="checkbox" bind:checked={a.autoScreens} /> Auto screens
                                    </label>
                                    {#if !a.autoScreens}
                                        <div class="select is-small">
                                            <select bind:value={a.screens}>
                                                <option value={0}>0</option>
                                                <option value={1}>1</option>
                                                <option value={2}>2</option>
                                            </select>
                                        </div>
                                    {/if}
                                {/if}
                                {#if a.profile === "needle"}
                                    <div class="field mt-1">
                                        <label class="label is-size-7" for="ndl-{a.weapon.id}"
                                            >Target system id (destroy on 6)</label
                                        >
                                        <input
                                            id="ndl-{a.weapon.id}"
                                            class="input is-small"
                                            bind:value={a.needleSystemId}
                                            placeholder="system id on target SSD"
                                        />
                                    </div>
                                {/if}
                                <p class="help">
                                    Range {rangeToTarget(a.targetId).toFixed(2)} MU
                                    {#if arcToTarget(a.targetId) !== undefined}
                                        · Arc {arcToTarget(a.targetId)}
                                    {/if}
                                </p>
                            </li>
                        {/each}
                    </ul>
                {/if}
            </div>

            {#if assignments.length > 0}
                <button class="button is-primary mt-3" on:click={submit}>Declare ship fire</button>
                <ActError issues={actIssues} />
            {/if}
        </div>
    </div>
{/if}

<style>
    .ssd-picker {
        max-width: 320px;
        cursor: crosshair;
    }
    .ssd-picker :global(svg [id]) {
        cursor: pointer;
    }
    .assignment-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 0.5rem;
    }
    .assignment-row {
        padding: 0.35rem 0;
        border-bottom: 1px solid #eee;
    }
    .assignment-list {
        max-height: min(70vh, 520px);
        overflow-y: auto;
    }
    .range-warning {
        color: #b86b00;
        margin-top: 0.25rem;
        margin-bottom: 0;
    }
    .fc-status--damaged {
        color: #b86b00;
        font-weight: normal;
    }
    .fc-status--destroyed {
        color: #888;
    }
</style>
