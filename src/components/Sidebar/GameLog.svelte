<script lang="ts">
    import { commands } from "@/stores/writeCommands";
    import { proposalCommands, popProposalCommands } from "@/stores/writeProposalCommands";
    import { headOffset } from "@/stores/writeHeadOffset";
    import { userSettings } from "@/stores/writeUserSettings";
    import { currentState } from "@/stores/derivedState";
    import { popMasterCommands } from "@/lib/game/appendCommand";
    import { applyCommand } from "@/lib/game/applyCommand";
    import { validateCommand, issuesToAudits } from "@/lib/game/commandValidation";
    import type { FullThrustGameCommand } from "@/schemas/commands";
    import type { CommandAudit } from "@/lib/game/commandValidation";
    import type { ValidationIssue } from "@/lib/game/commandValidation";
    import { toast } from "@zerodevx/svelte-toast";
    import { decodeRepairOrdersNotes } from "@/lib/game/repairOrders";
    import { repairOrderSummary } from "@/lib/game/repairSystems";

    /** `master` = authoritative log only; `proposals` = draft commands only; `all` = both. */
    export let variant: "master" | "proposals" | "all" = "all";

    $: showMaster = variant === "master" || variant === "all";
    $: showProposals = variant === "proposals" || variant === "all";

    $: isMod = ($userSettings.role ?? "player") === "moderator";
    $: atLatest = $headOffset === 0;
    $: visibleCount = Math.max(0, $commands.length - $headOffset);
    $: master = $commands.slice(0, visibleCount);
    $: lastIndex = master.length - 1;
    $: masterEntries = master.map((cmd, index) => ({ cmd, index })).reverse();

    $: auditsByIndex = (() => {
        const map = new Map<number, CommandAudit>();
        for (const w of $currentState.warnings ?? []) {
            const prev = map.get(w.location);
            if (prev) {
                map.set(w.location, {
                    ...prev,
                    description: `${prev.description}\n${w.description}`,
                    severity:
                        prev.severity === "error" || w.severity === "error"
                            ? "error"
                            : "warning",
                });
            } else {
                map.set(w.location, w);
            }
        }
        return map;
    })();
    $: foldError = $currentState.error;

    const commandSummary = (c: FullThrustGameCommand): string => {
        if (c.name === "_custom" && "msg" in c) return `: ${c.msg}`;
        if (c.name === "logDice") {
            const purpose = "purpose" in c && typeof c.purpose === "string" ? c.purpose : "";
            const result = "result" in c && typeof c.result === "string" ? c.result : "";
            if (purpose && result) return `: ${purpose} — ${result}`;
            if (result) return `: ${result}`;
            if (purpose) return `: ${purpose}`;
        }
        if (c.name === "advancePhase" && "phase" in c) return ` → phase ${c.phase}`;
        if (c.name === "placeShip" && "id" in c) return ` (${c.id})`;
        if (c.name === "moveShip" && "id" in c) return ` (${c.id})`;
        if (c.name === "fireWeapon" && "notes" in c && c.notes) return `: ${c.notes}`;
        if (c.name === "fireWeapon" && "target" in c) return ` → ${c.target}`;
        if (c.name === "dmgShip" && "ship" in c) return ` (${c.ship})`;
        if (c.name === "objDestroy" && "uuid" in c) return ` (${c.uuid})`;
        if (c.name === "launchFighters" && "ship" in c) {
            const cs = "callsign" in c && typeof c.callsign === "string" ? c.callsign.trim() : "";
            return cs ? ` (${c.ship}, ${cs})` : ` (${c.ship})`;
        }
        if (c.name === "launchGunboats" && "ship" in c) {
            return ` (${c.ship})`;
        }
        if (c.name === "moveGunboats" && "id" in c) return ` (${c.id})`;
        if (c.name === "declareGunboatAttack" && "id" in c && "targetId" in c) {
            return ` (${c.id} → ${c.targetId})`;
        }
        if (c.name === "setFighterCallsign" && "id" in c) {
            const cs = "callsign" in c && typeof c.callsign === "string" ? c.callsign.trim() : "";
            return cs ? ` (${c.id} → ${cs})` : ` (${c.id}, cleared)`;
        }
        if (c.name === "setFighterType" && "id" in c && "type" in c) {
            return ` (${c.id} → ${c.type})`;
        }
        if (c.name === "launchFighterOrdnance" && "id" in c && "targetShipId" in c) {
            return ` (${c.id} → ${c.targetShipId})`;
        }
        if (c.name === "gunboatShipStrike" && "groupId" in c && "targetShipId" in c) {
            return ` (${c.groupId} → ${c.targetShipId})`;
        }
        if (c.name === "resolveFurball" && "engagement" in c) {
            const eng = c.engagement as { attackers?: { id: string }[]; defenders?: { id: string }[] };
            const a = eng.attackers?.map((x) => x.id).join(", ") ?? "";
            const d = eng.defenders?.map((x) => x.id).join(", ") ?? "";
            return ` attackers [${a}] vs defenders [${d}]`;
        }
        if (c.name === "declareFurball" && "engagement" in c) {
            const eng = c.engagement as { attackers?: { id: string }[]; defenders?: { id: string }[] };
            const a = eng.attackers?.map((x) => x.id).join(", ") ?? "";
            const d = eng.defenders?.map((x) => x.id).join(", ") ?? "";
            return ` [${a}] vs [${d}]`;
        }
        if (c.name === "resolvePhase8Furballs" && "rolls" in c && Array.isArray(c.rolls)) {
            const notes = "notes" in c && typeof c.notes === "string" ? c.notes.trim() : "";
            if (notes) return `: ${notes}`;
            return ` (${c.rolls.length} dice)`;
        }
        if (c.name === "declarePointDefense" && "defenderShip" in c && "threatId" in c) {
            return ` ${c.defenderShip}/${"weapon" in c ? c.weapon : "?"} → ${c.threatId}`;
        }
        if (c.name === "resolvePhase9PointDefense" && "rolls" in c && Array.isArray(c.rolls)) {
            const notes = "notes" in c && typeof c.notes === "string" ? c.notes.trim() : "";
            if (notes) return `: ${notes}`;
            return ` (${c.rolls.length} dice)`;
        }
        if (c.name === "resolvePointDefenseMount" && "defenderShip" in c && "threatId" in c) {
            return ` ${c.defenderShip}/${"weapon" in c ? c.weapon : "?"} → ${c.threatId}`;
        }
        if (c.name === "resolvePhase9Complete" && "count" in c) {
            return ` (${c.count} mount(s))`;
        }
        if (c.name === "detonateOrdnance" && "ordnanceId" in c) {
            return ` ${c.ordnanceId}`;
        }
        if (c.name === "strikeOrdnance" && "ordnanceId" in c && "targetShipId" in c) {
            return ` ${c.ordnanceId} → ${c.targetShipId}`;
        }
        if (c.name === "attackRunIntercept" && "interceptorId" in c && "attackerId" in c) {
            return ` ${c.interceptorId} vs ${c.attackerId}`;
        }
        if (c.name === "fighterShipStrike" && "groupId" in c && "targetShipId" in c) {
            return ` ${c.groupId} → ${c.targetShipId}`;
        }
        if (c.name === "resolvePhase10Complete" && "count" in c) {
            return ` (${c.count} event(s))`;
        }
        if (c.name === "resolvePhase11HullDestruction" && "count" in c) {
            return ` (${c.count} ship(s) removed)`;
        }
        if (c.name === "setShipCaptured" && "ship" in c && "capturedBy" in c) {
            return ` ${c.ship} → ${c.capturedBy}`;
        }
        if (c.name === "setShipOwner" && "ship" in c && "owner" in c) {
            return ` ${c.ship} → ${c.owner}`;
        }
        if (c.name === "declareEmpAllocation" && "firerShip" in c && "targetShip" in c) {
            return ` ${c.firerShip} → ${c.targetShip}`;
        }
        if (c.name === "declareRepairOrders" && "ship" in c && "notes" in c) {
            const order = decodeRepairOrdersNotes(String(c.notes));
            if (order) return ` ${repairOrderSummary(String(c.ship), order)}`;
            return ` (${c.ship})`;
        }
        if (c.name === "resolveRepairOrders" && "ship" in c) {
            const n = "rolls" in c && Array.isArray(c.rolls) ? c.rolls.length : 0;
            return ` ${c.ship} (${n} dice)`;
        }
        if (c.name === "resolveEmpAllocation" && "targetShip" in c) {
            const n = "rolls" in c && Array.isArray(c.rolls) ? c.rolls.length : 0;
            return ` ${c.targetShip} (${n} dice)`;
        }
        if (c.name === "interceptOrdnance" && "id" in c && "ordnanceId" in c) {
            return ` ${c.id} → ${c.ordnanceId}`;
        }
        if (c.name === "allocateOrdnanceTarget" && "ordnanceId" in c) {
            const action = (c as { action?: string }).action ?? "target";
            const tgt = (c as { targetShipId?: string }).targetShipId;
            if (action === "target" && tgt) return ` ${c.ordnanceId} → ${tgt}`;
            return ` ${c.ordnanceId}: ${action}`;
        }
        if (c.name === "applyOrdnanceAllocations") return " (finalize missile targets)";
        if (c.name === "declareFighterAttack" && "id" in c && "targetId" in c) {
            const tt = (c as { targetType?: string }).targetType ?? "target";
            return ` ${c.id} → ${tt} ${c.targetId}`;
        }
        if (c.name === "screenFighters" && "id" in c) {
            const f = (c as { facing?: number }).facing;
            const tgt =
                "ship" in c && c.ship
                    ? String(c.ship)
                    : "targetId" in c
                      ? String(c.targetId)
                      : "";
            return f ? ` ${c.id} screens ${tgt} facing ${f}` : ` ${c.id} screens ${tgt}`;
        }
        if (c.name === "advanceSegment") return " (next segment)";
        if (c.name === "launchOrdnance" && "ship" in c) return ` (${c.ship})`;
        if (c.name === "layMine" && "ship" in c) return ` (${c.ship})`;
        return "";
    };

    const auditFor = (index: number): CommandAudit | undefined => {
        if (foldError?.location === index) return foldError;
        return auditsByIndex.get(index);
    };

    const isErrorAudit = (audit?: CommandAudit) => audit?.severity === "error";

    const auditFromIssues = (
        location: number,
        command: string,
        issues: ValidationIssue[]
    ): CommandAudit | undefined => {
        const audits = issuesToAudits(location, command, issues);
        const error = audits.find((a) => a.severity === "error");
        if (error) return error;
        const warnings = audits.filter((a) => a.severity === "warning");
        if (!warnings.length) return undefined;
        return {
            location,
            command,
            description: warnings.map((w) => w.description).join("\n"),
            severity: "warning",
        };
    };

    const buildProposalRows = (
        proposals: FullThrustGameCommand[]
    ): { cmd: FullThrustGameCommand; audit?: CommandAudit }[] => {
        if (!$currentState.state || !$currentState.meta) {
            return proposals.map((cmd) => ({ cmd }));
        }
        let fold = {
            meta: structuredClone($currentState.meta),
            position: structuredClone($currentState.state),
        };
        const replayPrefix = $commands.slice(
            0,
            Math.max(0, $commands.length - $headOffset)
        );
        const rows: { cmd: FullThrustGameCommand; audit?: CommandAudit }[] = [];
        for (const cmd of proposals) {
            const issues = validateCommand(fold, cmd, replayPrefix);
            rows.push({ cmd, audit: auditFromIssues(-1, cmd.name, issues) });
            try {
                fold = applyCommand(fold, cmd, { replayCommands: replayPrefix }).state;
                replayPrefix.push(cmd);
            } catch {
                break;
            }
        }
        return rows;
    };

    $: proposalRows = buildProposalRows($proposalCommands);
    $: lastProposalIndex = proposalRows.length - 1;

    type LogExpandKey = `master:${number}` | `proposal:${number}`;
    let expandedKey: LogExpandKey | null = null;

    const logKey = (scope: "master" | "proposal", index: number): LogExpandKey =>
        `${scope}:${index}`;

    const toggleExpand = (key: LogExpandKey) => {
        expandedKey = expandedKey === key ? null : key;
    };

    const formatCommandJson = (cmd: FullThrustGameCommand): string =>
        JSON.stringify(cmd, null, 2);

    const removeLast = () => {
        try {
            const removed = popMasterCommands(1);
            if (removed === 0) {
                toast.push("Master log is empty");
                return;
            }
            toast.push("Removed last master command");
        } catch (e) {
            toast.push(e instanceof Error ? e.message : "Could not remove command");
        }
    };

    const removeLastProposal = () => {
        const removed = popProposalCommands(1);
        if (removed === 0) {
            toast.push("No proposals to remove");
            return;
        }
        toast.push("Removed last proposal");
    };
