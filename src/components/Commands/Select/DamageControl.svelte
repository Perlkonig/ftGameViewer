<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { currentState } from "@/stores/derivedState";
    import { commands } from "@/stores/writeCommands";
    import { headOffset } from "@/stores/writeHeadOffset";
    import { gameMeta } from "@/stores/writeGameMeta";
    import { initialState } from "@/stores/writeInitialState";
    import { appendGameCommand } from "@/lib/game/appendCommand";
    import { validateDeclareRepairOrdersCommand } from "@/lib/game/commandValidation";
    import type { ValidationIssue } from "@/lib/game/commandValidation";
    import { commandsInCurrentPhaseSegment } from "@/lib/game/moderatorStatus";
    import {
        repairOrdersDeclaredForShip,
        repairOrdersResolvedForShip,
        shipsWithRepairOrders,
    } from "@/lib/game/segmentApply";
    import type { GamePhase } from "@/lib/game/types";
    import { dcpAvailabilityForShip } from "@/lib/game/crewDeployment";
    import {
        damagedRegenArmourCount,
        repairTargetsForShip,
        shipHasRegenerativeArmour,
        shipNeedsRepairOrders,
        type ShipWithRepairState,
    } from "@/lib/game/repairSystems";
    import {
        encodeRepairOrdersNotes,
        type RepairOrdersV1,
    } from "@/lib/game/repairOrders";
    import type { FullThrustGameCommand } from "@/schemas/commands";
    import type { FullThrustGameObjects } from "@/schemas/position";
    import { userSettings } from "@/stores/writeUserSettings";
    import { toast } from "@zerodevx/svelte-toast";
    import { focusMapOnShipId } from "@/lib/actMapInteraction";
    import RenderSsd from "@/components/RenderSSD.svelte";
    import { buildShipRenderOpts } from "@/lib/ssdRenderOpts";
    import ActError from "./ActError.svelte";

    const dispatch = createEventDispatcher();
    const DCP_OPTIONS = [0, 1, 2, 3];

    let shipId = "";
    let selectedOwner = "";
    let dcpByTarget: Record<string, number> = {};
    let repairRegenArmour = true;
    let lastShipId = "";
    let actIssues: ValidationIssue[] = [];

    $: isMod = ($userSettings.role ?? "player") === "moderator";
    $: segment = $currentState.meta?.segment ?? "orders";
    $: phase = ($currentState.meta?.phase ?? 14) as GamePhase;
    $: players = $currentState.state?.players ?? [];
    $: ships =
        ($currentState.state?.objects?.filter((o) => o.objType === "ship") ??
            []) as FullThrustGameObjects[];
    $: if (players.length && !selectedOwner) {
        selectedOwner = players[0].id;
    }
    $: eligibleShips = ships.filter((s) =>
        shipNeedsRepairOrders(s as ShipWithRepairState)
    );
    $: repairableShips = eligibleShips.filter(
        (s) => !selectedOwner || !s.owner || String(s.owner) === selectedOwner
    );
    $: if (shipId && !repairableShips.some((s) => s.id === shipId)) {
        shipId = "";
    }
    $: ship = ships.find((s) => s.id === shipId) as ShipWithRepairState | undefined;
    $: targets = ship ? repairTargetsForShip(ship) : [];
    $: dcpAvail = ship ? dcpAvailabilityForShip(ship) : { available: 0, builtin: 0, hiredAvailable: 0 };
    $: hasRegenDamage = ship ? damagedRegenArmourCount(ship) > 0 : false;
    $: hasRegenDesign = ship ? shipHasRegenerativeArmour(ship) : false;
    $: showRegenCheckbox = hasRegenDamage && hasRegenDesign;
    $: shipJson = ship ? JSON.stringify(ship.object) : "";
    $: renderOpts = ship ? buildShipRenderOpts(ship) : { minimal: true };

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
    $: shipsWithExistingRepair = shipsWithRepairOrders(
        phaseCommands,
        $currentState.pendingRepairOrders
    );

    $: existingRepairWarnings = (() => {
        if (!shipId) return [];
        const issues: { message: string; severity: "warning" }[] = [];
        if (repairOrdersResolvedForShip(shipId, phaseCommands)) {
            issues.push({
                message: `${shipId} already had repair orders resolved this phase.`,
                severity: "warning",
            });
        } else if (
            repairOrdersDeclaredForShip(
                shipId,
                phaseCommands,
                $currentState.pendingRepairOrders
            )
        ) {
            issues.push({
                message: `${shipId} already has repair orders this phase — a new declare will add another entry (resolve uses latest).`,
                severity: "warning",
            });
        }
        return issues;
    })();

    const shipOptionLabel = (id: string, owner?: string): string => {
        const ownerPart = owner ? ` (${owner})` : "";
        const marked = shipsWithExistingRepair.has(id) ? " *" : "";
        return `${id}${ownerPart}${marked}`;
    };

    $: if (shipId !== lastShipId) {
        lastShipId = shipId;
        repairRegenArmour = hasRegenDamage;
        const next: Record<string, number> = {};
        for (const t of targets) next[t.id] = 0;
        dcpByTarget = next;
        if (shipId) focusMapOnShipId(shipId, ships);
    }

    $: totalDcp = targets.reduce(
        (sum, t) => sum + Math.max(0, Math.floor(dcpByTarget[t.id] ?? 0)),
        0
    );
    $: overAllocated = totalDcp > dcpAvail.available;

    $: foldStub = {
        meta: $currentState.meta ?? {
            phase: 14,
            turn: 1,
            version: "",
            name: "",
            createdAt: "",
            dicePolicy: "hybrid",
            segment: "orders",
        },
        position: $currentState.state ?? { map: { mode: "fixed", width: 72, height: 48 } },
        pendingRepairOrders: $currentState.pendingRepairOrders,
    };

    $: draftCmd = (() => {
        if (!shipId || !ship) return null;
        const allocations = targets
            .map((t) => ({
                targetId: t.id,
                dcp: Math.min(3, Math.max(0, Math.floor(dcpByTarget[t.id] ?? 0))),
            }))
            .filter((a) => a.dcp > 0);
        const orders: RepairOrdersV1 = {
            v: 1,
            allocations,
            repairRegenArmour: showRegenCheckbox && repairRegenArmour ? true : undefined,
        };
        return {
            name: "declareRepairOrders",
            ship: shipId,
            notes: encodeRepairOrdersNotes(orders),
        } as FullThrustGameCommand;
    })();

    $: actIssues =
        draftCmd && segment === "orders"
            ? validateDeclareRepairOrdersCommand(
                  foldStub,
                  $currentState.state ?? { map: { mode: "fixed", width: 72, height: 48 } },
                  draftCmd,
                  phaseCommands,
                  { actingPlayer: selectedOwner, moderator: isMod }
              )
            : segment !== "orders"
              ? [
                    {
                        message: "Repair orders are declared in the orders segment only.",
                        severity: "error" as const,
                    },
                ]
              : [];

    const successLabel = (dcp: number): string => {
        const n = Math.min(3, Math.max(1, Math.floor(dcp)));
        return n === 1 ? "1" : `1–${n}`;
    };

    const submit = () => {
        if (!draftCmd) {
            toast.push("Select a ship and allocate repair work");
            return;
        }
        const issues = validateDeclareRepairOrdersCommand(
            foldStub,
            $currentState.state ?? { map: { mode: "fixed", width: 72, height: 48 } },
            draftCmd,
            phaseCommands,
            { actingPlayer: selectedOwner, moderator: isMod }
        );
        for (const issue of issues.filter((i) => i.severity === "error")) {
            toast.push(issue.message);
            return;
        }
        for (const issue of issues.filter((i) => i.severity === "warning")) {
            toast.push(issue.message);
        }

        appendGameCommand(draftCmd, isMod);
        toast.push(`Repair orders declared for ${shipId}`);
        dispatch("done");
    };
