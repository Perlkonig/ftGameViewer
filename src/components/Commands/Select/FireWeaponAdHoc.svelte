<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { currentState } from "@/stores/derivedState";
    import { gameMeta } from "@/stores/writeGameMeta";
    import {
        beamDicePool,
        resolveBeamAttack,
        resolvePdsPool,
        screenLevelFromSystems,
        type ScreenLevel,
        type DamageType,
    } from "@/lib/game/combat";
    import { pushHullDamageCommands, computeShipDamageApplication } from "@/lib/game/resolveCombat";
    import {
        formatAppliedDamage,
        formatNeedleResultNotes,
        formatPdsResultNotes,
        makeLogDice,
    } from "@/lib/game/rollResults";
    import {
        parseDiceString,
        arrayRollSource,
        policyRollSource,
        InsufficientDiceError,
    } from "@/lib/game/dice";
    import { appendGameCommands } from "@/lib/game/appendCommand";
    import type { FullThrustGameCommand } from "@/schemas/commands";
    import { toast } from "@zerodevx/svelte-toast";
    import { userSettings } from "@/stores/writeUserSettings";
    import { focusMapOnObjectId, focusMapOnShipId } from "@/lib/actMapInteraction";
    import { distance, bearingArc, type ClockFacing } from "@/lib/game/movement";

    const dispatch = createEventDispatcher();

    type FireMode = "beam" | "pds" | "plasma" | "sap" | "ap" | "needle";

    $: allShips =
        $currentState.state?.objects?.filter((o) => o.objType === "ship" && o.position) ?? [];
    $: fighters =
        $currentState.state?.objects?.filter((o) => o.objType === "fighters") ?? [];
    $: ordnance =
        $currentState.state?.objects?.filter((o) => o.objType === "ordnance") ?? [];

    let firerId = "";
    let targetId = "";
    let weaponId = "";
    let beamClass = 2;
    let screens: number = 0;
    let autoScreens = true;
    let pdsDice = 1;
    let diceOverride = "";
    let mode: FireMode = "beam";
    let needleSystemId = "";
    let prevFirerId = "";
    let prevTargetId = "";

    $: mapObjects = ($currentState.state?.objects ?? []) as import("@/schemas/position").FullThrustGameObjects[];
    $: ships = allShips;
    $: if (firerId && firerId !== prevFirerId) {
        prevFirerId = firerId;
        focusMapOnShipId(firerId, mapObjects);
    }
    $: if (targetId && targetId !== prevTargetId) {
        prevTargetId = targetId;
        focusMapOnObjectId(targetId, mapObjects);
    }
    $: firer = ships.find((s) => s.id === firerId);
    $: targetShip = ships.find((s) => s.id === targetId);
    $: targetFighter = fighters.find((f) => f.id === targetId);
    $: targetOrdnance = ordnance.find((o) => o.id === targetId);
    $: pdsTarget = targetFighter ?? targetOrdnance;

    $: if (autoScreens && targetShip) {
        const systems = (targetShip.object as { systems?: { name?: string; type?: string; level?: number }[] })
            ?.systems;
        screens = screenLevelFromSystems(Array.isArray(systems) ? systems : []);
    }

    $: range =
        firer?.position && targetShip?.position
            ? distance(
                  firer.position as { x: number; y: number },
                  targetShip.position as { x: number; y: number }
              )
            : firer?.position &&
                pdsTarget?.position &&
                typeof pdsTarget.position === "object" &&
                "x" in pdsTarget.position
              ? distance(
                    firer.position as { x: number; y: number },
                    pdsTarget.position as { x: number; y: number }
                )
              : 0;
    $: arc =
        firer?.position && targetShip?.position
            ? bearingArc(
                  firer.position as { x: number; y: number },
                  firer.facing as ClockFacing,
                  targetShip.position as { x: number; y: number }
              )
            : undefined;
    $: pool =
        mode === "beam" || mode === "plasma" || mode === "sap" || mode === "ap"
            ? beamDicePool(beamClass, range)
            : mode === "pds"
              ? pdsDice
              : 1;

    const shipSystems = (ship: (typeof ships)[number] | undefined): string[] => {
        const raw = (ship?.object as { systems?: { id?: string; name?: string }[] })?.systems;
        if (!Array.isArray(raw)) return [];
        return raw
            .map((s) => s.id ?? s.name)
            .filter((x): x is string => typeof x === "string" && x.length > 0);
    };

    $: firerSystemIds = shipSystems(firer);

    const pushDamage = (
        cmds: FullThrustGameCommand[],
        shipId: string,
        ship: (typeof ships)[number],
        normal: number,
        penetrating: number,
        type: DamageType
    ) => {
        pushHullDamageCommands(cmds, shipId, ship as never, normal, penetrating, type);
    };

    const fire = () => {
        if (!firer || !weaponId) {
            toast.push("Select firer and weapon id");
            return;
        }
        if (mode === "pds") {
            if (!pdsTarget) {
                toast.push("Select fighter or ordnance target for PDS");
                return;
            }
        } else if (!targetShip) {
            toast.push("Select target ship");
            return;
        }

        const meta = $currentState.meta ?? $gameMeta;
        const cmds: FullThrustGameCommand[] = [];
        const forceMaster = ($userSettings.role ?? "player") === "moderator";
        const diceSource = diceOverride.trim() ? "moderatorSequence" : "client";

        let source;
        try {
            source = diceOverride.trim()
                ? arrayRollSource(parseDiceString(diceOverride))
                : policyRollSource(meta.dicePolicy, { seed: meta.diceSeed });
        } catch (e) {
            toast.push(e instanceof Error ? e.message : "Dice error");
            return;
        }

        const mark = source.mark();
        try {
            if (mode === "pds") {
                const pds = resolvePdsPool(source, pdsDice);
                const consumed = source.consumedSince(mark);
                const before = targetFighter ? Number(targetFighter.number ?? 6) || 0 : undefined;
                const after =
                    before !== undefined ? Math.max(0, before - pds.kills) : undefined;
                const resultNotes = formatPdsResultNotes(
                    pds.kills,
                    targetFighter ? "fighters" : targetOrdnance ? "ordnance" : undefined,
                    before,
                    after
                );
                const summary = `${firerId} → ${targetId}: ${resultNotes}`;
                cmds.push(
                    makeLogDice({
                        purpose: `pds ${firerId}→${targetId}`,
                        rolls: consumed,
                        source: diceSource,
                        context: weaponId,
                        result: resultNotes,
                    })
                );
                cmds.push({
                    name: "fireWeapon",
                    ship: firerId,
                    weapon: weaponId,
                    target: targetId,
                    rolls: consumed,
                    notes: summary,
                } as FullThrustGameCommand);

                if (targetFighter) {
                    const afterFighters = after ?? 0;
                    cmds.push({
                        name: "adjustFighters",
                        id: targetId,
                        number: afterFighters,
                    } as FullThrustGameCommand);
                    if (afterFighters === 0) {
                        cmds.push({
                            name: "objDestroy",
                            uuid: targetId,
                        } as FullThrustGameCommand);
                    }
                } else if (targetOrdnance && pds.kills > 0) {
                    cmds.push({
                        name: "objDestroy",
                        uuid: targetId,
                    } as FullThrustGameCommand);
                }
            } else if (mode === "needle") {
                const roll = source.next();
                const consumed = source.consumedSince(mark);
                const resultNotes = formatNeedleResultNotes(roll, needleSystemId || undefined);
                const summary = `${firerId} → ${targetId}: ${resultNotes}`;
                cmds.push(
                    makeLogDice({
                        purpose: `needle ${firerId}→${targetId}`,
                        rolls: consumed,
                        source: diceSource,
                        context: weaponId,
                        result: resultNotes,
                    })
                );
                cmds.push({
                    name: "fireWeapon",
                    ship: firerId,
                    weapon: weaponId,
                    target: targetId,
                    rolls: consumed,
                    notes: summary,
                } as FullThrustGameCommand);
                if (roll === 6 && needleSystemId) {
                    cmds.push({
                        name: "sysDisable",
                        ship: targetId,
                        system: needleSystemId,
                        state: "destroyed",
                    } as FullThrustGameCommand);
                } else {
                    cmds.push({
                        name: "_custom",
                        msg: `Needle miss/no destroy (rolled ${roll}; need 6 to destroy ${needleSystemId || "system"})`,
                    } as FullThrustGameCommand);
                }
            } else {
                const resolution = resolveBeamAttack(
                    {
                        beamClass,
                        rangeMu: range,
                        screens: (mode === "sap" || mode === "ap" ? 0 : screens) as ScreenLevel,
                    },
                    source
                );
                const consumed = source.consumedSince(mark);
                const dmgType: DamageType =
                    mode === "sap" ? "SAP" : mode === "ap" ? "AP" : "standard";
                const normal =
                    mode === "sap" || mode === "ap"
                        ? resolution.totalDamage
                        : resolution.normalDamage;
                const penetrating =
                    mode === "sap" || mode === "ap" ? 0 : resolution.penetratingDamage;
                const applied =
                    targetShip && resolution.totalDamage > 0
                        ? computeShipDamageApplication(
                              targetShip as never,
                              normal,
                              penetrating,
                              dmgType
                          )
                        : null;
                const resultNotes = formatAppliedDamage(resolution.totalDamage, applied);
                const summary = `${firerId} → ${targetId}: ${resultNotes}`;
                cmds.push(
                    makeLogDice({
                        purpose: `${mode}-${beamClass} ${firerId}→${targetId}`,
                        rolls: consumed,
                        source: diceSource,
                        context: weaponId,
                        result: resultNotes,
                    })
                );
                cmds.push({
                    name: "fireWeapon",
                    ship: firerId,
                    weapon: weaponId,
                    target: targetId,
                    rolls: consumed,
                    damage: resolution.totalDamage,
                    notes: summary,
                } as FullThrustGameCommand);
                if (targetShip && resolution.totalDamage > 0) {
                    pushDamage(cmds, targetId, targetShip, normal, penetrating, dmgType);
                }
            }
        } catch (e) {
            if (e instanceof InsufficientDiceError) {
                toast.push(
                    "Not enough dice — paste a longer sequence or clear override to auto-roll."
                );
            } else {
                toast.push(e instanceof Error ? e.message : "Fire resolution failed");
            }
            return;
        }

        const dest = appendGameCommands(cmds, forceMaster);
        toast.push(
            dest === "master"
                ? `Fire resolved (${cmds.length} commands)`
                : `Fire declaration added to proposals (${cmds.length} cmds)`
        );
        dispatch("done");
    };
