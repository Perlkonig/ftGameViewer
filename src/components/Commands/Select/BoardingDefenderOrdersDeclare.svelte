<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { currentState } from "@/stores/derivedState";
    import { commands } from "@/stores/writeCommands";
    import { headOffset } from "@/stores/writeHeadOffset";
    import { gameMeta } from "@/stores/writeGameMeta";
    import { initialState } from "@/stores/writeInitialState";
    import { appendGameCommands } from "@/lib/game/appendCommand";
    import { validateDeclareBoardingDefenderOrdersCommand, validateDefenderBoardingAllocations } from "@/lib/game/commandValidation";
    import { BOARDING_STEP_LABELS } from "@/lib/game/boardingOrders";
    import {
        boarderUnitsOnShip,
        contestedShipsForPhase12,
        type ShipWithBoarders,
    } from "@/lib/game/boardingState";
    import {
        encodeDefenderBoardingNotes,
        decodeAttackerBoardingNotes,
        type DcpRepelAssignment,
        type MarineFightAssignment,
    } from "@/lib/game/boardingOrders";
    import {
        attackerBoardingOrdersForShip,
        defenderOrdersCompleteForShip,
    } from "@/lib/game/segmentApply";
    import { commandsInCurrentPhaseSegment } from "@/lib/game/moderatorStatus";
    import type { GamePhase } from "@/lib/game/types";
    import { shipBoardingCrewCapacity } from "@/lib/game/shipSystems";
    import { availableMarineIds } from "@/lib/game/crewDeployment";
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
    let dcpByUnit: Record<string, number> = {};
    let marineByUnit: Record<string, string> = {};

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
    $: crew = defender ? shipBoardingCrewCapacity(defender) : { marines: 0, dcpPool: 0 };
    $: boarderUnits = defender ? boarderUnitsOnShip(defender) : [];
    $: defenderMarineOptions = defender ? availableMarineIds(defender) : [];

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

    const attackerAllocationForUnit = (unitId: string): string => {
        if (!defenderShipId) return "—";
        const orders = attackerBoardingOrdersForShip(
            defenderShipId,
            phaseCommands,
            pendingBoarding
        );
        for (const cmd of orders) {
            const notes = decodeAttackerBoardingNotes((cmd as { notes?: string }).notes);
            const alloc = notes?.unitAllocations?.find((a) => a.unitId === unitId);
            if (alloc) return alloc.allocation;
        }
        return "—";
    };

    const shipComplete = (shipId: string): boolean =>
        defenderOrdersCompleteForShip(shipId, phaseCommands, pendingBoarding);

    $: defenderAlreadyDeclared = defenderShipId
        ? defenderOrdersCompleteForShip(defenderShipId, phaseCommands, pendingBoarding)
        : false;

    $: boardingStep = ($currentState.meta?.boardingStep ?? "attacker") as "attacker" | "defender";

    const contestedShipLabel = (
        shipId: string,
        owner?: string,
        capture?: { by: string; resolved?: boolean }
    ): string => {
        const ownerPart = owner ? ` (${owner})` : "";
        const capturePart =
            capture && !capture.resolved ? ` — CAPTURED by ${capture.by}` : "";
        return `${shipId}${ownerPart}${capturePart}${shipComplete(shipId) ? " ✓" : ""}`;
    };

    $: if (boarderUnits.length) {
        const nextDcp = { ...dcpByUnit };
        const nextMar = { ...marineByUnit };
        for (const u of boarderUnits) {
            if (nextDcp[u.id] === undefined) nextDcp[u.id] = 0;
            if (nextMar[u.id] === undefined) nextMar[u.id] = "";
        }
        dcpByUnit = nextDcp;
        marineByUnit = nextMar;
    }

    const setDcp = (unitId: string, value: number) => {
        dcpByUnit = { ...dcpByUnit, [unitId]: value };
    };
    const setMarine = (unitId: string, value: string) => {
        marineByUnit = { ...marineByUnit, [unitId]: value };
    };

    $: totalDcp = Object.values(dcpByUnit).reduce(
        (sum, n) => sum + Math.max(0, Math.floor(n)),
        0
    );
    $: dcpOverAllocated = totalDcp > crew.dcpPool;
    $: allocationIssues = defender
        ? validateDefenderBoardingAllocations(defender, {
              dcpRepel: Object.entries(dcpByUnit)
                  .filter(([, n]) => n > 0)
                  .map(([boarderId, dcp]) => ({ boarderId, dcp })),
              marineFight: Object.entries(marineByUnit)
                  .filter(([, marineId]) => marineId)
                  .map(([boarderId, marineId]) => ({ boarderId, marineId })),
          })
        : [];
    $: allocationWarnings = allocationIssues.filter((i) => i.severity === "warning");

    const buildDefenderCmd = (): FullThrustGameCommand | null => {
        if (!defenderShipId) return null;
        const dcpRepel: DcpRepelAssignment[] = Object.entries(dcpByUnit)
            .filter(([, n]) => n > 0)
            .map(([boarderId, dcp]) => ({ boarderId, dcp }));
        const marineFight: MarineFightAssignment[] = Object.entries(marineByUnit)
            .filter(([, marineId]) => marineId)
            .map(([boarderId, marineId]) => ({ boarderId, marineId }));
        return {
            name: "declareBoardingDefenderOrders",
            ship: defenderShipId,
            notes: encodeDefenderBoardingNotes({
                v: 2,
                dcpRepel,
                marineFight,
            }),
        } as FullThrustGameCommand;
    };

    const submit = () => {
        if (!defenderShipId) {
            toast.push("Select a contested ship");
            return;
        }
        if (defenderAlreadyDeclared) {
            toast.push(
                `${BOARDING_STEP_LABELS.defenderAllocation} for ${defenderShipId} is already in the log — remove the last entry to change it.`
            );
            return;
        }
        const cmd = buildDefenderCmd();
        if (!cmd) {
            toast.push("Nothing to declare");
            return;
        }
        const issues = validateDeclareBoardingDefenderOrdersCommand(
            foldStub,
            foldStub.position,
            cmd,
            phaseCommands
        );
        const errors = issues.filter((i) => i.severity === "error");
        if (errors.length) {
            toast.push(errors[0].message);
            return;
        }
        for (const warning of issues.filter((i) => i.severity === "warning")) {
            toast.push(warning.message);
        }
        appendGameCommands([cmd], ($userSettings.role ?? "player") === "moderator");
        toast.push(`Defender boarding orders recorded for ${defenderShipId}`);
        dispatch("done");
    };
