<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { currentState } from "@/stores/derivedState";
    import { gameMeta } from "@/stores/writeGameMeta";
    import {
        resolveSalvoStrike,
        resolveHeavyMissile,
        resolveFighterStrike,
        resolveFighterStrikeFromRolls,
    } from "@/lib/game/ordnanceAttack";
    import {
        applyDamageToShip,
        applyAdvancedScreenReduction,
        normalizeArmourDamageTaken,
        normalizeArmourLayers,
        screenLevelFromSystems,
        type ScreenLevel,
    } from "@/lib/game/combat";
    import { createDiceFromPolicy, parseDiceString, policyRollSource } from "@/lib/game/dice";
    import {
        computeShipDamageApplication,
        pushAppliedHullDamageCommands,
    } from "@/lib/game/resolveCombat";
    import {
        formatFighterStrikeResultNotes,
        formatHeavyMissileResultNotes,
        formatSalvoResultNotes,
        makeLogDice,
    } from "@/lib/game/rollResults";
    import { appendGameCommands } from "@/lib/game/appendCommand";
    import type { FullThrustGameCommand } from "@/schemas/commands";
    import { toast } from "@zerodevx/svelte-toast";
    import { userSettings } from "@/stores/writeUserSettings";
    import { fighterGroupOptionLabel } from "@/lib/game/fighterLabel";
    import { commands } from "@/stores/writeCommands";
    import { headOffset } from "@/stores/writeHeadOffset";
    import { pdKillsFromPhase9Log } from "@/lib/game/incomingThreats";
    import { focusMapOnFightersId, focusMapOnOrdnanceId, focusMapOnShipId } from "@/lib/actMapInteraction";

    const dispatch = createEventDispatcher();

    type StrikeMode = "salvo" | "heavy" | "fighter";

    $: ships =
        $currentState.state?.objects?.filter((o) => o.objType === "ship" && o.position) ??
        [];
    $: fighters =
        $currentState.state?.objects?.filter((o) => o.objType === "fighters") ?? [];
    $: ordnance =
        $currentState.state?.objects?.filter((o) => o.objType === "ordnance") ?? [];

    let mode: StrikeMode = "salvo";
    let attackerId = "";
    let targetId = "";
    let pdKills = 0;
    let advancedScreens = 0;
    let diceOverride = "";
    let destroyAttacker = true;
    let prevTargetId = "";
    let prevAttackerId = "";

    $: mapObjects = ($currentState.state?.objects ?? []) as import("@/schemas/position").FullThrustGameObjects[];

    $: if (targetId && targetId !== prevTargetId) {
        prevTargetId = targetId;
        focusMapOnShipId(targetId, mapObjects);
    }
    $: if (attackerId && attackerId !== prevAttackerId) {
        prevAttackerId = attackerId;
        if (mode === "fighter") {
            focusMapOnFightersId(attackerId, mapObjects);
        } else {
            focusMapOnOrdnanceId(attackerId, mapObjects);
        }
    }
    $: target = ships.find((s) => s.id === targetId);
    $: fighter = fighters.find((f) => f.id === attackerId);
    $: ord = ordnance.find((o) => o.id === attackerId);
    $: turn = $currentState.meta?.turn ?? 1;
    $: visibleCommands = $commands.slice(0, Math.max(0, $commands.length - $headOffset));
    $: phase9PdKills = pdKillsFromPhase9Log(visibleCommands, turn);
    $: if (mode === "salvo" && attackerId && phase9PdKills[attackerId] != null) {
        pdKills = phase9PdKills[attackerId];
    }

    const applyHull = (
        cmds: FullThrustGameCommand[],
        sapTotal: number,
        screens: ScreenLevel,
        fighterNormal = 0,
        fighterPen = 0
    ) => {
        if (!target) return null;
        const hull = (target.object as { hull?: { points?: number; rows?: number } })?.hull;
        const hullBoxes = hull?.points ?? 12;
        const rows = hull?.rows ?? 3;
        const dmgBefore = Number(target.dmgHull ?? 0) || 0;
        const armourSrc = (
            target.object as { armour?: unknown }
        )?.armour;
        const armourLayers = normalizeArmourLayers(armourSrc);
        const already = Array.isArray(target.dmgArmour)
            ? target.dmgArmour.map(normalizeArmourDamageTaken)
            : [];

        if (mode === "fighter") {
            const applied = applyDamageToShip(
                armourLayers,
                already,
                Math.max(0, hullBoxes - dmgBefore),
                fighterNormal,
                "standard",
                fighterPen
            );
            pushAppliedHullDamageCommands(cmds, targetId, target, applied);
            return applied;
        }

        const reduced =
            advancedScreens > 0
                ? applyAdvancedScreenReduction([sapTotal], advancedScreens as 0 | 1 | 2)[0]
                : sapTotal;
        const applied = applyDamageToShip(
            armourLayers,
            already,
            Math.max(0, hullBoxes - dmgBefore),
            reduced,
            "SAP",
            0
        );
        void screens;
        pushAppliedHullDamageCommands(cmds, targetId, target, applied);
        return applied;
    };

    const resolve = () => {
        if (!target) {
            toast.push("Select target ship");
            return;
        }
        if (mode === "fighter" && !fighter) {
            toast.push("Select attacking fighter group");
            return;
        }
        if ((mode === "salvo" || mode === "heavy") && !ord && !attackerId) {
            toast.push("Select attacking ordnance (or leave blank for abstract salvo)");
        }

        const meta = $currentState.meta ?? $gameMeta;
        let rolls: number[];
        try {
            if (diceOverride.trim()) rolls = parseDiceString(diceOverride);
            else {
                rolls = createDiceFromPolicy(meta.dicePolicy, {
                    seed: meta.diceSeed,
                }).roll(24).rolls;
            }
        } catch (e) {
            toast.push(e instanceof Error ? e.message : "Dice error");
            return;
        }

        const cmds: FullThrustGameCommand[] = [];
        const systems = (target.object as { systems?: { name?: string; type?: string; level?: number }[] })
            ?.systems;
        const screens = screenLevelFromSystems(Array.isArray(systems) ? systems : []);

        if (mode === "salvo") {
            const attackRoll = rolls[0];
            const sapNeeded = Math.max(0, Math.min(6, attackRoll) - pdKills);
            const sapRolls = rolls.slice(1, 1 + sapNeeded);
            const result = resolveSalvoStrike(attackRoll, pdKills, sapRolls);
            const appliedPreview = target
                ? computeShipDamageApplication(target as never, result.totalSap, 0, "SAP")
                : null;
            const resultNotes = formatSalvoResultNotes(result, appliedPreview);
            cmds.push(
                makeLogDice({
                    purpose: `salvo→${targetId}`,
                    rolls: [attackRoll, ...result.damageDice],
                    source: diceOverride.trim() ? "moderatorSequence" : "client",
                    result: resultNotes,
                })
            );
            cmds.push({
                name: "_custom",
                msg: `Salvo: ${resultNotes}`,
            } as FullThrustGameCommand);
            applyHull(cmds, result.totalSap, screens);
        } else if (mode === "heavy") {
            const result = resolveHeavyMissile(rolls.slice(0, 3));
            const reducedDice = applyAdvancedScreenReduction(
                result.damageDice,
                advancedScreens as 0 | 1 | 2
            );
            const total = reducedDice.reduce((a, b) => a + b, 0);
            const appliedPreview = target
                ? computeShipDamageApplication(target as never, total, 0, "SAP")
                : null;
            const resultNotes = formatHeavyMissileResultNotes(
                result.damageDice,
                total,
                appliedPreview
            );
            cmds.push(
                makeLogDice({
                    purpose: `heavyMissile→${targetId}`,
                    rolls: result.damageDice,
                    source: diceOverride.trim() ? "moderatorSequence" : "client",
                    result: resultNotes,
                })
            );
            cmds.push({
                name: "_custom",
                msg: `Heavy missile: ${resultNotes}`,
            } as FullThrustGameCommand);
            applyHull(cmds, total, screens);
        } else {
            const n = Number(fighter?.number ?? 6) || 0;
            let result;
            let strikeRolls: number[];
            if (diceOverride.trim()) {
                strikeRolls = parseDiceString(diceOverride);
                result = resolveFighterStrikeFromRolls(n, screens as ScreenLevel, strikeRolls);
            } else {
                const strikeSource = policyRollSource(meta.dicePolicy, { seed: meta.diceSeed });
                result = resolveFighterStrike(n, screens as ScreenLevel, strikeSource);
                strikeRolls = strikeSource.consumed();
            }
            const appliedPreview =
                target && result.totalDamage > 0
                    ? computeShipDamageApplication(
                          target as never,
                          result.normalDamage,
                          result.penetratingDamage,
                          "standard"
                      )
                    : null;
            const resultNotes = formatFighterStrikeResultNotes(result, appliedPreview);
            cmds.push(
                makeLogDice({
                    purpose: `fighterStrike ${attackerId}→${targetId}`,
                    rolls: strikeRolls,
                    source: diceOverride.trim() ? "moderatorSequence" : "client",
                    result: resultNotes,
                })
            );
            cmds.push({
                name: "_custom",
                msg: `Fighter strike: ${resultNotes}`,
            } as FullThrustGameCommand);
            applyHull(cmds, 0, screens, result.normalDamage, result.penetratingDamage);
            if (fighter) {
                cmds.push({
                    name: "adjustFighters",
                    id: attackerId,
                    endurance: Math.max(0, (fighter.endurance ?? 6) - 1),
                } as FullThrustGameCommand);
            }
        }

        if (destroyAttacker && ord) {
            cmds.push({ name: "objDestroy", uuid: attackerId } as FullThrustGameCommand);
        }

        const dest = appendGameCommands(
            cmds,
            ($userSettings.role ?? "player") === "moderator"
        );
        toast.push(dest === "master" ? "Strike resolved" : "Strike added to proposals");
        dispatch("done");
    };
