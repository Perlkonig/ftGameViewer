<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { currentState } from "@/stores/derivedState";
    import { commands } from "@/stores/writeCommands";
    import { headOffset } from "@/stores/writeHeadOffset";
    import {
        type FurballEngagement,
    } from "@/lib/game/fighterDogfight";
    import { fighterAttackAllocations } from "@/lib/game/fighterEngagement";
    import { gunboatAttackAllocations } from "@/lib/game/gunboatEngagement";
    import { validateDeclareFurball, uncoveredFurballGroups } from "@/lib/game/fighterPhase8";
    import {
        allSkirmishCards,
        buildDogfightEngagement,
        buildEngagementFromPairings,
        screeningBypassTargets,
        skirmishCoverage,
        sortSkirmishCards,
        type BypassAssignments,
        type FurballPairing,
        type FurballSkirmish,
    } from "@/lib/game/fighterScreening";
    import { isDeployedFighter } from "@/lib/game/fighterMove";
    import { fighterEndurance, isFighterExhausted } from "@/lib/game/fighterEndurance";
    import { appendGameCommand } from "@/lib/game/appendCommand";
    import { toast } from "@zerodevx/svelte-toast";
    import { fighterGroupOptionLabel, fighterGroupLabel } from "@/lib/game/fighterLabel";
    import { gunboatGroupOptionLabel, gunboatGroupLabel } from "@/lib/game/gunboatLabel";
    import { isDeployedGunboat } from "@/lib/game/gunboatMove";
    import ActError from "./ActError.svelte";
    import type { FullThrustGameCommand } from "@/schemas/commands";
    import type { FullThrustGamePosition, FullThrustGameObjects } from "@/schemas/position";
    import { focusMapOnFightersId } from "@/lib/actMapInteraction";

    const dispatch = createEventDispatcher();

    type SkirmishDraft = {
        lockedPairings: FurballPairing[];
        shipStrikeThroughIds: string[];
        fighterBypassByTarget: Record<string, string[]>;
        pendingAttacker: string;
        pendingDefenderIds: string[];
        quickA: string;
        quickB: string;
    };

    type FighterObj = Extract<
        NonNullable<FullThrustGamePosition["objects"]>[number],
        { objType: "fighters" }
    >;

    let showQuick = false;
    let drafts: Record<string, SkirmishDraft> = {};

    const emptyDraft = (): SkirmishDraft => ({
        lockedPairings: [],
        shipStrikeThroughIds: [],
        fighterBypassByTarget: {},
        pendingAttacker: "",
        pendingDefenderIds: [],
        quickA: "",
        quickB: "",
    });

    const getDraft = (id: string): SkirmishDraft => drafts[id] ?? emptyDraft();

    const setDraft = (id: string, patch: Partial<SkirmishDraft>) => {
        drafts = { ...drafts, [id]: { ...getDraft(id), ...patch } };
        const objects = ($currentState.state?.objects ?? []) as FullThrustGameObjects[];
        if (patch.quickA) focusMapOnFightersId(patch.quickA, objects);
        if (patch.quickB) focusMapOnFightersId(patch.quickB, objects);
        if (patch.pendingAttacker) focusMapOnFightersId(patch.pendingAttacker, objects);
    };

    $: turn = $currentState.meta?.turn ?? 1;
    $: visibleCommands = $commands.slice(0, Math.max(0, $commands.length - $headOffset));
    $: allocations =
        $currentState.state
            ? fighterAttackAllocations($currentState.state, visibleCommands, turn)
            : [];
    $: gunboatAllocations =
        $currentState.state
            ? gunboatAttackAllocations($currentState.state, visibleCommands, turn)
            : [];
    $: existingDeclarations = $currentState.phase8FurballDeclarations ?? [];
    $: bypassAssignments = buildBypassAssignments(drafts);
    $: skirmishes =
        $currentState.state
            ? allSkirmishCards(
                  $currentState.state,
                  allocations,
                  bypassAssignments,
                  existingDeclarations,
                  gunboatAllocations
              )
            : [];
    $: skirmishContext =
        $currentState.state != null
            ? { position: $currentState.state, allocations }
            : undefined;
    $: sortedSkirmishes = sortSkirmishCards(
        skirmishes,
        existingDeclarations,
        skirmishContext
    );
    $: coverage = skirmishCoverage(skirmishes, existingDeclarations, skirmishContext);
    $: uncoveredGroups =
        $currentState.state
            ? uncoveredFurballGroups(
                  $currentState.state,
                  allocations,
                  existingDeclarations,
                  gunboatAllocations
              )
            : [];
    $: primarySkirmishes = sortedSkirmishes.filter((s) => !s.parentSkirmishId);

    function buildBypassAssignments(d: Record<string, SkirmishDraft>): BypassAssignments {
        const out: BypassAssignments = {};
        for (const [skirmishId, draft] of Object.entries(d)) {
            if (Object.keys(draft.fighterBypassByTarget).length === 0) continue;
            out[skirmishId] = { ...draft.fighterBypassByTarget };
        }
        return out;
    }

    const fighterById = (id: string): FighterObj | undefined => {
        const obj = $currentState.state?.objects?.find((o) => o.id === id);
        return obj?.objType === "fighters" && isDeployedFighter(obj)
            ? (obj as FighterObj)
            : undefined;
    };

    const gunboatById = (id: string) => {
        const obj = $currentState.state?.objects?.find((o) => o.id === id);
        return obj?.objType === "gunboats" && isDeployedGunboat(obj) ? obj : undefined;
    };

    const participantLabel = (id: string) => {
        const f = fighterById(id);
        if (f) return fighterGroupLabel(f);
        const g = gunboatById(id);
        if (g) return gunboatGroupLabel(g as { id: string; callsign?: string });
        return id;
    };

    const fightersInSkirmish = (skirmish: FurballSkirmish, side: "attackers" | "defenders") => {
        const ids = side === "attackers" ? skirmish.attackerIds : skirmish.defenderIds;
        return ids.map((id) => fighterById(id)).filter((f): f is FighterObj => !!f);
    };

    const participantsInSkirmish = (skirmish: FurballSkirmish, side: "attackers" | "defenders") => {
        const ids = side === "attackers" ? skirmish.attackerIds : skirmish.defenderIds;
        return ids.map((id) => ({ id, label: participantLabel(id) }));
    };

    const assignedAttackers = (skirmish: FurballSkirmish, draft: SkirmishDraft): Set<string> => {
        const s = new Set<string>();
        for (const p of draft.lockedPairings) s.add(p.attackerId);
        for (const id of draft.shipStrikeThroughIds) s.add(id);
        for (const ids of Object.values(draft.fighterBypassByTarget)) {
            for (const id of ids) s.add(id);
        }
        return s;
    };

    const remainingAttackers = (skirmish: FurballSkirmish, draft: SkirmishDraft): string[] => {
        const used = assignedAttackers(skirmish, draft);
        return skirmish.attackerIds.filter((id) => !used.has(id));
    };

    /** Defenders stay in the target pool — multiple attackers may engage the same defender. */
    const defenderPool = (skirmish: FurballSkirmish): string[] => skirmish.defenderIds;

    const allScreenersPaired = (skirmish: FurballSkirmish, draft: SkirmishDraft): boolean => {
        const engaged = new Set(draft.lockedPairings.flatMap((p) => p.defenderIds));
        return skirmish.defenderIds.every((id) => engaged.has(id));
    };

    const togglePendingDefender = (skirmishId: string, defenderId: string) => {
        const d = getDraft(skirmishId);
        const pendingDefenderIds = d.pendingDefenderIds.includes(defenderId)
            ? d.pendingDefenderIds.filter((x) => x !== defenderId)
            : [...d.pendingDefenderIds, defenderId];
        setDraft(skirmishId, { pendingDefenderIds });
    };

    const addPairing = (skirmish: FurballSkirmish) => {
        const d = getDraft(skirmish.id);
        if (!d.pendingAttacker || d.pendingDefenderIds.length === 0) {
            toast.push("Select an attacker and at least one defender");
            return;
        }
        setDraft(skirmish.id, {
            lockedPairings: [
                ...d.lockedPairings,
                { attackerId: d.pendingAttacker, defenderIds: [...d.pendingDefenderIds] },
            ],
            pendingAttacker: "",
            pendingDefenderIds: [],
        });
    };

    const removePairing = (skirmishId: string, index: number) => {
        const d = getDraft(skirmishId);
        setDraft(skirmishId, {
            lockedPairings: d.lockedPairings.filter((_, i) => i !== index),
        });
    };

    const addAllVsAll = (skirmish: FurballSkirmish) => {
        const d = getDraft(skirmish.id);
        const atk = remainingAttackers(skirmish, d);
        const def = defenderPool(skirmish);
        if (atk.length === 0 || def.length === 0) {
            toast.push("No remaining attackers or defenders");
            return;
        }
        const newPairings: FurballPairing[] = atk.map((attackerId) => ({
            attackerId,
            defenderIds: [...def],
        }));
        setDraft(skirmish.id, {
            lockedPairings: [...d.lockedPairings, ...newPairings],
            pendingAttacker: "",
            pendingDefenderIds: [],
        });
    };

    const applyEvenSplit = (skirmish: FurballSkirmish) => {
        if (skirmish.kind !== "screening") return;
        const screeners = [...skirmish.defenderIds];
        const attackers = [...skirmish.attackerIds];
        const pairings: FurballPairing[] = [];
        let si = 0;
        for (let ai = 0; ai < attackers.length && si < screeners.length; ai++, si++) {
            pairings.push({ attackerId: attackers[ai], defenderIds: [screeners[si]] });
        }
        const shipStrikeThroughIds: string[] = [];
        const fighterBypassByTarget: Record<string, string[]> = {};
        const protectedTarget = skirmish.protectedTarget;
        if (protectedTarget && $currentState.state) {
            const bypassTargets = screeningBypassTargets($currentState.state, protectedTarget);
            for (let ai = si; ai < attackers.length; ai++) {
                const extra = attackers[ai];
                if (protectedTarget.targetType === "ship") {
                    shipStrikeThroughIds.push(extra);
                } else {
                    fighterBypassByTarget[protectedTarget.targetId] ??= [];
                    fighterBypassByTarget[protectedTarget.targetId].push(extra);
                }
            }
            void bypassTargets;
        }
        setDraft(skirmish.id, {
            lockedPairings: pairings,
            shipStrikeThroughIds,
            fighterBypassByTarget,
            pendingAttacker: "",
            pendingDefenderIds: [],
        });
        toast.push("Even split applied");
    };

    const toggleShipBypass = (skirmishId: string, attackerId: string) => {
        const d = getDraft(skirmishId);
        const shipStrikeThroughIds = d.shipStrikeThroughIds.includes(attackerId)
            ? d.shipStrikeThroughIds.filter((x) => x !== attackerId)
            : [...d.shipStrikeThroughIds, attackerId];
        setDraft(skirmishId, { shipStrikeThroughIds });
    };

    const toggleFighterBypass = (
        skirmishId: string,
        targetId: string,
        attackerId: string
    ) => {
        const d = getDraft(skirmishId);
        const current = d.fighterBypassByTarget[targetId] ?? [];
        const next = current.includes(attackerId)
            ? current.filter((x) => x !== attackerId)
            : [...current, attackerId];
        const fighterBypassByTarget = { ...d.fighterBypassByTarget };
        if (next.length === 0) delete fighterBypassByTarget[targetId];
        else fighterBypassByTarget[targetId] = next;
        setDraft(skirmishId, { fighterBypassByTarget });
    };

    const autoFillQuickDraft = (skirmish: FurballSkirmish) => {
        const d = getDraft(skirmish.id);
        if (d.quickA && d.quickB) return;
        const a = skirmish.attackerIds[0] ?? "";
        const b = skirmish.defenderIds[0] ?? "";
        if (a || b) setDraft(skirmish.id, { quickA: a, quickB: b });
    };

    $: if (showQuick && primarySkirmishes.filter((s) => !coverage.get(s.id)).length === 1) {
        const open = primarySkirmishes.find((s) => !coverage.get(s.id));
        if (open) autoFillQuickDraft(open);
    }

    const buildEngagement = (skirmish: FurballSkirmish): FurballEngagement | null => {
        const d = getDraft(skirmish.id);
        if (showQuick && skirmish.kind === "dogfight" && !skirmish.parentSkirmishId) {
            if (!d.quickA || !d.quickB || d.quickA === d.quickB) return null;
            if (!skirmish.attackerIds.includes(d.quickA)) return null;
            if (!skirmish.defenderIds.includes(d.quickB)) return null;
            return {
                attackers: [{ id: d.quickA, targetIds: [d.quickB] }],
                defenders: [{ id: d.quickB, targetIds: [d.quickA] }],
            };
        }
        if (skirmish.kind === "screening") {
            if (d.lockedPairings.length === 0 && d.shipStrikeThroughIds.length === 0) return null;
            return buildEngagementFromPairings(
                d.lockedPairings,
                d.shipStrikeThroughIds,
                skirmish.protectedTarget
            );
        }
        if (skirmish.kind === "derived" || skirmish.kind === "dogfight") {
            if (d.lockedPairings.length > 0) {
                return buildDogfightEngagement(d.lockedPairings);
            }
            if (skirmish.attackerIds.length > 0 && skirmish.defenderIds.length > 0) {
                const pairings: FurballPairing[] = skirmish.attackerIds.map((aid) => ({
                    attackerId: aid,
                    defenderIds: [...skirmish.defenderIds],
                }));
                return buildDogfightEngagement(pairings);
            }
        }
        return null;
    };

    const validationFor = (skirmish: FurballSkirmish, pendingDecls: FurballEngagement[]) => {
        const eng = buildEngagement(skirmish);
        if (!eng || !$currentState.state) return [];
        return validateDeclareFurball(
            $currentState.state,
            eng,
            [...existingDeclarations, ...pendingDecls],
            allocations,
            gunboatAllocations
        );
    };

    const derivedForParent = (parentId: string): FurballSkirmish[] =>
        skirmishes.filter((s) => s.parentSkirmishId === parentId);

    const submitSkirmish = (skirmish: FurballSkirmish) => {
        if (!$currentState.state) return;
        const toSubmit: { skirmish: FurballSkirmish; eng: FurballEngagement }[] = [];

        const parentEng = buildEngagement(skirmish);
        if (skirmish.kind === "screening" && parentEng) {
            toSubmit.push({ skirmish, eng: parentEng });
            for (const derived of derivedForParent(skirmish.id)) {
                if (coverage.get(derived.id)) continue;
                const eng = buildEngagement(derived);
                if (eng) toSubmit.push({ skirmish: derived, eng });
            }
        } else if (skirmish.kind === "derived") {
            const eng = buildEngagement(skirmish);
            if (eng) toSubmit.push({ skirmish, eng });
        } else {
            const eng = buildEngagement(skirmish);
            if (eng) toSubmit.push({ skirmish, eng });
        }

        if (toSubmit.length === 0) {
            toast.push("Add at least one pairing or strike-through");
            return;
        }

        let pending: FurballEngagement[] = [];
        for (const { skirmish: sk, eng } of toSubmit) {
            const issues = validateDeclareFurball(
                $currentState.state,
                eng,
                [...existingDeclarations, ...pending],
                allocations,
                gunboatAllocations
            );
            const errors = issues.filter((i) => i.severity === "error");
            if (errors.length) {
                toast.push(`${sk.label}: ${errors[0].message}`);
                return;
            }
            for (const issue of issues) {
                if (issue.severity === "warning") toast.push(issue.message);
            }
            pending = [...pending, eng];
        }

        for (const { skirmish: sk, eng } of toSubmit) {
            appendGameCommand({
                name: "declareFurball",
                engagement: eng,
            } as FullThrustGameCommand);
            const next = { ...drafts };
            delete next[sk.id];
            drafts = next;
            toast.push(`Furball declared: ${sk.label}`);
        }
        dispatch("done");
    };

    const rosterLine = (skirmish: FurballSkirmish): string => {
        const fmt = (ids: string[]) =>
            ids
                .map((id) => {
                    const f = fighterById(id);
                    return f ? fighterGroupOptionLabel(f) : id;
                })
                .join(", ");
        return `Attackers: ${fmt(skirmish.attackerIds) || "—"} · Defenders: ${fmt(skirmish.defenderIds) || "—"}`;
    };

    const formatGroupId = (id: string): string => {
        const f = fighterById(id);
        return f ? fighterGroupLabel(f) : id;
    };

    const formatEngagementSummary = (eng: FurballEngagement): string => {
        const parts = eng.attackers.map((a) => {
            const targets = a.targetIds.map((t) => formatGroupId(t)).join(", ");
            return `${formatGroupId(a.id)} → ${targets}`;
        });
        return parts.join(" · ") || "—";
    };

    const draftHasContent = (skirmishId: string): boolean => {
        const d = getDraft(skirmishId);
        if (d.quickA || d.quickB) return true;
        return (
            d.lockedPairings.length > 0 ||
            d.shipStrikeThroughIds.length > 0 ||
            Object.keys(d.fighterBypassByTarget).length > 0
        );
    };
