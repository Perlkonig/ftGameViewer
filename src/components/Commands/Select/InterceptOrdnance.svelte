<script lang="ts">
    import { createEventDispatcher, onDestroy, onMount } from "svelte";
    import { currentState } from "@/stores/derivedState";
    import { gameMeta } from "@/stores/writeGameMeta";
    import { clickMode } from "@/stores/writeClickMode";
    import { selectedObject } from "@/stores/writeSelectedObject";
    import { appendGameCommands } from "@/lib/game/appendCommand";
    import { toast } from "@zerodevx/svelte-toast";
    import { userSettings } from "@/stores/writeUserSettings";
    import { fighterGroupOptionLabel } from "@/lib/game/fighterLabel";
    import { isDeployedFighter } from "@/lib/game/fighterMove";
    import {
        enemyInterceptableOrdnance,
        resolveFighterIntercept,
        validateInterceptOrdnance,
    } from "@/lib/game/fighterIntercept";
    import { fighterCanIntercept, fighterEndurance } from "@/lib/game/fighterEndurance";
    import { parseDiceString, policyRollSource, arrayRollSource } from "@/lib/game/dice";
    import type { FullThrustGameCommand } from "@/schemas/commands";
    import { parseObjectRef } from "@/lib/objectRef";
    import ActError from "./ActError.svelte";
    import { isSalvoOrdnanceType, salvoMissileCount } from "@/lib/game/salvoOrdnance";
    import { focusMapOnFightersId, focusMapOnOrdnanceId } from "@/lib/actMapInteraction";

    const dispatch = createEventDispatcher();

    let fighterId = "";
    let ordnanceId = "";
    let diceOverride = "";
    let prevFighterId = "";
    let prevOrdnanceId = "";

    $: mapObjects = ($currentState.state?.objects ?? []) as import("@/schemas/position").FullThrustGameObjects[];

    $: phase = $currentState.meta?.phase ?? 8;
    $: fighters =
        $currentState.state?.objects?.filter(
            (o) =>
                o.objType === "fighters" &&
                isDeployedFighter(o) &&
                fighterCanIntercept(o as { endurance?: number; type?: string })
        ) ?? [];
    $: selectedFighter = fighters.find((f) => f.id === fighterId);
    $: ordnanceOptions =
        selectedFighter && $currentState.state
            ? enemyInterceptableOrdnance($currentState.state, selectedFighter)
            : [];
    $: selectedOrd = ordnanceOptions.find((o) => o.id === ordnanceId);

    $: validationIssues =
        fighterId && ordnanceId && $currentState.state
            ? validateInterceptOrdnance($currentState.state, fighterId, ordnanceId, phase)
            : [];

    $: canSubmit =
        !!fighterId &&
        !!ordnanceId &&
        !!selectedOrd &&
        !validationIssues.some((i) => i.severity === "error");

    $: if (fighterId && fighterId !== prevFighterId) {
        prevFighterId = fighterId;
        focusMapOnFightersId(fighterId, mapObjects);
    }
    $: if (ordnanceId && ordnanceId !== prevOrdnanceId) {
        prevOrdnanceId = ordnanceId;
        focusMapOnOrdnanceId(ordnanceId, mapObjects);
    }

    const helpForType = (type: string | undefined): string => {
        switch (type) {
            case "salvo":
            case "salvoER":
            case "salvoMS":
                return "Salvo: each fighter rolls 5–6 to kill one missile (6 rerolls); danger d6 per kill (6 loses one interceptor).";
            case "rocket":
            case "missile":
                return "Heavy/rocket: each fighter needs a 6 to kill; danger d6 per kill (6 loses one interceptor).";
            case "amt":
                return "AMT: PDS-style rolls per fighter; each hit reduces warhead strength and blast radius; 3 hits disrupts.";
            case "plasmaBolt":
                return "Plasma bolt: PDS-style hits; beam class hits required to destroy.";
            default:
                return "Select enemy ordnance to intercept.";
        }
    };

    onMount(() => {
        clickMode.set("select");
    });

    onDestroy(() => {
        clickMode.set("none");
    });

    $: if ($selectedObject && $clickMode === "select" && $currentState.state) {
        const ref = parseObjectRef($selectedObject);
        const obj = ref
            ? $currentState.state.objects?.find((o) => o.id === ref.objId)
            : undefined;
        if (obj?.objType === "ordnance" && ordnanceOptions.some((o) => o.id === obj.id)) {
            ordnanceId = obj.id;
        }
    };

    const resolve = () => {
        if (!canSubmit || !selectedFighter || !selectedOrd) {
            toast.push("Select a fighter group and ordnance target");
            return;
        }
        for (const issue of validationIssues) {
            if (issue.severity === "warning") toast.push(issue.message);
        }
        const meta = $currentState.meta ?? $gameMeta;
        const count = selectedFighter.number ?? 6;
        let rolls: number[];
        try {
            if (diceOverride.trim()) {
                rolls = parseDiceString(diceOverride);
            } else {
                const source = policyRollSource(meta.dicePolicy, { seed: meta.diceSeed });
                resolveFighterIntercept(count, selectedOrd.type, selectedOrd, source);
                rolls = source.consumed();
            }
        } catch (e) {
            toast.push(e instanceof Error ? e.message : "Dice error");
            return;
        }
        const result = resolveFighterIntercept(
            count,
            selectedOrd.type,
            selectedOrd,
            arrayRollSource(rolls)
        );
        const note = result.notes.join("; ");
        const cmds: FullThrustGameCommand[] = [
            {
                name: "logDice",
                purpose: `intercept ${fighterId} vs ${ordnanceId}`,
                rolls: result.rolls,
                source: diceOverride.trim() ? "moderatorSequence" : "client",
                result: note,
            } as FullThrustGameCommand,
            {
                name: "interceptOrdnance",
                id: fighterId,
                ordnanceId,
                rolls: result.rolls,
            } as FullThrustGameCommand,
            {
                name: "_custom",
                msg: `Intercept: ${fighterId} vs ${ordnanceId} — ${note}`,
            } as FullThrustGameCommand,
        ];
        appendGameCommands(cmds, ($userSettings.role ?? "player") === "moderator");
        toast.push(note || "Intercept resolved");
        dispatch("done");
    };
