<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { currentState } from "@/stores/derivedState";
    import { commands } from "@/stores/writeCommands";
    import { proposalCommands } from "@/stores/writeProposalCommands";
    import { headOffset } from "@/stores/writeHeadOffset";
    import {
        declaredPointDefenseFromCommands,
        expandPointDefenseAllocations,
        groupPdMountsByProfile,
        phase9ThreatBoard,
        pointDefenseFighterTargetWarnings,
        pointDefenseSupportIssues,
        remainingPdMountsForDefender,
        validatePointDefenseAllocationBatch,
        type PointDefenseDeclaration,
        type ThreatProfileAllocation,
    } from "@/lib/game/pointDefensePhase9";
    import { pointDefenseProfileLabel } from "@/lib/game/pointDefenseProfiles";
    import { type ShipGameState } from "@/lib/game/shipSystems";
    import { fighterGroupLabel } from "@/lib/game/fighterLabel";
    import { gunboatGroupLabel } from "@/lib/game/gunboatLabel";
    import { isGunboatPointDefenseDefender } from "@/lib/game/gunboatPointDefense";
    import { isHostileThreatToProtectedShip } from "@/lib/game/incomingThreats";
    import { appendGameCommands } from "@/lib/game/appendCommand";
    import { toast } from "@zerodevx/svelte-toast";
    import { userSettings } from "@/stores/writeUserSettings";
    import ActError from "./ActError.svelte";
    import type { FullThrustGameCommand } from "@/schemas/commands";
    import type { PointDefenseProfile } from "@/lib/game/pointDefenseProfiles";
    import type { ValidationIssue } from "@/lib/game/commandValidation";
    import { focusMapOnShipId, focusMapOnObjectId } from "@/lib/actMapInteraction";

    const dispatch = createEventDispatcher();

    let defenderShipId = "";
    let supportedShipId = "";
    let prevDefenderShipId = "";
    let prevSupportedShipId = "";
    let adsMode: "long" | "split" | "" = "";
    let threatCounts: Record<string, Partial<Record<PointDefenseProfile, number>>> = {};

    $: turn = $currentState.meta?.turn ?? 1;
    $: visibleCommands = $commands.slice(0, Math.max(0, $commands.length - $headOffset));
    $: replayCommands = [...visibleCommands, ...$proposalCommands];
    $: furballDeclarations = $currentState.phase8FurballDeclarations;
    $: pdValidationOptions = {
        adsMode: adsMode || undefined,
        furballDeclarations,
    };
    $: position = $currentState.state;
    $: ships =
        position?.objects?.filter((o) => o.objType === "ship" && o.position) ?? [];
    $: pdGunboatDefenders =
        position?.objects?.filter(
            (o) =>
                o.objType === "gunboats" &&
                isGunboatPointDefenseDefender(position!, o.id)
        ) ?? [];
    $: board =
        position
            ? phase9ThreatBoard(position, replayCommands, turn, { furballDeclarations })
            : null;
    $: declared = [
        ...($currentState.phase9PdDeclarations ?? []),
        ...declaredPointDefenseFromCommands($proposalCommands, turn, 9),
    ];

    $: defender = ships.find((s) => s.id === defenderShipId) as ShipGameState | undefined;
    $: defenderIsGunboat =
        !!(position && defenderShipId && isGunboatPointDefenseDefender(position, defenderShipId));
    $: if (defenderShipId && defenderShipId !== prevDefenderShipId) {
        prevDefenderShipId = defenderShipId;
        if (defenderIsGunboat) {
            focusMapOnObjectId(defenderShipId);
        } else {
            focusMapOnShipId(
                defenderShipId,
                ships as import("@/schemas/position").FullThrustGameObjects[]
            );
        }
    }
    $: if (supportedShipId && supportedShipId !== prevSupportedShipId) {
        prevSupportedShipId = supportedShipId;
        focusMapOnShipId(
            supportedShipId,
            ships as import("@/schemas/position").FullThrustGameObjects[]
        );
    }
    $: if (defenderShipId && defenderIsGunboat && supportedShipId === defenderShipId) {
        supportedShipId = "";
    }
    $: if (defenderShipId && !defenderIsGunboat && !supportedShipId) {
        supportedShipId = defenderShipId;
    }

    $: remainingMounts =
        position && defenderShipId
            ? remainingPdMountsForDefender(position, defenderShipId, declared)
            : [];
    $: profileColumns = groupPdMountsByProfile(remainingMounts);
    $: hasAdsMounts = profileColumns.some((c) => c.profile === "ads");

    $: threatOptions = (() => {
        if (!board || !supportedShipId || !position) return [];
        const hostile = (threatId: string) =>
            isHostileThreatToProtectedShip(position, threatId, supportedShipId);
        const bucket = board.byProtectedShip.get(supportedShipId);
        const out: {
            id: string;
            label: string;
            kind: "shipAttack" | "ordnance" | "unengaged";
        }[] = [];
        if (bucket) {
            for (const f of bucket.fighters) {
                if (!hostile(f.groupId)) continue;
                const obj = position.objects?.find((o) => o.id === f.groupId);
                const label =
                    obj?.objType === "fighters"
                        ? `${fighterGroupLabel(obj as { id: string; callsign?: string })} ×${f.number}`
                        : f.groupId;
                out.push({ id: f.groupId, label: `Fighters: ${label}`, kind: "shipAttack" });
            }
            for (const g of bucket.gunboats ?? []) {
                if (!hostile(g.groupId)) continue;
                const obj = position.objects?.find((o) => o.id === g.groupId);
                const label =
                    obj?.objType === "gunboats"
                        ? `${gunboatGroupLabel(obj as { id: string; callsign?: string })} ×${g.number}`
                        : g.groupId;
                out.push({ id: g.groupId, label: `Gunboats: ${label}`, kind: "shipAttack" });
            }
            for (const o of bucket.ordnance) {
                if (!hostile(o.ordnanceId)) continue;
                out.push({
                    id: o.ordnanceId,
                    label: `Ordnance: ${o.type} → ${o.targetShipId}${o.salvoCount != null ? ` (${o.salvoCount})` : ""}`,
                    kind: "ordnance",
                });
            }
        }
        for (const f of board.fighters.filter((x) => x.kind === "unengaged")) {
            if (!hostile(f.groupId)) continue;
            const obj = position.objects?.find((o) => o.id === f.groupId);
            const label =
                obj?.objType === "fighters"
                    ? `${fighterGroupLabel(obj as { id: string; callsign?: string })} (unengaged)`
                    : f.groupId;
            out.push({ id: f.groupId, label, kind: "unengaged" });
        }
        return out;
    })();

    /** Force Svelte 5 to re-run draft/warning reactives when allocation counts change. */
    $: threatCountsKey = JSON.stringify(threatCounts);

    $: draftAllocations = (() => {
        threatCountsKey;
        return buildDraftAllocations();
    })();

    $: supportIssues =
        position && defenderShipId && supportedShipId
            ? pointDefenseSupportIssues(
                  position,
                  defenderShipId,
                  supportedShipId,
                  declared,
                  { commands: replayCommands, turn }
              )
            : [];

    $: validationIssues = (() => {
        threatCountsKey;
        if (!position || !defenderShipId) {
            return supportIssues;
        }
        if (draftAllocations.length === 0) {
            return supportIssues;
        }
        return validatePointDefenseAllocationBatch(
            position,
            defenderShipId,
            supportedShipId || defenderShipId,
            remainingMounts,
            draftAllocations,
            declared,
            replayCommands,
            turn,
            pdValidationOptions
        );
    })();

    $: formWarnings = [
        ...supportIssues.filter((i) => i.severity === "warning"),
        ...draftTargetWarnings,
    ];

    $: inlineAllocationWarnings = (() => {
        threatCountsKey;
        const warnings: { threatId: string; message: string }[] = [];
        for (const threat of threatOptions) {
            const row = threatCounts[threat.id] ?? {};
            const allocated = Object.values(row).reduce((sum, n) => sum + (n ?? 0), 0);
            if (allocated <= 0) continue;
            if (threat.kind === "unengaged") {
                warnings.push({
                    threatId: threat.id,
                    message: `${threat.label} is unengaged — point defense has no effect against unengaged fighters.`,
                });
                continue;
            }
            if (position && board) {
                for (const issue of pointDefenseFighterTargetWarnings(position, board, threat.id)) {
                    warnings.push({ threatId: threat.id, message: issue.message });
                }
            }
        }
        return warnings;
    })();

    $: draftTargetWarnings = inlineAllocationWarnings.map((w) => ({
        message: w.message,
        severity: "warning" as const,
    }));

    $: {
        const next = { ...threatCounts };
        let changed = false;
        for (const threat of threatOptions) {
            if (!next[threat.id]) {
                next[threat.id] = {};
                changed = true;
            }
            for (const col of profileColumns) {
                if (next[threat.id][col.profile] === undefined) {
                    next[threat.id][col.profile] = 0;
                    changed = true;
                }
            }
        }
        if (changed) threatCounts = next;
    }

    $: totalByProfile = (() => {
        threatCountsKey;
        const totals: Partial<Record<PointDefenseProfile, number>> = {};
        for (const threat of threatOptions) {
            const row = threatCounts[threat.id] ?? {};
            for (const col of profileColumns) {
                const n = row[col.profile] ?? 0;
                if (n > 0) totals[col.profile] = (totals[col.profile] ?? 0) + n;
            }
        }
        return totals;
    })();

    const inlineWarningForThreat = (threatId: string): string | undefined =>
        inlineAllocationWarnings.find((w) => w.threatId === threatId)?.message;

    function buildDraftAllocations(): ThreatProfileAllocation[] {
        return threatOptions
            .map((threat) => {
                const row = threatCounts[threat.id] ?? {};
                const byProfile: Partial<Record<PointDefenseProfile, number>> = {};
                for (const col of profileColumns) {
                    const n = row[col.profile] ?? 0;
                    if (n > 0) byProfile[col.profile] = n;
                }
                return { threatId: threat.id, byProfile };
            })
            .filter((a) => Object.values(a.byProfile).some((n) => (n ?? 0) > 0));
    }

    const setCount = (threatId: string, profile: PointDefenseProfile, value: number) => {
        const row = { ...(threatCounts[threatId] ?? {}) };
        row[profile] = Math.max(0, Math.round(Number(value) || 0));
        threatCounts = { ...threatCounts, [threatId]: row };
    };

    const resetDraft = () => {
        const cleared: typeof threatCounts = {};
        for (const threat of threatOptions) {
            cleared[threat.id] = {};
            for (const col of profileColumns) {
                cleared[threat.id][col.profile] = 0;
            }
        }
        threatCounts = cleared;
    };

    const summarizeDeclared = (decls: PointDefenseDeclaration[]) => {
        const groups = new Map<string, number>();
        for (const d of decls) {
            const key = `${d.defenderShip} → ${d.threatId} (${pointDefenseProfileLabel(d.profile)})`;
            groups.set(key, (groups.get(key) ?? 0) + 1);
        }
        return [...groups.entries()].map(([key, count]) => `${count}× ${key}`);
    };

    const submit = () => {
        if (!position || !defenderShipId) {
            toast.push("Select a defending ship or PDS/ADS gunboat squadron");
            return;
        }
        const supportErrors = supportIssues.filter((i) => i.severity === "error");
        if (supportErrors.length) {
            toast.push(supportErrors[0].message);
            return;
        }
        const allocations = buildDraftAllocations();
        if (allocations.length === 0) {
            toast.push("Allocate at least one weapon to a threat");
            return;
        }
        const issues = validationIssues;
        const errors = issues.filter((i) => i.severity === "error");
        if (errors.length) {
            toast.push(errors[0].message);
            return;
        }
        for (const message of [
            ...new Set(issues.filter((i) => i.severity === "warning").map((i) => i.message)),
        ]) {
            toast.push(message);
        }
        const expanded = expandPointDefenseAllocations(
            defenderShipId,
            supportedShipId || defenderShipId,
            remainingMounts,
            allocations,
            { adsMode: adsMode || undefined }
        );
        const cmds = expanded.map(
            (decl) => ({ name: "declarePointDefense", ...decl }) as FullThrustGameCommand
        );
        appendGameCommands(cmds, ($userSettings.role ?? "player") === "moderator");
        const hadWarnings = issues.some((i) => i.severity === "warning");
        toast.push(
            hadWarnings
                ? `Logged ${expanded.length} point defense allocation(s) (see warnings)`
                : `Logged ${expanded.length} point defense allocation(s)`
        );
        resetDraft();
        dispatch("done");
    };