</script>

<p class="help mb-2">
    Moderator ad-hoc fire resolution — pick mode and targets manually (corrections / phase 9 PDS).
</p>

<div class="field">
    <label class="label">Mode</label>
    <label class="radio"><input type="radio" bind:group={mode} value="beam" /> Beam</label>
    <label class="radio"><input type="radio" bind:group={mode} value="pds" /> PDS</label>
    <label class="radio"><input type="radio" bind:group={mode} value="plasma" /> Plasma</label>
    <label class="radio"><input type="radio" bind:group={mode} value="sap" /> SAP (graser)</label>
    <label class="radio"><input type="radio" bind:group={mode} value="ap" /> AP (K-gun)</label>
    <label class="radio"><input type="radio" bind:group={mode} value="needle" /> Needle</label>
</div>

<div class="field">
    <label class="label" for="firer">Firing ship</label>
    <div class="select">
        <select id="firer" bind:value={firerId}>
            <option value="">--</option>
            {#each ships as s}
                <option value={s.id}>{s.id}</option>
            {/each}
        </select>
    </div>
</div>
<div class="field">
    <label class="label" for="weapon">Weapon system id</label>
    {#if firerSystemIds.length}
        <div class="select is-fullwidth">
            <select id="weapon" bind:value={weaponId}>
                <option value="">-- pick or type below --</option>
                {#each firerSystemIds as sid}
                    <option value={sid}>{sid}</option>
                {/each}
            </select>
        </div>
    {/if}
    <input class="input mt-1" bind:value={weaponId} placeholder="system id" />
</div>

{#if mode === "pds"}
    <div class="field">
        <label class="label" for="pdTarget">Target fighters / ordnance / ship</label>
        <div class="select">
            <select id="pdTarget" bind:value={targetId}>
                <option value="">--</option>
                {#each fighters as f}
                    <option value={f.id}>fighters {f.id} (n={f.number ?? 6})</option>
                {/each}
                {#each ordnance as o}
                    <option value={o.id}>ordnance {o.id} ({o.type})</option>
                {/each}
                {#each allShips as s}
                    <option value={s.id}>ship {s.id}</option>
                {/each}
            </select>
        </div>
    </div>
    <div class="field">
        <label class="label" for="pdsDice">PDS dice</label>
        <input id="pdsDice" class="input" type="number" min="1" max="12" bind:value={pdsDice} />
    </div>
{:else}
    <div class="field">
        <label class="label" for="target">Target ship</label>
        <div class="select">
            <select id="target" bind:value={targetId}>
                <option value="">--</option>
                {#each allShips as s}
                    <option value={s.id}>{s.id}</option>
                {/each}
            </select>
        </div>
    </div>
{/if}

{#if mode === "beam" || mode === "plasma" || mode === "sap" || mode === "ap"}
    <div class="field">
        <label class="label" for="bc">Class / dice at band 1</label>
        <input id="bc" class="input" type="number" min="1" max="5" bind:value={beamClass} />
    </div>
{/if}

{#if mode === "beam" || mode === "plasma"}
    <div class="field">
        <label class="checkbox">
            <input type="checkbox" bind:checked={autoScreens} /> Auto screens from SSD
        </label>
    </div>
    <div class="field">
        <label class="label" for="scr">Target screens</label>
        <div class="select">
            <select id="scr" bind:value={screens} disabled={autoScreens}>
                <option value={0}>0</option>
                <option value={1}>1</option>
                <option value={2}>2</option>
            </select>
        </div>
    </div>
{/if}

{#if mode === "needle"}
    <div class="field">
        <label class="label" for="needleSys">Target system id (destroyed on 6)</label>
        <input id="needleSys" class="input" bind:value={needleSystemId} />
    </div>
{/if}

{#if firer && (targetShip || pdsTarget)}
    <p class="help">
        Range {range.toFixed(2)} MU
        {#if arc}· Arc {arc}{/if}
        · Dice pool {pool}
    </p>
{/if}

<div class="field">
    <label class="label" for="dice">Dice override (optional)</label>
    <input
        id="dice"
        class="input"
        bind:value={diceOverride}
        placeholder="Leave empty to auto-roll on demand"
    />
</div>

<button class="button is-primary" on:click={fire}>Resolve fire</button>
