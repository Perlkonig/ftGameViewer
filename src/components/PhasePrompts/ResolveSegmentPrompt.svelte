<script lang="ts">
    import Modal from "@/components/Modal.svelte";
    import { appendGameCommand, appendGameCommands } from "@/lib/game/appendCommand";
    import {
        arrayRollSource,
        InsufficientDiceError,
        parseDiceString,
        policyRollSource,
    } from "@/lib/game/dice";
    import {
        decodeFireDeclarationNotes,
        fireDeclarationDiceInfo,
        resolveFireDeclaration,
    } from "@/lib/game/resolveCombat";
    import { currentActivationId } from "@/lib/game/phase";
    import { resolveBoardingCombatCommands } from "@/lib/game/boarding";
    import { boardingNotesFromCommand, BOARDING_STEP_LABELS } from "@/lib/game/boardingOrders";
    import type { ShipWithBoarders } from "@/lib/game/boardingState";
    import {
        orderedShipsWithPendingBoarding,
        orderedShipsWithPendingFire,
        orderedShipsWithPendingRepair,
        pendingBoardingForShip,
        pendingFireForShip,
        latestRepairDeclareForShip,
        pendingRocketLaunchesForShip,
    } from "@/lib/game/segmentApply";
    import { rocketHitThreshold } from "@/lib/game/ordnanceLaunch";
    import { distance } from "@/lib/game/movement";
    import { decodeRepairOrdersNotes } from "@/lib/game/repairOrders";
    import {
        damagedRegenArmourCount,
        repairAllocationPreview,
        repairDiceCountForShipOrder,
        repairOrderSummary,
        resolveRepairOrdersCommands,
        type ShipWithRepairState,
    } from "@/lib/game/repairSystems";
    import { commandsInCurrentPhaseSegment } from "@/lib/game/moderatorStatus";
    import { commands } from "@/stores/writeCommands";
    import { headOffset } from "@/stores/writeHeadOffset";
    import { initialState } from "@/stores/writeInitialState";
    import { currentState } from "@/stores/derivedState";
    import { gameMeta } from "@/stores/writeGameMeta";
    import type { GamePhase } from "@/lib/game/types";
    import type { FullThrustGameCommand } from "@/schemas/commands";
    import { toast } from "@zerodevx/svelte-toast";

    export let phase: GamePhase;
    export let meta: import("@/lib/game/types").GameMeta;
    export let onClose: () => void;

    let diceOverride = "";
    let resolveShipId = "";

    $: currentId = currentActivationId(meta);
    $: shipsWithPending = orderedShipsWithPendingFire(
        $currentState.pendingFireDeclarations
    );
    $: if (phase === 11) {
        if (!shipsWithPending.length) {
            resolveShipId = "";
        } else if (!resolveShipId || !shipsWithPending.includes(resolveShipId)) {
            resolveShipId = shipsWithPending[0];
        }
    }
    $: shipsWithPendingBoarding = orderedShipsWithPendingBoarding(
        $currentState.pendingBoardingOrders
    );
    $: if (phase === 12) {
        if (!shipsWithPendingBoarding.length) {
            resolveShipId = "";
        } else if (!resolveShipId || !shipsWithPendingBoarding.includes(resolveShipId)) {
            resolveShipId = shipsWithPendingBoarding[0];
        }
    }
    $: shipsWithPendingRepair = orderedShipsWithPendingRepair(
        $currentState.pendingRepairOrders
    );
    $: visibleCommands = $commands.slice(0, Math.max(0, $commands.length - $headOffset));
    $: phaseCommands =
        phase === 14
            ? commandsInCurrentPhaseSegment(
                  visibleCommands,
                  { turn: meta.turn, phase: 14 },
                  $gameMeta,
                  $initialState
              )
            : [];
    $: if (phase === 14) {
        if (!shipsWithPendingRepair.length) {
            resolveShipId = "";
        } else if (!resolveShipId || !shipsWithPendingRepair.includes(resolveShipId)) {
            resolveShipId = shipsWithPendingRepair[0];
        }
    }
    $: pendingBoarding = resolveShipId
        ? pendingBoardingForShip(
              {
                  meta,
                  position: $currentState.state ?? { map: { mode: "fixed", width: 72, height: 48 } },
                  pendingBoardingOrders: $currentState.pendingBoardingOrders,
              },
              resolveShipId
          )
        : [];

    $: pendingRepairDecl =
        resolveShipId && phase === 14
            ? latestRepairDeclareForShip(
                  resolveShipId,
                  phaseCommands,
                  $currentState.pendingRepairOrders
              )
            : undefined;

    $: repairOrder =
        pendingRepairDecl && phase === 14
            ? decodeRepairOrdersNotes((pendingRepairDecl as { notes?: string }).notes)
            : null;

    $: repairShipObj =
        resolveShipId && phase === 14
            ? (objects.find((o) => o.id === resolveShipId && o.objType === "ship") as
                  | ShipWithRepairState
                  | undefined)
            : undefined;

    $: repairDiceTotal =
        repairShipObj && repairOrder
            ? repairDiceCountForShipOrder(repairShipObj, repairOrder)
            : 0;

    $: repairPreview =
        repairShipObj && repairOrder
            ? repairAllocationPreview(repairShipObj, repairOrder)
            : [];

    $: pendingFire =
        resolveShipId && phase === 11
            ? pendingFireForShip(
                  {
                      meta,
                      position:
                          $currentState.state ?? { map: { mode: "fixed", width: 72, height: 48 } },
                      pendingFireDeclarations: $currentState.pendingFireDeclarations,
                  },
                  resolveShipId
              )
            : [];

    $: fireByTarget = (() => {
        const groups = new Map<string, FullThrustGameCommand[]>();
        for (const decl of pendingFire) {
            const targetId = (decl as { target?: string }).target ?? "—";
            if (!groups.has(targetId)) groups.set(targetId, []);
            groups.get(targetId)!.push(decl);
        }
        return [...groups.entries()];
    })();

    $: objects = $currentState.state?.objects ?? [];

    const declarationSummary = (decl: FullThrustGameCommand): string => {
        const c = decl as { weapon?: string; target?: string; notes?: string };
        const metaNotes = decodeFireDeclarationNotes(c.notes);
        const weapon = metaNotes.weaponName ?? c.weapon ?? "weapon";
        const target = c.target ?? "—";
        const info = fireDeclarationDiceInfo(decl);
        if ((metaNotes.mode ?? "beam") === "pds") {
            return `${weapon} → ${target} (${info.attackPool} PDS die; rerolls as needed)`;
        }
        if ((metaNotes.mode ?? "beam") === "needle") {
            return `${weapon} → ${target} (1 die)`;
        }
        return `${weapon} → ${target} (${info.attackPool} attack die at band ${info.rangeBand}, ${info.rangeMu.toFixed(1)} MU; penetrating rerolls as needed)`;
    };

    const boardingOrderSummary = (decl: FullThrustGameCommand): string => {
        const notes = boardingNotesFromCommand(decl);
        if (!notes) return "Invalid orders";
        if (notes.role === "defender") {
            const dcp = (notes.dcpRepel ?? []).reduce((s, a) => s + a.dcp, 0);
            const mar = (notes.marineFight ?? []).length;
            return `Defender: ${dcp} DCP, ${mar} marine(s) assigned`;
        }
        const att = (notes.unitAllocations ?? []).length;
        const raze = (notes.unitAllocations ?? []).filter((a) => a.allocation === "raze").length;
        return `Attacker ${notes.attackerOwner ?? "?"}: ${att} unit(s) (${raze} raze)`;
    };

    const resolveLaunch = () => {
        const ship = currentId;
        if (!ship) {
            toast.push("No ship to resolve");
            return;
        }
        const pendingRockets = pendingRocketLaunchesForShip(
            { meta, position: $currentState.state! } as import("@/lib/game/applyCommand").FoldState,
            ship
        );
        const cmd: FullThrustGameCommand = {
            name: "resolveLaunchOrdnance",
            ship,
        } as FullThrustGameCommand;
        if (pendingRockets.length > 0 && diceOverride.trim()) {
            const rolls = parseDiceString(diceOverride.trim()).slice(0, 2);
            if (rolls.length >= 2) {
                (cmd as { rolls?: number[] }).rolls = [rolls[0], rolls[1]];
            }
        }
        appendGameCommand(cmd);
        toast.push(`Resolved launch orders for ${ship}`);
        onClose();
    };

    $: pendingRocketsPhase3 =
        phase === 3 && currentId
            ? pendingRocketLaunchesForShip(
                  {
                      meta,
                      position: $currentState.state!,
                      pendingLaunches: $currentState.pendingLaunches,
                  } as import("@/lib/game/applyCommand").FoldState,
                  currentId
              )
            : [];

    $: rocketResolveInfo = (() => {
        if (pendingRocketsPhase3.length === 0 || !currentId) return null;
        const decl = pendingRocketsPhase3[0] as {
            targetShip?: string;
            ship?: string;
        };
        const launcher = $currentState.state?.objects?.find(
            (o) => o.objType === "ship" && o.id === decl.ship
        );
        const target = $currentState.state?.objects?.find(
            (o) => o.objType === "ship" && o.id === decl.targetShip
        );
        if (
            !launcher?.position ||
            !("x" in launcher.position) ||
            !target?.position ||
            !("x" in target.position)
        ) {
            return null;
        }
        const rangeMu = distance(launcher.position, target.position);
        const need = rocketHitThreshold(rangeMu);
        return { targetId: decl.targetShip, rangeMu, need };
    })();

    const buildRollSource = () => {
        if (diceOverride.trim()) {
            return arrayRollSource(parseDiceString(diceOverride));
        }
        const gm = $gameMeta;
        return policyRollSource(gm.dicePolicy, { seed: gm.diceSeed });
    };

    const resolveFire = () => {
        const ship = resolveShipId;
        if (!ship || pendingFire.length === 0) {
            toast.push("No fire declarations to resolve");
            onClose();
            return;
        }

        let source;
        try {
            source = buildRollSource();
        } catch (e) {
            toast.push(e instanceof Error ? e.message : "Invalid dice string");
            return;
        }

        const cmds: FullThrustGameCommand[] = [];
        const mark = source.mark();
        try {
            for (const decl of pendingFire) {
                const targetId = (decl as { target?: string }).target;
                const target = objects.find((o) => o.id === targetId);
                cmds.push(
                    ...resolveFireDeclaration(
                        decl,
                        source,
                        target,
                        $currentState.state ?? undefined,
                        $currentState.meta ?? undefined
                    )
                );
            }
        } catch (e) {
            if (e instanceof InsufficientDiceError) {
                toast.push("Not enough dice in pasted sequence — add more or use Resolve without paste to auto-roll.");
            } else {
                toast.push(e instanceof Error ? e.message : "Could not resolve fire");
            }
            return;
        }

        const consumed = source.consumedSince(mark);
        cmds.push({ name: "resolveShipFire", ship, rolls: consumed } as FullThrustGameCommand);
        appendGameCommands(cmds, true);

        if (cmds.some((c) => c.name === "queueTransporterDelivery")) {
            toast.push(
                "Transporter hit(s) — declare delivery in Act → Transporter delivery"
            );
        }

        if (!diceOverride.trim() && consumed.length) {
            diceOverride = consumed.join(", ");
        }

        const remainingShips = shipsWithPending.filter((s) => s !== ship);
        toast.push(`Resolved fire for ${ship} (${consumed.length} dice)`);
        if (remainingShips.length > 0) {
            resolveShipId = remainingShips[0];
            diceOverride = "";
            toast.push(`Next: resolve fire for ${resolveShipId}`);
            return;
        }
        onClose();
    };

    const resolveBoarding = () => {
        const shipId = resolveShipId;
        if (!shipId || pendingBoarding.length === 0) {
            toast.push("No boarding orders to resolve");
            onClose();
            return;
        }
        const shipObj = objects.find((o) => o.id === shipId && o.objType === "ship");
        if (!shipObj) {
            toast.push(`Ship not found: ${shipId}`);
            return;
        }
        let source;
        try {
            source = buildRollSource();
        } catch (e) {
            toast.push(e instanceof Error ? e.message : "Invalid dice string");
            return;
        }
        try {
            const cmds = resolveBoardingCombatCommands(
                shipId,
                shipObj as ShipWithBoarders,
                pendingBoarding,
                source
            );
            appendGameCommands(cmds, true);
            const consumed = (cmds.find((c) => c.name === "resolveBoardingCombat") as { rolls?: number[] })
                ?.rolls ?? [];
            if (!diceOverride.trim() && consumed.length) {
                diceOverride = consumed.join(", ");
            }
            const remaining = shipsWithPendingBoarding.filter((s) => s !== shipId);
            toast.push(`Resolved boarding for ${shipId} (${consumed.length} dice)`);
            if (remaining.length > 0) {
                resolveShipId = remaining[0];
                diceOverride = "";
                toast.push(`Next: resolve boarding for ${resolveShipId}`);
                return;
            }
            onClose();
        } catch (e) {
            if (e instanceof InsufficientDiceError) {
                toast.push("Not enough dice — add more or clear paste to auto-roll.");
            } else {
                toast.push(e instanceof Error ? e.message : "Could not resolve boarding");
            }
        }
    };

    const resolveRepair = () => {
        const shipId = resolveShipId;
        if (!shipId || !repairOrder || !repairShipObj) {
            toast.push("No repair orders to resolve");
            onClose();
            return;
        }
        let source;
        try {
            source = buildRollSource();
        } catch (e) {
            toast.push(e instanceof Error ? e.message : "Invalid dice string");
            return;
        }
        try {
            const cmds = resolveRepairOrdersCommands(shipId, repairShipObj, repairOrder, source);
            appendGameCommands(cmds, true);
            const consumed = (cmds.find((c) => c.name === "resolveRepairOrders") as { rolls?: number[] })
                ?.rolls ?? [];
            if (!diceOverride.trim() && consumed.length) {
                diceOverride = consumed.join(", ");
            }
            const remaining = shipsWithPendingRepair.filter((s) => s !== shipId);
            toast.push(`Resolved repair for ${shipId} (${consumed.length} dice)`);
            if (remaining.length > 0) {
                resolveShipId = remaining[0];
                diceOverride = "";
                toast.push(`Next: resolve repair for ${resolveShipId}`);
                return;
            }
            onClose();
        } catch (e) {
            if (e instanceof InsufficientDiceError) {
                toast.push("Not enough dice — add more or clear paste to auto-roll.");
            } else {
                toast.push(e instanceof Error ? e.message : "Could not resolve repair");
            }
        }
    };

    const apply = () => {
        if (phase === 3) resolveLaunch();
        else if (phase === 11) resolveFire();
        else if (phase === 12) resolveBoarding();
        else if (phase === 14) resolveRepair();
        else onClose();
    };
