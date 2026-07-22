<script lang="ts">
    import { currentState } from "@/stores/derivedState";
    import { commands } from "@/stores/writeCommands";
    import { headOffset } from "@/stores/writeHeadOffset";
    import { userSettings } from "@/stores/writeUserSettings";
    import { appendGameCommand, appendGameCommands } from "@/lib/game/appendCommand";
    import { gameMeta } from "@/stores/writeGameMeta";
    import { initialState } from "@/stores/writeInitialState";
    import {
        phaseName,
        advancePhaseCommand,
        advanceSegmentCommand,
        nextPhase,
        phaseAdvancePrompt,
        buildModeratorStatus,
        isSegmentActivationPhase,
        validateAdvancePhase,
        type PhaseAdvancePromptKind,
    } from "@/lib/game";
    import type { FoldState } from "@/lib/game/applyCommand";
    import type { GamePhase } from "@/lib/game/types";
    import { toast } from "@zerodevx/svelte-toast";
    import InitiativePrompt from "./PhasePrompts/InitiativePrompt.svelte";
    import PhaseDicePrompt from "./PhasePrompts/PhaseDicePrompt.svelte";
    import ResolveSegmentPrompt from "./PhasePrompts/ResolveSegmentPrompt.svelte";
    import ThresholdPhasePrompt from "./PhasePrompts/ThresholdPhasePrompt.svelte";
    import EmpPhasePrompt from "./PhasePrompts/EmpPhasePrompt.svelte";
    import ReactorPhasePrompt from "./PhasePrompts/ReactorPhasePrompt.svelte";
    import Phase5MovementPrompt from "./PhasePrompts/Phase5MovementPrompt.svelte";
    import { mineLaysComplete } from "@/lib/game/mineMovement";
    import { phase7OrdnanceLogCommands } from "@/lib/game/ordnanceAllocation";
    import { buildAutoInterceptCommands, buildAutoGunboatInterceptCommands } from "@/lib/game/fighterPhase8";
    import { gunboatAttackAllocations } from "@/lib/game/gunboatEngagement";
    import { buildPhase10ResolveCommands,
        phase10StrikesCompleteInLog,
    } from "@/lib/game/phase10Strikes";
    import { buildPhase11HullDestructionCommands } from "@/lib/game/phase11HullDestruction";
    import { fighterAttackAllocations } from "@/lib/game/fighterEngagement";
    import { policyRollSource } from "@/lib/game/dice";
    import type { FullThrustGameCommand } from "@/schemas/commands";
    import { validateAdvanceSegment } from "@/lib/game/commandValidation";
    import { commandsInCurrentPhaseSegment } from "@/lib/game/moderatorStatus";
    import ReplayScrubber from "./ReplayScrubber.svelte";

    $: meta = $currentState.meta;
    $: players = $currentState.state?.players ?? [];
    $: playerIds = players.map((p) => p.id);
    $: visibleCommands = $commands.slice(0, Math.max(0, $commands.length - $headOffset));
    $: modStatus =
        meta && $currentState.state
            ? buildModeratorStatus({
                  meta,
                  position: $currentState.state,
                  playerIds,
                  packageMeta: $gameMeta,
                  initialPosition: $initialState,
                  commands: visibleCommands,
                  pendingFireDeclarations: $currentState.pendingFireDeclarations,
                  pendingBoardingOrders: $currentState.pendingBoardingOrders,
                  pendingRepairOrders: $currentState.pendingRepairOrders,
                  pendingMoves: $currentState.pendingMoves,
                  pendingLayMines: $currentState.pendingLayMines,
                  phase5ResolvedMoves: $currentState.phase5ResolvedMoves,
                  phase5MovementResolved: $currentState.phase5MovementResolved,
                  pendingOrdnanceAllocations: $currentState.pendingOrdnanceAllocations,
                  phase8FurballDeclarations: $currentState.phase8FurballDeclarations,
                  phase9PdDeclarations: $currentState.phase9PdDeclarations,
                  pendingTransporterDeliveries: $currentState.pendingTransporterDeliveries,
                  bankedEmpHits: $currentState.bankedEmpHits,
              })
            : null;
    $: maxOffset = $commands.length;
    $: atHead = $headOffset === 0;
    $: replayVisibleCount = visibleCommands.length;
    $: phase5CanResolve =
        meta?.phase === 5 &&
        mineLaysComplete($currentState.pendingMoves, $currentState.pendingLayMines) &&
        !$currentState.phase5MovementResolved &&
        !($currentState.phase5ResolvedMoves?.length);
    $: phase5NeedsDice = ($currentState.phase5ResolvedMoves?.length ?? 0) > 0;

    let promptKind: PhaseAdvancePromptKind | null = null;
    let promptPhase: GamePhase | null = null;
    let showResolvePrompt = false;
    let showPhase5Movement = false;

    const isMod = () => ($userSettings.role ?? "player") === "moderator";

    const closePrompt = () => {
        promptKind = null;
        promptPhase = null;
        showResolvePrompt = false;
        showPhase5Movement = false;
    };

    const continueToThresholdPrompt = () => {
        promptKind = "threshold";
        promptPhase = 13;
    };

    const nextStep = () => {
        if (!isMod()) {
            toast.push("Only the moderator advances steps");
            return;
        }
        if (!meta) return;
        if ($headOffset !== 0) {
            toast.push("Return to latest command before advancing");
            return;
        }
        if (!isSegmentActivationPhase(meta.phase as GamePhase)) {
            toast.push("Next step is only for segmented activation phases");
            return;
        }
        const phase = meta.phase as GamePhase;
        const segment = meta.segment ?? "orders";
        if (phase === 7 && segment === "resolve") {
            toast.push(
                "Fighter allocation complete — use Advance Phase to continue to dogfights (phase 8)."
            );
            return;
        }
        if (phase === 8 && segment === "resolve") {
            toast.push(
                "Use Resolve furballs to roll and apply all declared engagements, then Advance Phase."
            );
            return;
        }
        if (phase === 9 && segment === "resolve") {
            toast.push(
                "Use Resolve point defense to roll and apply all declarations, then Advance Phase."
            );
            return;
        }
        if (phase === 12 && segment === "orders" && $currentState.state) {
            const phaseCommands = commandsInCurrentPhaseSegment(
                visibleCommands,
                { turn: meta.turn, phase: 12 },
                $gameMeta,
                $initialState
            );
            const fold: FoldState = {
                meta,
                position: $currentState.state,
                pendingBoardingOrders: $currentState.pendingBoardingOrders,
            };
            const blocking = validateAdvanceSegment(fold, phaseCommands).find(
                (i) => i.severity === "error"
            );
            if (blocking) {
                toast.push(blocking.message);
                return;
            }
        }
        const cmds: FullThrustGameCommand[] = [];
        if (phase === 7 && segment === "orders") {
            const pending = $currentState.pendingOrdnanceAllocations ?? [];
            cmds.push(...phase7OrdnanceLogCommands(pending));
        }
        cmds.push(advanceSegmentCommand());
        if (cmds.length === 1) {
            appendGameCommand(cmds[0]);
        } else {
            appendGameCommands(cmds);
        }
        const wasOrders = segment === "orders";
        if (
            wasOrders &&
            (phase === 3 ||
                phase === 11 ||
                (phase === 12 && (meta.boardingStep ?? "attacker") === "defender") ||
                phase === 14)
        ) {
            showResolvePrompt = true;
        }
    };

    const advance = () => {
        if (!isMod()) {
            toast.push("Only the moderator advances phases");
            return;
        }
        if (!meta) return;
        if ($headOffset !== 0) {
            toast.push("Return to latest command before advancing");
            return;
        }
        if (meta.phase === 5 && $currentState.state) {
            const fold: FoldState = {
                meta,
                position: $currentState.state,
                pendingMoves: $currentState.pendingMoves,
                pendingLayMines: $currentState.pendingLayMines,
                phase5ResolvedMoves: $currentState.phase5ResolvedMoves,
                phase5MovementResolved: $currentState.phase5MovementResolved,
            };
            const cmd = advancePhaseCommand(meta);
            const blocking = validateAdvancePhase(fold, cmd).find((i) => i.severity === "error");
            if (blocking) {
                toast.push(blocking.message);
                showPhase5Movement = true;
                return;
            }
        }
        if (meta.phase === 7 && $currentState.state) {
            const segment = meta.segment ?? "orders";
            const pending = $currentState.pendingOrdnanceAllocations ?? [];
            const pre: FullThrustGameCommand[] = [];
            if (segment === "orders") {
                pre.push(...phase7OrdnanceLogCommands(pending));
                pre.push(advanceSegmentCommand());
            }
            if (pre.length > 0) {
                appendGameCommands(pre);
            }
        }
        const entering = nextPhase(meta);
        const batch: FullThrustGameCommand[] = [advancePhaseCommand(meta)];
        if (meta.phase === 11 && entering.phase === 12 && $currentState.state) {
            batch.unshift(...buildPhase11HullDestructionCommands($currentState.state));
        }
        if (meta.phase === 7 && entering.phase === 8 && $currentState.state) {
            const allocations = fighterAttackAllocations(
                $currentState.state,
                visibleCommands,
                meta.turn
            );
            const gunboatAllocations = gunboatAttackAllocations(
                $currentState.state,
                visibleCommands,
                meta.turn
            );
            const source = policyRollSource(meta.dicePolicy, { seed: meta.diceSeed });
            const { commands: interceptCmds, warnings: interceptWarnings } =
                buildAutoInterceptCommands($currentState.state, allocations, source);
            const gbIntercept = buildAutoGunboatInterceptCommands(
                $currentState.state,
                gunboatAllocations,
                source
            );
            batch.push(...interceptCmds, ...gbIntercept.commands);
            for (const w of [...interceptWarnings, ...gbIntercept.warnings]) toast.push(w);
        }
        if (
            meta.phase === 9 &&
            entering.phase === 10 &&
            $currentState.state &&
            !phase10StrikesCompleteInLog(visibleCommands, meta.turn)
        ) {
            const source = policyRollSource(meta.dicePolicy, { seed: meta.diceSeed });
            const { commands: strikeCmds, warnings: strikeWarnings } =
                buildPhase10ResolveCommands(
                    $currentState.state,
                    visibleCommands,
                    meta.turn,
                    source
                );
            batch.push(...strikeCmds);
            for (const w of strikeWarnings) toast.push(w);
        }
        if (batch.length === 1) {
            appendGameCommand(batch[0]);
        } else {
            appendGameCommands(batch);
        }
        if (entering.phase === 7) {
            appendGameCommand({ name: "proposeOrdnanceAllocations" } as import("@/schemas/commands").FullThrustGameCommand);
        }
        const enteringMeta = { ...meta, phase: entering.phase, turn: entering.turn };
        const kind = phaseAdvancePrompt(entering.phase, {
            meta: enteringMeta,
            position: $currentState.state ?? { map: { mode: "fixed", width: 72, height: 48 } },
            bankedEmpHits: $currentState.bankedEmpHits,
        });
        if (kind) {
            promptKind = kind;
            promptPhase = entering.phase;
        }
    };

