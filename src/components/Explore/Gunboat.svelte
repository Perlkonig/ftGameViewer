<script lang="ts">
    import { currentState } from "@/stores/derivedState";
    import type { FullThrustGameObjects } from "@/schemas/position";
    import {
        formatGunboatComposition,
        gunboatBoatTypeCounts,
        gunboatGroupLabel,
        gunboatTypeLabel,
    } from "@/lib/game/gunboatLabel";
    import { prettifyJson } from "@/lib/ssdExploreJson";

    export let gunboatId: string;

    $: gunboat = $currentState.state?.objects?.find(
        (o) => o.objType === "gunboats" && o.id === gunboatId
    ) as (FullThrustGameObjects & { objType: "gunboats" }) | undefined;

    $: compositionRows = gunboat
        ? [...gunboatBoatTypeCounts(gunboat).entries()].sort((a, b) =>
              gunboatTypeLabel(a[0]).localeCompare(gunboatTypeLabel(b[0]), undefined, {
                  sensitivity: "base",
              })
          )
        : [];

    $: fullJson = gunboat ? prettifyJson(gunboat) : "";
    $: boatsList = gunboat?.boats ?? [];
</script>

{#if gunboat}
    <section class="explore-panel explore-panel--ssd">
        <p class="explore-panel__title">Squadron</p>
        <p class="help mb-2">
            <strong>{gunboatGroupLabel(gunboat)}</strong>
            <span class="mono"> — {gunboatId}</span>
            {#if gunboat.owner}<span> · {gunboat.owner}</span>{/if}
        </p>
        <p class="help mb-3">{formatGunboatComposition(gunboat, "full")}</p>

        {#if compositionRows.length > 0}
            <table class="table is-narrow is-fullwidth is-size-7 composition-table">
                <thead>
                    <tr>
                        <th>Type</th>
                        <th class="has-text-right">Count</th>
                    </tr>
                </thead>
                <tbody>
                    {#each compositionRows as [type, count]}
                        <tr>
                            <td>{gunboatTypeLabel(type)}</td>
                            <td class="has-text-right">{count}</td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        {:else}
            <p class="help">No boats in squadron.</p>
        {/if}

        {#if boatsList.length > 0}
            <details class="boat-details">
                <summary>Per-boat list ({boatsList.length})</summary>
                <ul class="boat-list">
                    {#each boatsList as boat}
                        <li>
                            <span>{gunboatTypeLabel(boat.type)}</span>
                            {#if boat.id}<code class="boat-id">{boat.id}</code>{/if}
                        </li>
                    {/each}
                </ul>
            </details>
        {/if}
    </section>

    <section class="explore-panel explore-panel--system">
        <p class="explore-panel__title">Status</p>
        <dl class="status-dl">
            <dt>Hull count</dt>
            <dd>{gunboat.number ?? "—"}</dd>
            <dt>Endurance</dt>
            <dd>{gunboat.endurance ?? "—"}</dd>
            <dt>Skill</dt>
            <dd>{gunboat.skill ?? "standard"}</dd>
            {#if gunboat.protection}
                <dt>Protection</dt>
                <dd>{gunboat.protection}</dd>
            {/if}
            {#if gunboat.ecm != null && gunboat.ecm > 0}
                <dt>ECM</dt>
                <dd>{gunboat.ecm}</dd>
            {/if}
            {#if gunboat.ftl}
                <dt>FTL</dt>
                <dd>yes</dd>
            {/if}
            {#if gunboat.gunboatAttachment}
                <dt>Attachment</dt>
                <dd>
                    {gunboat.gunboatAttachment.kind}
                    → {gunboat.gunboatAttachment.targetType}
                    {gunboat.gunboatAttachment.targetId}
                </dd>
            {/if}
        </dl>

        <details class="full-json-details">
            <summary>Squadron JSON</summary>
            <pre class="json-panel">{fullJson}</pre>
        </details>
    </section>
{/if}

<style>
    .explore-panel {
        display: block;
        min-width: 0;
        max-height: 70vh;
        overflow-y: auto;
        border: 1px solid #dbdbdb;
        border-radius: 4px;
        padding: 0.65rem;
        background: #fafafa;
    }

    .explore-panel__title {
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #7a7a7a;
        margin: 0 0 0.5rem;
    }

    .mono {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 0.85em;
    }

    .composition-table {
        background: #fff;
    }

    .composition-table th {
        font-size: 0.7rem;
        text-transform: uppercase;
        color: #7a7a7a;
    }

    .boat-details {
        margin-top: 0.75rem;
    }

    .boat-details summary {
        cursor: pointer;
        font-size: 0.8rem;
        font-weight: 600;
        color: #4a4a4a;
    }

    .boat-list {
        margin: 0.35rem 0 0;
        padding-left: 1.1rem;
        font-size: 0.8rem;
    }

    .boat-id {
        margin-left: 0.35rem;
        font-size: 0.75rem;
        color: #5a5a5a;
    }

    .status-dl {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 0.25rem 0.75rem;
        margin: 0 0 0.75rem;
        font-size: 0.85rem;
    }

    .status-dl dt {
        color: #7a7a7a;
        font-weight: 600;
    }

    .status-dl dd {
        margin: 0;
    }

    .full-json-details summary {
        cursor: pointer;
        font-size: 0.8rem;
        font-weight: 600;
        color: #4a4a4a;
        margin-bottom: 0.35rem;
    }

    .json-panel {
        display: block;
        max-height: 42vh;
        overflow: auto;
        margin: 0;
        padding: 0.75rem;
        background: #f5f5f5;
        border: 1px solid #dbdbdb;
        border-radius: 4px;
        font-size: 0.75rem;
        line-height: 1.35;
        white-space: pre-wrap;
        word-break: break-word;
    }
</style>