</script>

<Modal
    title="Resolve {phase === 3 ? 'Launch' : phase === 12 ? 'Boarding' : phase === 14 ? 'Repair' : 'Ship fire'}"
    buttons={[
        { label: "Skip", action: onClose },
        { label: "Resolve", action: apply, class: "is-info" },
    ]}
>
    {#if phase === 11}
            {#if shipsWithPending.length === 0}
            <p class="help">No pending fire declarations to resolve.</p>
            {:else}
            {#if shipsWithPending.length > 1}
                <div class="field">
                    <label class="label" for="resolveShip">Ship to resolve</label>
                    <div class="select is-fullwidth">
                        <select id="resolveShip" bind:value={resolveShipId}>
                            {#each shipsWithPending as shipId}
                                <option value={shipId}>{shipId}</option>
                            {/each}
                        </select>
                    </div>
                </div>
            {:else}
                <p class="help">
                    Resolve fire for <strong>{resolveShipId}</strong>
                </p>
            {/if}
            <ul class="is-size-7 mb-3">
                {#each fireByTarget as [targetId, decls]}
                    <li class="mb-2">
                        <strong>Target {targetId}</strong>
                        <ul>
                            {#each decls as decl}
                                <li>{declarationSummary(decl)}</li>
                            {/each}
                        </ul>
                    </li>
                {/each}
            </ul>
            <div class="field">
                <label class="label" for="dice">Dice sequence (optional)</label>
                <input
                    id="dice"
                    class="input"
                    bind:value={diceOverride}
                    placeholder="Leave empty to auto-roll on demand"
                />
                <p class="help is-size-7">
                    Leave empty and click Resolve to roll dice as needed (including penetrating
                    rerolls). Or paste a moderator dice string — all values are consumed in order.
                </p>
            </div>
        {/if}
    {:else if phase === 12}
        {#if shipsWithPendingBoarding.length === 0}
            <p class="help">No pending boarding orders to resolve.</p>
        {:else}
            {#if shipsWithPendingBoarding.length > 1}
                <div class="field">
                    <label class="label" for="resolveBoardingShip">Ship to resolve</label>
                    <div class="select is-fullwidth">
                        <select id="resolveBoardingShip" bind:value={resolveShipId}>
                            {#each shipsWithPendingBoarding as shipId}
                                <option value={shipId}>{shipId}</option>
                            {/each}
                        </select>
                    </div>
                </div>
            {:else}
                <p class="help">
                    Resolve boarding for <strong>{resolveShipId}</strong>
                </p>
            {/if}
            <ul class="is-size-7 mb-3">
                {#each pendingBoarding as decl}
                    <li>{boardingOrderSummary(decl)}</li>
                {/each}
            </ul>
            <div class="field">
                <label class="label" for="diceBoarding">Dice sequence (optional)</label>
                <input
                    id="diceBoarding"
                    class="input"
                    bind:value={diceOverride}
                    placeholder="Leave empty to auto-roll on demand"
                />
                <p class="help is-size-7">
                    Dice count is computed from DCP and marine allocations. Resolve applies
                    {BOARDING_STEP_LABELS.dcpRepel}, {BOARDING_STEP_LABELS.resolveCombat}, and
                    {BOARDING_STEP_LABELS.raze}. Paste a moderator sequence or leave empty to roll on
                    demand.
                </p>
            </div>
        {/if}
    {:else if phase === 14}
        {#if shipsWithPendingRepair.length === 0}
            <p class="help">No pending repair orders to resolve.</p>
        {:else}
            {#if shipsWithPendingRepair.length > 1}
                <div class="field">
                    <label class="label" for="resolveRepairShip">Ship to resolve</label>
                    <div class="select is-fullwidth">
                        <select id="resolveRepairShip" bind:value={resolveShipId}>
                            {#each shipsWithPendingRepair as shipId}
                                <option value={shipId}>{shipId}</option>
                            {/each}
                        </select>
                    </div>
                </div>
            {:else}
                <p class="help">
                    Resolve repair for <strong>{resolveShipId}</strong>
                </p>
            {/if}
            {#if repairOrder}
                <p class="is-size-7 mb-2">{repairOrderSummary(resolveShipId, repairOrder)}</p>
                {#if repairPreview.length > 0}
                    <table class="table is-narrow is-fullwidth is-size-7 mb-3">
                        <thead>
                            <tr>
                                <th>System</th>
                                <th>DCP</th>
                                <th>Success on d6</th>
                            </tr>
                        </thead>
                        <tbody>
                            {#each repairPreview as row}
                                <tr>
                                    <td>{row.label}</td>
                                    <td>{row.dcp}</td>
                                    <td>{row.successOn}</td>
                                </tr>
                            {/each}
                        </tbody>
                    </table>
                {/if}
                {#if repairOrder.repairRegenArmour && repairShipObj}
                    <p class="help is-size-7 mb-2">
                        Regenerative armour: {damagedRegenArmourCount(repairShipObj)} box(es) — roll
                        1d6 each (5–6 repairs, 1 permanently lost, 2–4 no change).
                    </p>
                {/if}
                <p class="help is-size-7 mb-3">
                    <strong>{repairDiceTotal}</strong> dice required (DCP attempts + regen armour boxes).
                </p>
            {/if}
            <div class="field">
                <label class="label" for="diceRepair">Dice sequence (optional)</label>
                <input
                    id="diceRepair"
                    class="input"
                    bind:value={diceOverride}
                    placeholder="Leave empty to auto-roll on demand"
                />
                <p class="help is-size-7">
                    Paste a moderator dice sequence or leave empty to roll on demand.
                </p>
            </div>
        {/if}
    {:else if phase === 3}
        {#if pendingRocketsPhase3.length > 0 && rocketResolveInfo}
            <p class="help">
                Rocket pod at <strong>{currentId}</strong> vs
                <strong>{rocketResolveInfo.targetId}</strong>
                ({rocketResolveInfo.rangeMu.toFixed(1)} MU) — need
                <strong>{rocketResolveInfo.need}+</strong> on each of 2d6.
            </p>
            <div class="field">
                <label class="label" for="diceRocket">Dice (2d6, optional)</label>
                <input
                    id="diceRocket"
                    class="input"
                    bind:value={diceOverride}
                    placeholder="e.g. 4 5 — leave empty to auto-roll"
                />
            </div>
        {:else}
            <p class="help">
                Apply declared orders for <strong>{currentId ?? "—"}</strong> to the board.
                {#if pendingRocketsPhase3.length === 0}
                    (No pending rocket launches — advance activation.)
                {/if}
            </p>
        {/if}
    {:else}
        <p class="help">
            Apply declared orders for <strong>{currentId ?? "—"}</strong> to the board.
        </p>
    {/if}
</Modal>