</script>

<p class="help">
    Intercept enemy ordnance (typical: 6 MU, front 180° arc). Out-of-range or out-of-arc targets
    may still be selected — warnings are shown. Costs 1 CEF. Attack/torpedo fighters cannot intercept.
</p>

<div class="field">
    <label class="label" for="fighter">Interceptor group</label>
    <div class="select is-fullwidth">
        <select id="fighter" bind:value={fighterId}>
            <option value="">--</option>
            {#each fighters as f}
                <option value={f.id}>
                    {fighterGroupOptionLabel(f)} — CEF {fighterEndurance(f)}
                </option>
            {/each}
        </select>
    </div>
</div>

<div class="field">
    <label class="label" for="ord">Ordnance target</label>
    <div class="select is-fullwidth">
        <select id="ord" bind:value={ordnanceId}>
            <option value="">--</option>
            {#each ordnanceOptions as o}
                <option value={o.id}>
                    {o.id} ({o.type}{#if isSalvoOrdnanceType(o.type)} ×{salvoMissileCount(o)}{/if})
                </option>
            {/each}
        </select>
    </div>
    <p class="help">Click any enemy ordnance on the map to select; warnings appear if out of range or arc.</p>
</div>

{#if selectedOrd}
    <p class="help">{helpForType(selectedOrd.type)}</p>
{/if}

<ActError issues={validationIssues} />

<div class="field">
    <label class="label" for="dice">Dice override</label>
    <input id="dice" class="input" bind:value={diceOverride} placeholder="Leave empty to auto-roll" />
</div>

<button class="button is-primary" on:click={resolve} disabled={!canSubmit}>Resolve intercept</button>