</script>

{#if segment !== "orders"}
    <p class="notification is-warning is-light">
        Damage control orders are collected in the <strong>orders</strong> segment. Use Next step to
        return from resolve.
    </p>
{:else}
    {#if players.length > 1}
        <div class="field">
            <label class="label" for="repairOwner">Player</label>
            <div class="select is-fullwidth">
                <select id="repairOwner" bind:value={selectedOwner} disabled={!isMod && players.length === 1}>
                    {#each players as p}
                        <option value={p.id}>{p.id}</option>
                    {/each}
                </select>
            </div>
        </div>
    {/if}

    <div class="field">
        <label class="label" for="ship">Ship</label>
        <div class="select is-fullwidth">
            <select id="ship" bind:value={shipId}>
                <option value="">--</option>
                {#each repairableShips as s}
                    <option value={s.id}
                        >{shipOptionLabel(
                            s.id,
                            typeof s.owner === "string" ? s.owner : undefined
                        )}</option
                    >
                {/each}
            </select>
        </div>
        <p class="help">* — repair orders declared or resolved this phase</p>
    </div>

    {#if ship}
        {#if existingRepairWarnings.length > 0}
            <ActError issues={existingRepairWarnings} />
        {/if}
        <p class="help mb-2">
            Allocate 0–3 DCP per damaged system. Success on d6 ≤ DCP assigned (one roll per job).
        </p>

        <div class="columns repair-layout mt-2">
            <div class="column is-narrow">
                {#if shipJson}
                    <div class="ssd-preview">
                        <RenderSsd json={shipJson} opts={renderOpts} />
                    </div>
                {/if}
            </div>
            <div class="column">
                <p class="help mb-3">
                    <strong>DCP pool:</strong> {dcpAvail.available} available
                    ({dcpAvail.builtin} built-in, {dcpAvail.hiredAvailable} hired)
                    {#if overAllocated}
                        <span class="has-text-warning">
                            — allocated {totalDcp} (over pool; allowed with warning)</span
                        >
                    {/if}
                </p>

        {#if targets.length > 0}
            <h3 class="title is-6">Damaged systems</h3>
            <table class="table is-narrow is-fullwidth is-size-7">
                <thead>
                    <tr>
                        <th>System</th>
                        <th>DCP</th>
                        <th>Success on</th>
                    </tr>
                </thead>
                <tbody>
                    {#each targets as t}
                        {@const dcp = Math.floor(dcpByTarget[t.id] ?? 0)}
                        <tr>
                            <td>
                                {t.label}
                                <br /><code class="is-size-7">{t.id}</code>
                            </td>
                            <td>
                                <div class="select is-small">
                                    <select bind:value={dcpByTarget[t.id]}>
                                        {#each DCP_OPTIONS as n}
                                            <option value={n}>{n}</option>
                                        {/each}
                                    </select>
                                </div>
                            </td>
                            <td>{dcp >= 1 ? successLabel(dcp) : "—"}</td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        {:else}
            <p class="help">No DCP repair targets — regen armour repair only.</p>
        {/if}

        {#if showRegenCheckbox}
            <label class="checkbox mt-3">
                <input type="checkbox" bind:checked={repairRegenArmour} />
                Repair regenerative armour ({damagedRegenArmourCount(ship)} damaged box(es); 1d6 each:
                5–6 repairs, 1 lost, 2–4 no change)
            </label>
        {/if}

        <ActError issues={actIssues} />

        <div class="field mt-4">
            <button
                class="button is-primary"
                type="button"
                on:click={submit}
                disabled={actIssues.some((i) => i.severity === "error")}
            >
                Declare repair orders
            </button>
        </div>
            </div>
        </div>
    {:else if shipId}
        <p class="notification is-warning is-light">This ship has nothing to repair.</p>
    {:else}
        <p class="help">Select a ship with repairable damage and available DCP (or regen armour).</p>
    {/if}
{/if}

<style>
    .ssd-preview {
        max-width: 280px;
    }
</style>
