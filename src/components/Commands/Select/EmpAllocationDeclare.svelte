<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { currentState } from "@/stores/derivedState";
    import { commands } from "@/stores/writeCommands";
    import { headOffset } from "@/stores/writeHeadOffset";
    import { gameMeta } from "@/stores/writeGameMeta";
    import { initialState } from "@/stores/writeInitialState";
    import { appendGameCommand } from "@/lib/game/appendCommand";
    import { validateDeclareEmpAllocation } from "@/lib/game/commandValidation";
    import {
        empContributorKey,
        empValidTargets,
        declaredEmpContributorKeys,
        type BankedEmpState,
    } from "@/lib/game/empFire";
    import { commandsInCurrentPhaseSegment } from "@/lib/game/moderatorStatus";
    import type { FullThrustGameCommand } from "@/schemas/commands";
    import type { FullThrustGameObjects } from "@/schemas/position";
    import { toast } from "@zerodevx/svelte-toast";
    import { userSettings } from "@/stores/writeUserSettings";
    import ActError from "./ActError.svelte";
    import RenderSsd from "@/components/RenderSSD.svelte";
    import { buildShipRenderOpts } from "@/lib/ssdRenderOpts";
    import { focusMapOnShipId } from "@/lib/actMapInteraction";

    const dispatch = createEventDispatcher();

    let selectedKey = "";
    let prevKey = "";
    let hitBySystem: Record<string, number> = {};

    $: ships =
        ($currentState.state?.objects?.filter((o) => o.objType === "ship") ??
            []) as FullThrustGameObjects[];
    $: banked = ($currentState.bankedEmpHits ?? {}) as BankedEmpState;
    $: playerId = $userSettings.playerId ?? "";
    $: visibleCommands = $commands.slice(0, Math.max(0, $commands.length - $headOffset));
    $: phaseCommands =
        $currentState.state && $currentState.meta
            ? commandsInCurrentPhaseSegment(
                  visibleCommands,
                  { turn: $currentState.meta.turn, phase: 13 },
                  $gameMeta,
                  $initialState
              )
            : [];

    $: slots = (() => {
        const out: {
            key: string;
            targetShip: string;
            firerShip: string;
            weapon: string;
            hits: number;
            declared: boolean;
        }[] = [];
        for (const [targetShip, entry] of Object.entries(banked)) {
            const declared = declaredEmpContributorKeys(targetShip, phaseCommands);
            for (const c of entry.contributors) {
                const firer = ships.find((s) => s.id === c.shipId);
                if (playerId && firer?.owner !== playerId) continue;
                const key = `${targetShip}|${c.shipId}|${c.weaponId}`;
                out.push({
                    key,
                    targetShip,
                    firerShip: c.shipId,
                    weapon: c.weaponId,
                    hits: c.hits,
                    declared: declared.has(empContributorKey(c.shipId, c.weaponId)),
                });
            }
        }
        return out;
    })();

    $: if (slots.length && !selectedKey) {
        selectedKey = slots.find((s) => !s.declared)?.key ?? slots[0].key;
    }

    $: slot = slots.find((s) => s.key === selectedKey);
    $: target = slot ? ships.find((s) => s.id === slot.targetShip) : undefined;
    $: empTargets = target ? empValidTargets(target) : [];
    $: shipJson = target ? JSON.stringify(target.object) : "";
    $: renderOpts = target ? buildShipRenderOpts(target) : { minimal: true };

    $: if (selectedKey && selectedKey !== prevKey) {
        prevKey = selectedKey;
        if (slot) focusMapOnShipId(slot.targetShip, ships);
    }

    $: if (slot && empTargets.length) {
        const next: Record<string, number> = {};
        for (const t of empTargets) {
            next[t.id] = hitBySystem[t.id] ?? 0;
        }
        hitBySystem = next;
    }

    $: allocatedHits = Object.values(hitBySystem).reduce((a, b) => a + (Number(b) || 0), 0);
    $: hitsRemaining = (slot?.hits ?? 0) - allocatedHits;

    $: draftCmd = slot
        ? ({
              name: "declareEmpAllocation",
              targetShip: slot.targetShip,
              firerShip: slot.firerShip,
              weapon: slot.weapon,
              allocations: empTargets
                  .filter((t) => (hitBySystem[t.id] ?? 0) > 0)
                  .map((t) => ({ systemId: t.id, hitCount: hitBySystem[t.id] })),
          } as FullThrustGameCommand)
        : null;

    $: foldStub = {
        meta: $currentState.meta ?? {
            phase: 13,
            turn: 1,
            version: "",
            name: "",
            createdAt: "",
            dicePolicy: "hybrid",
        },
        position: $currentState.state ?? { map: { mode: "fixed", width: 72, height: 48 } },
        bankedEmpHits: banked,
    };

    $: issues = draftCmd ? validateDeclareEmpAllocation(foldStub, draftCmd, phaseCommands) : [];

    const submit = () => {
        if (!draftCmd || !slot) return;
        if (slot.declared) {
            toast.push("Allocation already declared for this weapon — remove the log entry to change.");
            return;
        }
        const errors = issues.filter((i) => i.severity === "error");
        if (errors.length) {
            toast.push(errors[0].message);
            return;
        }
        appendGameCommand(draftCmd, true);
        toast.push(`EMP allocation recorded for ${slot.firerShip} → ${slot.targetShip}`);
        hitBySystem = {};
        selectedKey = "";
        dispatch("done");
    };
</script>

{#if slots.length === 0}
    <p class="help">No EMP hits to allocate for your ships this turn.</p>
{:else}
    <div class="field">
        <label class="label" for="empSlot">Your EMP weapon</label>
        <div class="select is-fullwidth">
            <select id="empSlot" bind:value={selectedKey}>
                {#each slots as s}
                    <option value={s.key}
                        >{s.firerShip}/{s.weapon} → {s.targetShip} ({s.hits} hit{s.hits === 1 ? "" : "s"}){s.declared
                            ? " ✓"
                            : ""}</option
                    >
                {/each}
            </select>
        </div>
    </div>

    {#if slot && target}
        <p class="help mb-2">
            Assign exactly <strong>{slot.hits}</strong> hit(s) to valid systems on
            <strong>{slot.targetShip}</strong>.
            {#if hitsRemaining !== 0}
                <span class="has-text-warning"> — {hitsRemaining} unassigned</span>
            {/if}
        </p>

        <div class="emp-layout">
            <div class="emp-ssd">
                <RenderSsd json={shipJson} opts={renderOpts} />
            </div>
            <div class="emp-form">
                {#each empTargets as t}
                    <div class="field is-horizontal">
                        <div class="field-label is-normal">
                            <label class="label" for="hits-{t.id}">{t.label}</label>
                        </div>
                        <div class="field-body">
                            <div class="field">
                                <div class="control">
                                    <input
                                        id="hits-{t.id}"
                                        class="input"
                                        type="number"
                                        min="0"
                                        max={slot.hits}
                                        bind:value={hitBySystem[t.id]}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                {/each}
            </div>
        </div>

        {#if issues.length}
            <ActError issues={issues} />
        {/if}

        <button
            class="button is-primary"
            on:click={submit}
            disabled={!draftCmd || slot.declared || hitsRemaining !== 0}
        >
            Record EMP allocation
        </button>
    {/if}
{/if}

<style>
    .emp-layout {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        margin-bottom: 1rem;
    }
    .emp-ssd {
        flex: 1 1 200px;
        max-width: 320px;
    }
    .emp-form {
        flex: 1 1 220px;
    }
</style>