</script>

{#if showMaster}
<p class="heading">Master log</p>
{#if master.length}
<ol class="is-size-7 master-log" reversed>
{#each masterEntries as { cmd, index: i }}
    {@const audit = auditFor(i)}
    {@const key = logKey("master", i)}
    <li
        class:log-last={i === lastIndex}
        class:log-invalid={isErrorAudit(audit)}
        class:log-warning={audit?.severity === "warning"}
        class:log-expanded={expandedKey === key}
    >
        <div class="log-row">
            <button
                type="button"
                class="log-entry"
                class:log-entry-invalid={isErrorAudit(audit)}
                class:log-entry-warning={audit?.severity === "warning"}
                class:log-entry-expanded={expandedKey === key}
                title={audit?.description ?? "Show command JSON"}
                on:click={() => toggleExpand(key)}
            >
                {cmd.name}{commandSummary(cmd)}
            </button>
            {#if isMod && i === lastIndex && atLatest}
                <button
                    class="button is-danger is-small log-remove"
                    title="Remove last entry"
                    on:click|stopPropagation={removeLast}
                >
                    ×
                </button>
            {/if}
        </div>
        {#if audit?.description}
            <p
                class="log-audit is-size-7 mb-1"
                class:has-text-danger={audit.severity === "error"}
                class:has-text-warning={audit.severity === "warning"}
            >
                {audit.description}
            </p>
        {/if}
        {#if expandedKey === key}
            <pre class="log-json">{formatCommandJson(cmd)}</pre>
        {/if}
    </li>
{/each}
</ol>
{:else}
<p class="is-size-7 has-text-grey">No commands yet</p>
{/if}

{#if isMod && master.length && !atLatest}
    <p class="is-size-7 has-text-warning">Return replay to latest to remove log entries.</p>
{/if}
{/if}

{#if showProposals && $proposalCommands.length}
{#if showMaster}
<hr />
{/if}
<p class="heading">Proposals ({$proposalCommands.length})</p>
<ol class="is-size-7 proposal-log">
{#each proposalRows as row, i}
    {@const key = logKey("proposal", i)}
    <li
        class:log-last={i === lastProposalIndex}
        class:log-invalid={isErrorAudit(row.audit)}
        class:log-warning={row.audit?.severity === "warning"}
        class:log-expanded={expandedKey === key}
    >
        <div class="log-row">
            <button
                type="button"
                class="log-entry"
                class:log-entry-invalid={isErrorAudit(row.audit)}
                class:log-entry-warning={row.audit?.severity === "warning"}
                class:log-entry-expanded={expandedKey === key}
                title={row.audit?.description ?? "Show command JSON"}
                on:click={() => toggleExpand(key)}
            >
                {row.cmd.name}{commandSummary(row.cmd)}
            </button>
            {#if i === lastProposalIndex}
                <button
                    class="button is-danger is-small log-remove"
                    title="Remove last proposal"
                    on:click|stopPropagation={removeLastProposal}
                >
                    ×
                </button>
            {/if}
        </div>
        {#if row.audit?.description}
            <p
                class="log-audit is-size-7 mb-1"
                class:has-text-danger={row.audit.severity === "error"}
                class:has-text-warning={row.audit.severity === "warning"}
            >
                {row.audit.description}
            </p>
        {/if}
        {#if expandedKey === key}
            <pre class="log-json">{formatCommandJson(row.cmd)}</pre>
        {/if}
    </li>
{/each}
</ol>
{/if}

<style>
    .master-log li,
    .proposal-log li {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }

    .log-row {
        display: flex;
        align-items: baseline;
        gap: 0.35rem;
    }

    .log-entry {
        flex: 1;
        min-width: 0;
        border: none;
        background: none;
        padding: 0;
        text-align: left;
        font: inherit;
        color: inherit;
        cursor: pointer;
    }

    .log-entry:hover {
        text-decoration: underline;
    }

    .log-entry-expanded {
        font-weight: 600;
    }

    .log-expanded {
        background: #fafafa;
        border-radius: 3px;
        padding: 0.15rem 0.25rem;
    }

    .log-json {
        margin: 0;
        padding: 0.35rem 0.5rem;
        background: #f5f5f5;
        border: 1px solid #dbdbdb;
        border-radius: 3px;
        font-size: 0.65rem;
        line-height: 1.35;
        max-height: 12rem;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
    }
    .log-entry-invalid {
        color: #cc0f35;
        cursor: help;
    }
    .log-entry-warning {
        color: #b86b00;
        cursor: help;
    }
    .log-audit {
        white-space: pre-wrap;
        padding-left: 0.15rem;
    }
    .log-invalid .log-entry-invalid {
        text-decoration: underline dotted #cc0f35;
    }
    .log-warning .log-entry-warning {
        text-decoration: underline dotted #b86b00;
    }
    .log-last {
        font-weight: 600;
    }
    .log-remove {
        flex-shrink: 0;
        height: 1.25rem;
        min-width: 1.25rem;
        padding: 0 0.25rem;
        line-height: 1;
    }
</style>
