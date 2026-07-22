<script lang="ts">
    import Modal from "@/components/Modal.svelte";
    import { appendGameCommand, appendGameCommands } from "@/lib/game/appendCommand";
    import {
        arrayRollSource,
        InsufficientDiceError,
        parseDiceString,
        policyRollSource,
    } from "@/lib/game/dice";
    import { phaseName } from "@/lib/game/phase";
    import {
        buildMinePhaseResolveCommands,
        collectSweepEvents,
        collectDetonationEvents,
        extractMinePhaseLogLines,
        minePhaseDiceCount,
        type ResolvedShipMove,
    } from "@/lib/game/mineMovement";
    import { currentState } from "@/stores/derivedState";
    import type { GameMeta } from "@/lib/game/types";
    import { toast } from "@zerodevx/svelte-toast";

    export let meta: GameMeta;
    export let onClose: () => void;

    let step: "confirm" | "dice" = "confirm";
    let diceSeq = "";
    let resolvedMoves: ResolvedShipMove[] = [];
    let damagePreview: string[] = [];

    $: position =
        $currentState.state ?? { map: { mode: "fixed", width: 72, height: 48 }, objects: [] };
    $: pendingMoves = $currentState.pendingMoves ?? [];
    $: pendingLayMines = $currentState.pendingLayMines ?? [];
    $: storedMoves = $currentState.phase5ResolvedMoves ?? [];
    $: activeMoves = resolvedMoves.length ? resolvedMoves : storedMoves;
    $: diceSummary = minePhaseDiceCount(activeMoves, position, meta);
    $: sweepEvents = collectSweepEvents(activeMoves, position);
    $: detEvents = collectDetonationEvents(activeMoves, position, meta);

    $: if (storedMoves.length && step === "confirm") {
        step = "dice";
        resolvedMoves = storedMoves;
    }

    $: movementResolved = storedMoves.length > 0;

    const buildRollSource = () => {
        if (diceSeq.trim()) {
            return arrayRollSource(parseDiceString(diceSeq));
        }
        return policyRollSource(meta.dicePolicy, { seed: meta.diceSeed });
    };

    const applyMovement = () => {
        appendGameCommand({ name: "resolvePhase5Movement" } as import("@/schemas/commands").FullThrustGameCommand);
        toast.push("Movement and mine placements applied");
        step = "dice";
    };

    const updateDamagePreview = () => {
        if (diceSummary.total === 0) {
            damagePreview = [];
            return;
        }
        try {
            const source = buildRollSource();
            const { cmds } = buildMinePhaseResolveCommands(position, meta, activeMoves, source);
            damagePreview = extractMinePhaseLogLines(cmds);
        } catch {
            damagePreview = [];
        }
    };

    const rollDice = () => {
        if (diceSummary.total === 0) {
            toast.push("No dice needed");
            return;
        }
        const source = policyRollSource(meta.dicePolicy, { seed: meta.diceSeed });
        const mark = source.mark();
        try {
            const { cmds } = buildMinePhaseResolveCommands(position, meta, activeMoves, source);
            diceSeq = source.consumedSince(mark).join(", ");
            damagePreview = extractMinePhaseLogLines(cmds);
        } catch (e) {
            toast.push(e instanceof Error ? e.message : "Could not roll mine dice");
        }
    };

    const resolveDice = () => {
        if (diceSummary.total === 0) {
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
        const mark = source.mark();
        let cmds: import("@/schemas/commands").FullThrustGameCommand[];
        try {
            ({ cmds } = buildMinePhaseResolveCommands(position, meta, activeMoves, source));
        } catch (e) {
            if (e instanceof InsufficientDiceError) {
                toast.push(
                    "Not enough dice in pasted sequence — add more or clear the field to auto-roll."
                );
            } else {
                toast.push(e instanceof Error ? e.message : "Could not resolve mine dice");
            }
            return;
        }
        const consumed = source.consumedSince(mark);
        if (!diceSeq.trim()) {
            diceSeq = consumed.join(", ");
        }
        damagePreview = extractMinePhaseLogLines(cmds);
        appendGameCommands(
            [
                ...cmds,
                {
                    name: "resolveMinePhase",
                    rolls: consumed,
                    preExpanded: true,
                },
            ] as import("@/schemas/commands").FullThrustGameCommand[],
            true
        );
        toast.push(`Resolved mine phase (${consumed.length} dice)`);
        onClose();
    };

    const skipDice = () => {
        if (diceSummary.total > 0) {
            toast.push("Enter dice or resolve before closing");
            return;
        }
        onClose();
    };

    $: confirmButtons = movementResolved
        ? [{ label: "Close", action: onClose }]
        : [
              { label: "Cancel", action: onClose },
              { label: "Apply movement", action: applyMovement, class: "is-info" },
          ];

    $: diceButtons =
        diceSummary.total > 0
            ? [
                  { label: "Skip", action: skipDice },
                  { label: "Roll dice", action: rollDice, class: "is-light" },
                  { label: "Resolve", action: resolveDice, class: "is-info" },
              ]
            : [{ label: "Close", action: onClose }];
</script>

{#if step === "confirm"}
    <Modal title="Phase 5: {phaseName(5)} — Resolve movement" buttons={confirmButtons}>
        {#if pendingMoves.length === 0}
            <p class="notification is-light">
                No explicit movement orders — all ships will continue at their current course and
                speed.
            </p>
        {:else}
            <p class="help mb-3">
                Minelayer ships move first and drop mines along their paths. Remaining ships
                move afterward. Sweep and detonation dice are entered in the next step.
            </p>
            <table class="table is-narrow is-fullwidth is-size-7">
                <thead>
                    <tr>
                        <th>Ship</th>
                        <th>Sweep</th>
                        <th>Lay layers</th>
                    </tr>
                </thead>
                <tbody>
                    {#each pendingMoves as cmd}
                        {#if cmd.name === "moveShip"}
                            <tr>
                                <td>{cmd.id}</td>
                                <td>{(cmd as { sweepForMines?: boolean }).sweepForMines ? "yes" : "—"}</td>
                                <td>
                                    {((cmd as { deployMineLayers?: string[] }).deployMineLayers ?? []).join(", ") || "—"}
                                </td>
                            </tr>
                        {/if}
                    {/each}
                </tbody>
            </table>
            {#if pendingLayMines.length > 0}
                <p class="heading mt-3">Mine placements</p>
                <table class="table is-narrow is-fullwidth is-size-7">
                    <thead>
                        <tr>
                            <th>Ship</th>
                            <th>Layer</th>
                            <th>Position</th>
                        </tr>
                    </thead>
                    <tbody>
                        {#each pendingLayMines as lay}
                            {#if lay.name === "layMine"}
                                <tr>
                                    <td>{lay.ship}</td>
                                    <td>{(lay as { systemId?: string }).systemId}</td>
                                    <td>
                                        {lay.position?.x?.toFixed(2)}, {lay.position?.y?.toFixed(2)}
                                    </td>
                                </tr>
                            {/if}
                        {/each}
                    </tbody>
                </table>
            {/if}
        {/if}
    </Modal>
{:else}
    <Modal title="Phase 5: Mine sweep & detonation" buttons={diceButtons}>
        {#if diceSummary.total === 0}
            <p class="notification is-light">No mine sweep or detonation rolls needed.</p>
        {:else}
            <p class="help mb-3">
                Roll 1d6 per mine passed by a sweeper; roll 4d6 per hostile mine detonation (close-range beam).
                Penetrating rerolls are included automatically when using Roll dice or Resolve with an empty field.
            </p>
            {#if sweepEvents.length > 0}
                <p class="heading">Sweep rolls (1d6 each)</p>
                <ul class="is-size-7">
                    {#each sweepEvents as ev}
                        <li>{ev.shipId} → mine {ev.mineId}</li>
                    {/each}
                </ul>
            {/if}
            {#if detEvents.length > 0}
                <p class="heading mt-2">Detonations (4d6 each)</p>
                <ul class="is-size-7">
                    {#each detEvents as ev}
                        <li>Mine {ev.mineId} → {ev.targetShipId}</li>
                    {/each}
                </ul>
            {/if}
            <p class="mb-3"><strong>Total dice: {diceSummary.total}</strong></p>
            <div class="field">
                <label class="label" for="mineDice">Dice sequence (optional)</label>
                <textarea
                    id="mineDice"
                    class="textarea"
                    rows="3"
                    bind:value={diceSeq}
                    placeholder="Leave empty to auto-roll on demand"
                    on:change={updateDamagePreview}
                />
                <p class="help is-size-7">
                    Leave empty and click Resolve to roll dice as needed (including penetrating
                    rerolls). Or paste a moderator dice string — all values are consumed in order.
                </p>
            </div>
            {#if damagePreview.length > 0}
                <p class="heading mt-3">Damage preview</p>
                <ul class="is-size-7">
                    {#each damagePreview as line}
                        <li>{line}</li>
                    {/each}
                </ul>
            {/if}
        {/if}
    </Modal>
{/if}
