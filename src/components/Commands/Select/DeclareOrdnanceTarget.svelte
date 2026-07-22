<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { currentState } from "@/stores/derivedState";
    import { appendGameCommand, appendGameCommands } from "@/lib/game/appendCommand";
    import type { FullThrustGameCommand } from "@/schemas/commands";
    import { toast } from "@zerodevx/svelte-toast";
    import { ordnanceNeedsPhase7Allocation, phase7OrdnanceLogCommands } from "@/lib/game/ordnanceAllocation";
    import { validateAllocateOrdnanceTarget } from "@/lib/game/fighterAttack";
    import { DEFAULT_META } from "@/lib/game/types";
    import type { FoldState } from "@/lib/game/applyCommand";
    import { focusMapOnOrdnanceId, focusMapOnShipId } from "@/lib/actMapInteraction";

    const dispatch = createEventDispatcher();

    $: pending = $currentState.pendingOrdnanceAllocations ?? [];
    $: ordnance =
        $currentState.state?.objects?.filter((o) => o.objType === "ordnance") ?? [];
    $: ships =
        $currentState.state?.objects?.filter((o) => o.objType === "ship" && o.position) ??
        [];
    $: allocatable = ordnance.filter((o) =>
        ordnanceNeedsPhase7Allocation(o as { objType: "ordnance"; type: string })
    );

    let ordnanceId = "";
    let targetShipId = "";
    let manualAction: "target" | "destroy" | "skip" = "target";
    let prevOrdnanceId = "";
    let prevTargetShipId = "";

    $: mapObjects = ($currentState.state?.objects ?? []) as import("@/schemas/position").FullThrustGameObjects[];

    $: if (ordnanceId && ordnanceId !== prevOrdnanceId) {
        prevOrdnanceId = ordnanceId;
        focusMapOnOrdnanceId(ordnanceId, mapObjects);
    }
    $: if (targetShipId && targetShipId !== prevTargetShipId) {
        prevTargetShipId = targetShipId;
        focusMapOnShipId(targetShipId, mapObjects);
    }

    $: fold = {
        meta: $currentState.meta ?? DEFAULT_META(),
        position: $currentState.state!,
        pendingOrdnanceAllocations: pending,
    } as FoldState;

    const submitOverride = () => {
        if (!ordnanceId) {
            toast.push("Select ordnance");
            return;
        }
        if (manualAction === "target" && !targetShipId) {
            toast.push("Select target ship");
            return;
        }
        const cmd = {
            name: "allocateOrdnanceTarget",
            ordnanceId,
            action: manualAction,
            targetShipId: manualAction === "target" ? targetShipId : undefined,
        } as FullThrustGameCommand;
        const issues = validateAllocateOrdnanceTarget(
            fold,
            ordnanceId,
            manualAction === "target" ? targetShipId : undefined,
            manualAction
        );
        for (const issue of issues) {
            if (issue.severity === "warning") toast.push(issue.message);
        }
        appendGameCommand(cmd);
        toast.push("Ordnance allocation updated");
        ordnanceId = "";
        targetShipId = "";
    };

    const repropose = () => {
        appendGameCommand({ name: "proposeOrdnanceAllocations" } as FullThrustGameCommand);
        toast.push("Proposals recomputed");
    };

    const clearOne = (id: string) => {
        appendGameCommand({
            name: "clearOrdnanceAllocation",
            ordnanceId: id,
        } as FullThrustGameCommand);
        toast.push(`Cleared ${id}`);
    };

    const applyPending = () => {
        const cmds = phase7OrdnanceLogCommands(pending);
        if (cmds.length === 0) return;
        appendGameCommands(cmds);
        toast.push("Pending allocations applied");
    };
</script>

<p class="help">
    Homing missiles are usually allocated automatically; use this form only for house rules or
    corrections.
</p>

{#if pending.length > 0}
    <div class="box is-size-7 mb-3">
        <p class="has-text-weight-semibold">Pending proposals</p>
        <ul>
            {#each pending as p (p.ordnanceId)}
                <li>
                    {p.ordnanceId}: {p.action}
                    {#if p.targetShipId}→ {p.targetShipId}{/if}
                    {#if p.proposed}(auto){/if}
                    <button class="button is-small is-light ml-1" on:click={() => clearOne(p.ordnanceId)}>
                        Clear
                    </button>
                </li>
            {/each}
        </ul>
    </div>
{/if}

<div class="buttons mb-3">
    <button class="button is-small" on:click={repropose}>Re-run proposals</button>
    {#if pending.length > 0}
        <button class="button is-small is-link" on:click={applyPending}>Apply pending</button>
    {/if}
</div>

<div class="field">
    <label class="label" for="ord">Ordnance</label>
    <div class="select">
        <select id="ord" bind:value={ordnanceId}>
            <option value="">--</option>
            {#each allocatable as o}
                <option value={o.id}>{o.id} ({o.type})</option>
            {/each}
        </select>
    </div>
</div>

<div class="field">
    <label class="label" for="act">Action</label>
    <div class="select">
        <select id="act" bind:value={manualAction}>
            <option value="target">Target ship</option>
            <option value="destroy">Destroy (no target)</option>
            <option value="skip">Skip / remain</option>
        </select>
    </div>
</div>

{#if manualAction === "target"}
    <div class="field">
        <label class="label" for="tgt">Enemy ship</label>
        <div class="select">
            <select id="tgt" bind:value={targetShipId}>
                <option value="">--</option>
                {#each ships as s}
                    <option value={s.id}>{s.id} ({s.owner})</option>
                {/each}
            </select>
        </div>
    </div>
{/if}

<button class="button is-primary" on:click={submitOverride}>Submit override</button>