</script>

<div class="field">
    <label class="label">Attack type</label>
    <label class="radio"><input type="radio" bind:group={mode} value="salvo" /> Salvo</label>
    <label class="radio"><input type="radio" bind:group={mode} value="heavy" /> Heavy missile</label>
    <label class="radio"><input type="radio" bind:group={mode} value="fighter" /> Fighter strike</label>
</div>

{#if mode === "fighter"}
    <div class="field">
        <label class="label" for="attF">Attacking fighters</label>
        <div class="select">
            <select id="attF" bind:value={attackerId}>
                <option value="">--</option>
                {#each fighters as f}
                    <option value={f.id}>{fighterGroupOptionLabel(f)}</option>
                {/each}
            </select>
        </div>
    </div>
{:else}
    <div class="field">
        <label class="label" for="attO">Attacking ordnance (optional)</label>
        <div class="select">
            <select id="attO" bind:value={attackerId}>
                <option value="">-- abstract --</option>
                {#each ordnance as o}
                    <option value={o.id}>{o.id} ({o.type})</option>
                {/each}
            </select>
        </div>
    </div>
    <label class="checkbox mb-2">
        <input type="checkbox" bind:checked={destroyAttacker} /> Destroy ordnance after strike
    </label>
{/if}

<div class="field">
    <label class="label" for="tgt">Target ship</label>
    <div class="select">
        <select id="tgt" bind:value={targetId}>
            <option value="">--</option>
            {#each ships as s}
                <option value={s.id}>{s.id}</option>
            {/each}
        </select>
    </div>
</div>

{#if mode === "salvo"}
    <div class="field">
        <label class="label" for="pd">PD kills already applied</label>
        <input id="pd" class="input" type="number" min="0" max="6" bind:value={pdKills} />
    </div>
{/if}

{#if mode !== "fighter"}
    <div class="field">
        <label class="label" for="adv">Advanced screens on target</label>
        <div class="select">
            <select id="adv" bind:value={advancedScreens}>
                <option value={0}>0</option>
                <option value={1}>1 (−1/die)</option>
                <option value={2}>2 (−2/die)</option>
            </select>
        </div>
    </div>
{/if}

<div class="field">
    <label class="label" for="dice">Dice override</label>
    <input id="dice" class="input" bind:value={diceOverride} placeholder="Leave empty to auto-roll on demand" />
</div>

<button class="button is-primary" on:click={resolve}>Resolve strike</button>
