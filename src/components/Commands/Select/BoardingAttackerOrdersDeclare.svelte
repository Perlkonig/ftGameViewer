<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { currentState } from "@/stores/derivedState";
    import { commands } from "@/stores/writeCommands";
    import { headOffset } from "@/stores/writeHeadOffset";
    import { gameMeta } from "@/stores/writeGameMeta";
    import { initialState } from "@/stores/writeInitialState";
    import { appendGameCommands } from "@/lib/game/appendCommand";
    import { validateDeclareBoardingAttackerOrdersCommand } from "@/lib/game/commandValidation";
    import { BOARDING_STEP_LABELS } from "@/lib/game/boardingOrders";
    import {
        attackerOwnersOnShip,
        boarderUnitsOnShip,
        contestedShipsForPhase12,
        totalBoardersOnShip,
        type ShipWithBoarders,
    } from "@/lib/game/boardingState";
    import {
        encodeAttackerBoardingNotes,
        decodeAttackerBoardingNotes,
        type UnitAllocation,
    } from "@/lib/game/boardingOrders";
    import {
        attackerOrderForOwner,
        attackerOrdersCompleteForShip,
    } from "@/lib/game/segmentApply";
    import { commandsInCurrentPhaseSegment } from "@/lib/game/moderatorStatus";
    import type { GamePhase } from "@/lib/game/types";
    import { buildShipRenderOpts } from "@/lib/ssdRenderOpts";
    import type { FullThrustGameCommand } from "@/schemas/commands";
    import type { FullThrustGameObjects } from "@/schemas/position";
    import RenderSsd from "@/components/RenderSSD.svelte";
    import { toast } from "@zerodevx/svelte-toast";
    import { userSettings } from "@/stores/writeUserSettings";
    import { focusMapOnShipId } from "@/lib/actMapInteraction";

    const dispatch = createEventDispatcher();

    let defenderShipId = "";
    let prevDefenderShipId = "";
    let attackerOwner = "";
    let prevLoadKey = "";
    let allocByUnit: Record<string, "kill" | "raze"> = {};

    let shipJson = "";
    let renderOpts: import("ftlibship").RenderOpts = { minimal: true };

    $: ships =
        ($currentState.state?.objects?.filter((o) => o.objType === "ship") ??
            []) as FullThrustGameObjects[];
    $: contestedIds = contestedShipsForPhase12(
        $currentState.state ?? { map: { mode: "fixed", width: 72, height: 48 } }
    );
    $: contestedShips = ships.filter((s) => contestedIds.includes(s.id));
    $: phase = ($currentState.meta?.phase ?? 12) as GamePhase;
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
    $: pendingBoarding = $currentState.pendingBoardingOrders ?? [];
    $: if (defenderShipId && defenderShipId !== prevDefenderShipId) {
        prevDefenderShipId = defenderShipId;
        focusMapOnShipId(defenderShipId, ships);
    }
    $: defender = ships.find((s) => s.id === defenderShipId) as
        | (FullThrustGameObjects & ShipWithBoarders)
        | undefined;
    $: boarderUnits = defender ? boarderUnitsOnShip(defender) : [];
    $: attackerOwners = defender ? attackerOwnersOnShip(defender) : [];
    $: if (attackerOwners.length && !attackerOwner) {
        attackerOwner = attackerOwners[0];
    }
    $: aboardCounts = defender && attackerOwner
        ? totalBoardersOnShip(defender, attackerOwner)
        : { dcp: 0, marines: 0 };
    $: attackerUnits = boarderUnits.filter((u) => u.owner === attackerOwner);

    $: if (defender) {
        shipJson = JSON.stringify(defender.object);
        renderOpts = buildShipRenderOpts(defender);
    }

    $: foldStub = {
        meta: $currentState.meta ?? {
            phase: 12,
            turn: 1,
            version: "",
            name: "",
            createdAt: "",
            dicePolicy: "hybrid",
        },
        position: $currentState.state ?? { map: { mode: "fixed", width: 72, height: 48 } },
        pendingBoardingOrders: $currentState.pendingBoardingOrders,
    };

    const shipComplete = (shipId: string): boolean =>
        attackerOrdersCompleteForShip(foldStub.position, shipId, phaseCommands, pendingBoarding);

    const contestedShipLabel = (shipId: string, owner?: string): string => {
        const ownerPart = owner ? ` (${owner})` : "";
        return `${shipId}${ownerPart}${shipComplete(shipId) ? " ✓" : ""}`;
    };

    $: loadKey = `${defenderShipId}:${attackerOwner}`;
    $: if (loadKey && loadKey !== prevLoadKey) {
        prevLoadKey = loadKey;
        const existing = attackerOrderForOwner(
            defenderShipId,
            attackerOwner,
            phaseCommands,
            pendingBoarding
        );
        if (existing) {
            const notes = decodeAttackerBoardingNotes((existing as { notes?: string }).notes);
            const nextAlloc = { ...allocByUnit };
            for (const alloc of notes?.unitAllocations ?? []) {
                nextAlloc[alloc.unitId] = alloc.allocation;
            }
            allocByUnit = nextAlloc;
        }
    }

    $: attackerAlreadyDeclared =
        defenderShipId && attackerOwner
            ? Boolean(
                  attackerOrderForOwner(
                      defenderShipId,
                      attackerOwner,
                      phaseCommands,
                      pendingBoarding
                  )
              )
            : false;

    $: if (boarderUnits.length) {
        const nextAlloc = { ...allocByUnit };
        for (const u of boarderUnits) {
            if (nextAlloc[u.id] === undefined) nextAlloc[u.id] = "kill";
        }
        allocByUnit = nextAlloc;
    }

    const setAlloc = (unitId: string, value: "kill" | "raze") => {
        allocByUnit = { ...allocByUnit, [unitId]: value };
    };

    const buildAttackerCmd = (): FullThrustGameCommand | null => {
        if (!defenderShipId || !attackerOwner) return null;
        const unitAllocations: UnitAllocation[] = attackerUnits.map((u) => ({
            unitId: u.id,
            allocation: allocByUnit[u.id] ?? "kill",
        }));
        return {
            name: "declareBoardingAttackerOrders",
            ship: defenderShipId,
            notes: encodeAttackerBoardingNotes({
                v: 2,
                attackerOwner,
                unitAllocations,
            }),
        } as FullThrustGameCommand;
    };

    const submit = () => {
        if (!defenderShipId) {
            toast.push("Select a contested ship");
            return;
        }
        if (attackerAlreadyDeclared) {
            toast.push(
                `${BOARDING_STEP_LABELS.attackerAllocation} for ${attackerOwner} on ${defenderShipId} is already in the log — remove the last entry to change it.`
            );
            return;
        }
        const cmd = buildAttackerCmd();
        if (!cmd) {
            toast.push("Nothing to declare");
            return;
        }
        const issues = validateDeclareBoardingAttackerOrdersCommand(
            foldStub,
            foldStub.position,
            cmd,
            phaseCommands
        ).filter((i) => i.severity === "error");
        if (issues.length) {
            toast.push(issues[0].message);
            return;
        }
        appendGameCommands([cmd], ($userSettings.role ?? "player") === "moderator");
        toast.push(`Attacker boarding orders recorded for ${defenderShipId}`);
        dispatch("done");
    };