</script>

<p class="help">
    Allocate point-defense mounts against incoming threats. Assign multiple weapons to the same
    target (e.g. 4 PDS vs one wing, 2 vs another). Ships under direct attack always use their own
    PD. With ADFC/AADFC (or PDS/ADS gunboats), a defender may also engage threats against allied
    ships within 6 MU (one allied ship for standard ADFC / PDS gunboat; any number for AADFC).
</p>

{#if board && board.forfeitedShipAttackers.length > 0}
    <p class="notification is-info is-light is-size-7">
        Not PD-eligible (fought screeners without bypass):
        {board.forfeitedShipAttackers.join(", ")}
    </p>
{/if}

{#if declared.length > 0}
    <div class="box mb-3">
        <p class="label">Declared ({declared.length} mount{declared.length === 1 ? "" : "s"})</p>
        <ul class="help">
            {#each summarizeDeclared(declared) as line}
                <li>{line}</li>
            {/each}
        </ul>
    </div>
{/if}

<div class="field">
    <label class="label" for="pdShip">Defender (ship or PDS/ADS gunboats)</label>
    <div class="select is-fullwidth">
        <select id="pdShip" bind:value={defenderShipId}>
            <option value="">--</option>
            <optgroup label="Ships">
                {#each ships as s}
                    <option value={s.id}>{s.id}</option>
                {/each}
            </optgroup>
            {#if pdGunboatDefenders.length > 0}
                <optgroup label="PDS / ADS gunboats">
                    {#each pdGunboatDefenders as g}
                        <option value={g.id}>{gunboatGroupLabel(g)}</option>
                    {/each}
                </optgroup>
            {/if}
        </select>
    </div>
</div>

{#if defenderShipId && (defender || defenderIsGunboat)}
    <div class="field">
        <label class="label" for="pdSupported">Ship under attack (supported)</label>
        <div class="select is-fullwidth">
            <select id="pdSupported" bind:value={supportedShipId}>
                {#each ships as s}
                    <option value={s.id}>{s.id}</option>
                {/each}
            </select>
        </div>
    </div>

    {#if supportIssues.length > 0}
        <ActError issues={supportIssues} />
    {/if}

    {#if remainingMounts.length === 0}
        <p class="notification is-warning is-light">
            All point-defense mounts on {defenderShipId} are already allocated this phase.
        </p>
    {:else}
        <p class="help mb-3">
            <strong>Available:</strong>
            {#each profileColumns as col, i}
                {col.mounts.length}× {col.label}{i < profileColumns.length - 1 ? ", " : ""}
            {/each}
        </p>

        {#if hasAdsMounts}
            <div class="field">
                <label class="label" for="adsMode">ADS mode</label>
                <div class="select">
                    <select id="adsMode" bind:value={adsMode}>
                        <option value="">6 MU (default)</option>
                        <option value="long">12 MU single shot</option>
                    </select>
                </div>
            </div>
        {/if}

        {#if threatOptions.length === 0}
            <p class="notification is-info is-light">No valid threats for {supportedShipId}.</p>
        {:else}
            {#if formWarnings.length > 0}
                <div class="notification is-warning is-light mb-3">
                    <p class="label mb-1">Warnings</p>
                    <ul class="help mb-0">
                        {#each formWarnings as issue}
                            <li>{issue.message}</li>
                        {/each}
                    </ul>
                </div>
            {/if}
            <div class="table-container mb-3">
                <table class="table is-narrow is-fullwidth is-size-7">
                    <thead>
                        <tr>
                            <th>Threat</th>
                            {#each profileColumns as col}
                                <th class="has-text-centered">{col.label}</th>
                            {/each}
                        </tr>
                    </thead>
                    <tbody>
                        {#each threatOptions as threat (threat.id + (threatCounts[threat.id] ? JSON.stringify(threatCounts[threat.id]) : ""))}
                            {@const rowWarning = inlineWarningForThreat(threat.id)}
                            <tr class:pd-row-warning={!!rowWarning}>
                                <td>
                                    {threat.label}
                                    {#if rowWarning}
                                        <p class="pd-inline-warning">{rowWarning}</p>
                                    {/if}
                                </td>
                                {#each profileColumns as col}
                                    <td class="has-text-centered">
                                        <input
                                            class="input is-small pd-count"
                                            type="number"
                                            min="0"
                                            max={col.mounts.length}
                                            value={threatCounts[threat.id]?.[col.profile] ?? 0}
                                            on:input={(e) =>
                                                setCount(
                                                    threat.id,
                                                    col.profile,
                                                    Number(e.currentTarget.value)
                                                )}
                                        />
                                    </td>
                                {/each}
                            </tr>
                        {/each}
                    </tbody>
                    <tfoot>
                        <tr>
                            <th>Allocated</th>
                            {#each profileColumns as col}
                                {@const used = totalByProfile[col.profile] ?? 0}
                                <th
                                    class="has-text-centered"
                                    class:has-text-danger={used > col.mounts.length}
                                >
                                    {used} / {col.mounts.length}
                                </th>
                            {/each}
                        </tr>
                    </tfoot>
                </table>
            </div>
        {/if}
    {/if}
{/if}

<ActError issues={validationIssues} />

<button
    class="button is-primary"
    on:click={submit}
    disabled={
        !defender ||
        draftAllocations.length === 0 ||
        supportIssues.some((i) => i.severity === "error")
    }
>
    Add allocations
</button>

<style>
    .pd-count {
        width: 4rem;
        margin: 0 auto;
        text-align: center;
    }
    .pd-inline-warning {
        color: #b86b00;
        font-size: 0.7rem;
        margin: 0.25rem 0 0;
    }
    tr.pd-row-warning td {
        background: #fff8eb;
    }
</style>