</script>

<p class="help">
    {BOARDING_STEP_LABELS.defenderAllocation}: assign DCP repel (roll ≤ count removes boarder) and
    marines (4+ kills assigned boarder) per unit. Attacker kill/raze allocations are shown
    read-only. Resolve runs {BOARDING_STEP_LABELS.dcpRepel}, {BOARDING_STEP_LABELS.resolveCombat},
    and {BOARDING_STEP_LABELS.raze}.
    {#if boardingStep !== "defender"}
        <strong>Moderator must click Next step after {BOARDING_STEP_LABELS.attackerAllocation} before defender declarations.</strong>
    {/if}
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
                            typeof s.owner === "string" ? s.owner : undefined,
                            (s as { boardingCapture?: { by: string; resolved?: boolean } })
                                .boardingCapture
                        )}</option
                    >
                {/each}
            </select>
        </div>
        <p class="help">✓ — defender orders declared for that ship.</p>
    </div>

    {#if defender}
        <div class="boarding-layout">
            <div class="boarding-ssd">
                <RenderSsd json={shipJson} opts={renderOpts} />
            </div>
            <div class="boarding-form">
                <p class="help">
                    Defender ({defender.owner}): pool {crew.dcpPool} DCP, {crew.marines} marines.
                    Wasted assignments are not reallocated.
                    {#if dcpOverAllocated}
                        <span class="has-text-warning">
                            — allocated {totalDcp} DCP (over pool; allowed with warning)
                        </span>
                    {/if}
                </p>
                {#if allocationWarnings.length > 0}
                    <div class="notification is-warning is-light py-2 px-3 mb-3" role="status">
                        <p class="has-text-weight-semibold mb-1">Allocation warnings</p>
                        <ul class="allocation-warnings">
                            {#each allocationWarnings as issue}
                                <li>{issue.message}</li>
                            {/each}
                        </ul>
                    </div>
                {/if}
                <table class="table is-narrow is-fullwidth">
                    <thead>
                        <tr>
                            <th>Unit</th>
                            <th>Type</th>
                            <th>Owner</th>
                            <th>Attacker</th>
                            <th>DCP</th>
                            <th>Marine</th>
                        </tr>
                    </thead>
                    <tbody>
                        {#each boarderUnits as u}
                            <tr>
                                <td>{u.id}</td>
                                <td>{u.type === "dcp" ? "DCP" : "Marine"}</td>
                                <td>{u.owner}</td>
                                <td>{attackerAllocationForUnit(u.id)}</td>
                                <td>
                                    <input
                                        class="input is-small"
                                        type="number"
                                        min="0"
                                        value={dcpByUnit[u.id] ?? 0}
                                        on:input={(e) => setDcp(u.id, Number(e.currentTarget.value))}
                                    />
                                </td>
                                <td>
                                    <div class="select is-small">
                                        <select
                                            value={marineByUnit[u.id] ?? ""}
                                            on:change={(e) => setMarine(u.id, e.currentTarget.value)}
                                        >
                                            <option value="">—</option>
                                            {#each defenderMarineOptions as mid}
                                                <option value={mid}>{mid}</option>
                                            {/each}
                                        </select>
                                    </div>
                                </td>
                            </tr>
                        {/each}
                    </tbody>
                </table>
                <button
                    class="button is-primary"
                    on:click={submit}
                    disabled={defenderAlreadyDeclared || boardingStep !== "defender"}
                >
                    {#if boardingStep !== "defender"}
                        Waiting for {BOARDING_STEP_LABELS.attackerAllocation}
                    {:else if defenderAlreadyDeclared}
                        {BOARDING_STEP_LABELS.defenderAllocation} already declared
                    {:else}
                        Declare defender allocation
                    {/if}
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
    .allocation-warnings {
        margin: 0;
        padding-left: 1.25rem;
    }
</style>