</script>

<p class="help">
    {BOARDING_STEP_LABELS.attackerAllocation}: assign each of your boarder units <strong>kill</strong>
    (fight defender marines) or <strong>raze</strong> (hull damage if it survives).
    {BOARDING_STEP_LABELS.defenderAllocation} follows in the next step.
</p>

{#if contestedShips.length === 0}
    <p class="notification is-info">No ships have enemy boarders — advance phase.</p>
{:else}
    <div class="field">
        <label class="label" for="defShip">Contested defender ship</label>
        <div class="select is-fullwidth">
            <select id="defShip" bind:value={defenderShipId}>
                <option value="">--</option>
                {#each contestedShips as s}
                    <option value={s.id}
                        >{contestedShipLabel(
                            s.id,
                            typeof s.owner === "string" ? s.owner : undefined
                        )}</option
                    >
                {/each}
            </select>
        </div>
        <p class="help">✓ — all attacker orders declared for that ship.</p>
    </div>

    {#if defender}
        <div class="boarding-layout">
            <div class="boarding-ssd">
                <RenderSsd json={shipJson} opts={renderOpts} />
            </div>
            <div class="boarding-form">
                <div class="field">
                    <label class="label" for="attOwner">Attacking player</label>
                    <div class="select">
                        <select id="attOwner" bind:value={attackerOwner}>
                            {#each attackerOwners as owner}
                                <option value={owner}>{owner}</option>
                            {/each}
                        </select>
                    </div>
                </div>
                <p class="help">
                    Aboard for {attackerOwner}: {aboardCounts.dcp} DCP, {aboardCounts.marines} marines.
                </p>
                <table class="table is-narrow is-fullwidth">
                    <thead>
                        <tr>
                            <th>Unit</th>
                            <th>Type</th>
                            <th>Allocation</th>
                        </tr>
                    </thead>
                    <tbody>
                        {#each attackerUnits as u}
                            <tr>
                                <td>{u.id}</td>
                                <td>{u.type === "dcp" ? "DCP" : "Marine"}</td>
                                <td>
                                    <label class="radio">
                                        <input
                                            type="radio"
                                            name="alloc-{u.id}"
                                            value="kill"
                                            checked={(allocByUnit[u.id] ?? "kill") === "kill"}
                                            on:change={() => setAlloc(u.id, "kill")}
                                        />
                                        kill
                                    </label>
                                    <label class="radio ml-2">
                                        <input
                                            type="radio"
                                            name="alloc-{u.id}"
                                            value="raze"
                                            checked={allocByUnit[u.id] === "raze"}
                                            on:change={() => setAlloc(u.id, "raze")}
                                        />
                                        raze
                                    </label>
                                </td>
                            </tr>
                        {/each}
                    </tbody>
                </table>
                <button
                    class="button is-primary"
                    on:click={submit}
                    disabled={attackerAlreadyDeclared}
                >
                    {attackerAlreadyDeclared
                        ? `${BOARDING_STEP_LABELS.attackerAllocation} already declared`
                        : "Declare attacker allocation"}
                </button>
            </div>
        </div>
    {/if}
{/if}

<style>
    .boarding-layout {
        display: flex;
        gap: 1rem;
        align-items: flex-start;
    }
    .boarding-ssd {
        flex: 0 0 auto;
        max-width: 420px;
        overflow: auto;
    }
    .boarding-form {
        flex: 1;
        min-width: 0;
    }
</style>