</script>

{#if meta}
    <div class="box phase-bar">
        <div class="columns is-vcentered is-mobile">
            <div class="column">
                <p>
                    <strong>Turn {meta.turn}</strong>
                    —
                    Phase {meta.phase}: {phaseName(meta.phase as GamePhase)}
                    {#if modStatus?.segment}
                        — <strong>{modStatus.segment}</strong>
                        {#if modStatus.currentActivationId}
                            ({modStatus.currentActivationId})
                        {/if}
                    {/if}
                </p>
                {#if meta.initiative}
                    <p class="is-size-7">
                        Initiative winner: <strong>{meta.initiative.winner}</strong>
                        ({meta.initiative.rolls.map((r) => `${r.player}=${r.roll}`).join(", ")})
                    </p>
                {/if}
                {#if modStatus}
                    <p class="is-size-7">
                        Activation ({modStatus.activationLabel}):
                        {#if modStatus.activationOrder.length}
                            {modStatus.activationOrder.join(" → ")}
                        {:else}
                            —
                        {/if}
                    </p>
                    {#each modStatus.hints as hint}
                        <p class="is-size-7 mod-hint">{hint}</p>
                    {/each}
                {/if}
                {#if ($currentState.pendingMoves?.length ?? 0) > 0 && meta.phase < 5}
                    <p class="is-size-7 mod-hint">
                        {$currentState.pendingMoves?.length} movement order(s) recorded — ships
                        move in phase 5.
                    </p>
                {/if}
                <p class="is-size-7">Dice policy: {meta.dicePolicy}</p>
            </div>
            <div class="column is-narrow buttons">
                {#if isMod()}
                    {#if meta.phase === 5}
                        <button
                            class="button is-warning is-small"
                            on:click={() => (showPhase5Movement = true)}
                            disabled={!atHead || (!phase5CanResolve && !phase5NeedsDice)}
                        >
                            Resolve movement
                        </button>
                    {/if}
                    {#if isSegmentActivationPhase(meta.phase as GamePhase)}
                        <button
                            class="button is-link is-small"
                            on:click={nextStep}
                            disabled={!atHead}
                        >
                            Next step
                        </button>
                    {/if}
                    <button class="button is-info is-small" on:click={advance} disabled={!atHead}>
                        Advance Phase
                    </button>
                {/if}
            </div>
        </div>
        <ReplayScrubber
            {maxOffset}
            visibleCount={replayVisibleCount}
            replayTurn={meta.turn}
        />
    </div>
{/if}

{#if promptKind === "initiative"}
    <InitiativePrompt players={players} onClose={closePrompt} />
{:else if promptKind === "dice" && promptPhase !== null}
    <PhaseDicePrompt phase={promptPhase} onClose={closePrompt} />
{:else if promptKind === "emp" && meta}
    <EmpPhasePrompt
        {meta}
        onClose={closePrompt}
        onContinue={continueToThresholdPrompt}
    />
{:else if promptKind === "threshold" && meta}
    <ThresholdPhasePrompt meta={meta} onClose={closePrompt} />
{:else if promptKind === "reactor" && meta}
    <ReactorPhasePrompt meta={meta} onClose={closePrompt} />
{:else if showPhase5Movement && meta}
    <Phase5MovementPrompt meta={meta} onClose={closePrompt} />
{:else if showResolvePrompt && $currentState.meta}
    <ResolveSegmentPrompt
        phase={$currentState.meta.phase as GamePhase}
        meta={$currentState.meta}
        onClose={closePrompt}
    />
{/if}

<style>
    .phase-bar {
        margin-bottom: 0.75rem;
    }

    .mod-hint {
        color: #3850a4;
        margin-top: 0.15rem;
    }
</style>