</script>

<p class="help">
    Phase 8 — organize furball engagements by skirmish (no dice). Ordnance intercepts were
    resolved automatically when this phase began.
</p>

{#if existingDeclarations.length > 0}
    <div class="box mb-3">
        <p class="label">Declared this phase ({existingDeclarations.length})</p>
        <ul class="help">
            {#each existingDeclarations as decl, i}
                <li>#{i + 1}: {formatEngagementSummary(decl)}</li>
            {/each}
        </ul>
    </div>
{/if}

{#if uncoveredGroups.length > 0}
    <p class="notification is-warning is-light mb-3">
        Groups still needing a furball declaration: {uncoveredGroups.map((id) => formatGroupId(id)).join(", ")}
    </p>
{/if}

{#if skirmishes.length === 0}
    <p class="notification is-info is-light">No furball skirmishes this phase.</p>
{:else}
    <label class="checkbox mb-3">
        <input type="checkbox" bind:checked={showQuick} />
        Use quick 1v1 mode (simple dogfights only)
    </label>

    {#each primarySkirmishes as skirmish (skirmish.id)}
        {@const declared = coverage.get(skirmish.id) ?? false}
        {@const derivedCards = derivedForParent(skirmish.id)}
        <div class="box skirmish-card mb-3" class:is-declared={declared}>
            <div class="is-flex is-justify-content-space-between is-align-items-flex-start">
                <div>
                    <p class="title is-6 mb-1">{skirmish.label}</p>
                    <p class="help mb-2">{skirmish.hint}</p>
                    <p class="is-size-7">{rosterLine(skirmish)}</p>
                </div>
                <span class="tag" class:is-success={declared} class:is-warning={!declared}>
                    {declared ? "Declared" : "Needs declaration"}
                </span>
            </div>

            {#if declared}
                <details class="mt-2">
                    <summary class="is-size-7">Show details</summary>
                    <p class="help mt-1">All groups in this skirmish are covered by a declaration.</p>
                </details>
            {:else if showQuick && skirmish.kind === "dogfight"}
                {#key drafts[skirmish.id]}
                    {@const draft = getDraft(skirmish.id)}
                    {@const issues = validationFor(skirmish, [])}
                    <div class="columns mt-2">
                        <div class="column">
                            <div class="select is-fullwidth">
                                <select
                                    value={draft.quickA}
                                    on:change={(e) =>
                                        setDraft(skirmish.id, {
                                            quickA: (e.currentTarget as HTMLSelectElement).value,
                                        })}
                                >
                                    <option value="">Attacker group</option>
                                    {#each participantsInSkirmish(skirmish, "attackers") as p}
                                        <option value={p.id}>{p.label}</option>
                                    {/each}
                                </select>
                            </div>
                        </div>
                        <div class="column">
                            <div class="select is-fullwidth">
                                <select
                                    value={draft.quickB}
                                    on:change={(e) =>
                                        setDraft(skirmish.id, {
                                            quickB: (e.currentTarget as HTMLSelectElement).value,
                                        })}
                                >
                                    <option value="">Defender group</option>
                                    {#each participantsInSkirmish(skirmish, "defenders") as p}
                                        <option value={p.id}>{p.label}</option>
                                    {/each}
                                </select>
                            </div>
                        </div>
                    </div>
                    <ActError {issues} />
                    <button
                        type="button"
                        class="button is-primary mt-2"
                        on:click={() => submitSkirmish(skirmish)}
                    >
                        Declare this skirmish
                    </button>
                {/key}
            {:else}
                {#key drafts[skirmish.id]}
                    {@const draft = getDraft(skirmish.id)}
                    {@const remAtk = remainingAttackers(skirmish, draft)}
                    {@const defPool = defenderPool(skirmish)}
                    {@const screenersDone = skirmish.kind !== "screening" || allScreenersPaired(skirmish, draft)}
                    {@const issues = validationFor(skirmish, [])}
                    {@const bypassTargets =
                        skirmish.kind === "screening" &&
                        skirmish.protectedTarget &&
                        $currentState.state
                            ? screeningBypassTargets($currentState.state, skirmish.protectedTarget)
                            : []}

                    <div class="buttons are-small mt-2">
                        <button type="button" class="button is-light" on:click={() => addAllVsAll(skirmish)}>
                            All vs all
                        </button>
                        {#if skirmish.kind === "screening"}
                            <button type="button" class="button is-light" on:click={() => applyEvenSplit(skirmish)}>
                                Even split
                            </button>
                        {/if}
                    </div>

                    {#if draft.lockedPairings.length > 0}
                        <p class="label mt-2 mb-1">Locked pairings</p>
                        <ul class="help mb-2">
                            {#each draft.lockedPairings as pairing, i}
                                <li>
                                    {formatGroupId(pairing.attackerId)} →
                                    {pairing.defenderIds.map((id) => formatGroupId(id)).join(", ")}
                                    <button
                                        type="button"
                                        class="button is-small is-text"
                                        on:click={() => removePairing(skirmish.id, i)}
                                    >×</button>
                                </li>
                            {/each}
                        </ul>
                    {/if}

                    {#if remAtk.length > 0 && defPool.length > 0}
                        <p class="label mt-2 mb-1">Add pairing</p>
                        <p class="help is-size-7 mb-1">
                            Remaining attackers: {remAtk.map((id) => formatGroupId(id)).join(", ")}
                        </p>
                        <div class="field">
                            <div class="select is-fullwidth">
                                <select
                                    value={draft.pendingAttacker}
                                    on:change={(e) =>
                                        setDraft(skirmish.id, {
                                            pendingAttacker: (e.currentTarget as HTMLSelectElement).value,
                                            pendingDefenderIds: [],
                                        })}
                                >
                                    <option value="">Attacker</option>
                                    {#each remAtk as aid}
                                        <option value={aid}>{formatGroupId(aid)}</option>
                                    {/each}
                                </select>
                            </div>
                        </div>
                        {#if draft.pendingAttacker}
                            <p class="help is-size-7">Targets (one or more; defenders can be selected again for other attackers):</p>
                            {#each defPool as did}
                                <label class="checkbox is-block">
                                    <input
                                        type="checkbox"
                                        checked={draft.pendingDefenderIds.includes(did)}
                                        on:change={() => togglePendingDefender(skirmish.id, did)}
                                    />
                                    {formatGroupId(did)}
                                </label>
                            {/each}
                            <button type="button" class="button is-small is-link mt-1" on:click={() => addPairing(skirmish)}>
                                Add pairing
                            </button>
                        {/if}
                    {/if}

                    {#if skirmish.kind === "screening" && screenersDone && bypassTargets.length > 0}
                        <p class="label mt-3 mb-1">Strike-through</p>
                        {#each bypassTargets as bt}
                            {#if bt.targetType === "ship"}
                                <p class="help is-size-7 mb-1">Bypass to ship {bt.targetId}</p>
                                {#each remAtk as aid}
                                    <label class="checkbox is-block">
                                        <input
                                            type="checkbox"
                                            checked={draft.shipStrikeThroughIds.includes(aid)}
                                            on:change={() => toggleShipBypass(skirmish.id, aid)}
                                        />
                                        {formatGroupId(aid)} → ship {bt.targetId}
                                    </label>
                                {/each}
                            {:else}
                                <p class="help is-size-7 mb-1">Bypass to {formatGroupId(bt.targetId)}</p>
                                {#each remainingAttackers(skirmish, {
                                    ...draft,
                                    fighterBypassByTarget: {
                                        ...draft.fighterBypassByTarget,
                                        [bt.targetId]: [],
                                    },
                                }) as aid}
                                    <label class="checkbox is-block">
                                        <input
                                            type="checkbox"
                                            checked={(draft.fighterBypassByTarget[bt.targetId] ?? []).includes(aid)}
                                            on:change={() => toggleFighterBypass(skirmish.id, bt.targetId, aid)}
                                        />
                                        {formatGroupId(aid)} → {formatGroupId(bt.targetId)}
                                    </label>
                                {/each}
                            {/if}
                        {/each}
                    {/if}

                    {#if draftHasContent(skirmish.id)}
                        {@const preview = buildEngagement(skirmish)}
                        {#if preview}
                            <p class="notification is-info is-light is-size-7 mt-2 mb-2">
                                Preview: {formatEngagementSummary(preview)}
                            </p>
                        {/if}
                    {/if}

                    <ActError {issues} />

                    <button
                        type="button"
                        class="button is-primary mt-2"
                        on:click={() => submitSkirmish(skirmish)}
                    >
                        Declare {skirmish.kind === "screening" && derivedCards.length > 0 ? "(+ linked bypass)" : "this skirmish"}
                    </button>
                {/key}

                {#each derivedCards as derived (derived.id)}
                    {@const dDeclared = coverage.get(derived.id) ?? false}
                    {#if !dDeclared}
                        {#key drafts[derived.id]}
                            {@const dDraft = getDraft(derived.id)}
                            {@const dIssues = validationFor(derived, [])}
                            <div class="box derived-card mt-2 ml-4">
                                <p class="title is-6 mb-1">{derived.label}</p>
                                <p class="help mb-2">{derived.hint}</p>
                                {#if buildEngagement(derived)}
                                    <p class="is-size-7">
                                        {formatEngagementSummary(buildEngagement(derived)!)}
                                    </p>
                                {/if}
                                <ActError issues={dIssues} />
                                <button
                                    type="button"
                                    class="button is-small is-primary mt-1"
                                    on:click={() => submitSkirmish(derived)}
                                >
                                    Declare bypass dogfight
                                </button>
                            </div>
                        {/key}
                    {/if}
                {/each}
            {/if}
        </div>
    {/each}
{/if}

<style>
    .skirmish-card.is-declared {
        opacity: 0.65;
    }
    .derived-card {
        border-left: 3px solid #3273dc;
    }
</style>
