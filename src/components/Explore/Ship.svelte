<script lang="ts">
    import { currentState } from "@/stores/derivedState";
    import { annotations, type IAnnotation } from "@/stores/writeAnnotations";
    import RenderSsd from "@/components/RenderSSD.svelte";
    import type { FullThrustShip } from "ftlibship";
    import type { FullThrustGameObjects, Position } from "@/schemas/position";
    import { onDestroy } from "svelte";
    import { buildShipRenderOpts } from "@/lib/ssdRenderOpts";
    import type { ShipSystemEntry } from "@/lib/game/shipSystems";
    import {
        weaponAnnotationsForSystem,
        boundsFromAnnotations,
    } from "@/lib/weaponAnnotations";
    import type { Facing } from "@/lib/genArcs";
    import {
        findSsdClickId,
        jsonForSsdTarget,
        prettifyJson,
    } from "@/lib/ssdExploreJson";

    export let shipId: string;
    export let owner: string | undefined = undefined;

    let shipJson: string | undefined;
    let fullShipJson = "";
    let shipSrc: FullThrustShip | undefined;
    let shipObj: (FullThrustGameObjects & { objType: "ship" }) | undefined;
    let renderOpts: import("ftlibship").RenderOpts = { minimal: true };

    $: shipRecord = $currentState.state?.objects?.find(
        (o) => o.objType === "ship" && o.id === shipId
    );
    $: if (shipRecord?.objType === "ship") {
        shipObj = shipRecord;
        shipSrc = shipRecord.object as FullThrustShip;
        shipJson = JSON.stringify(shipRecord.object);
        fullShipJson = prettifyJson(shipRecord.object);
        renderOpts = buildShipRenderOpts(shipRecord);
    } else {
        shipObj = undefined;
        shipSrc = undefined;
        shipJson = undefined;
    }

    let sysID: string | undefined;
    let sysData: string | undefined;
    const mapAnnotationIds = new Set<string>();

    const removeMapAnnotations = () => {
        if (mapAnnotationIds.size === 0) return;
        $annotations = $annotations.filter((n) => !mapAnnotationIds.has(n.id));
        mapAnnotationIds.clear();
    };

    const pushMapAnnotation = (annotation: IAnnotation) => {
        mapAnnotationIds.add(annotation.id);
        $annotations.push(annotation);
        $annotations = $annotations;
    };

    const handleSSDClick = (e: MouseEvent) => {
        if (!shipSrc || !shipObj) return;
        const container = e.currentTarget as Element;
        const clickedId = findSsdClickId(e.target, container, shipSrc);
        if (!clickedId) return;

        if (sysID === clickedId) {
            sysID = undefined;
            sysData = undefined;
            removeMapAnnotations();
            return;
        }

        sysID = clickedId;
        const payload = jsonForSsdTarget(shipSrc, shipObj, clickedId);
        sysData = prettifyJson(payload);
        removeMapAnnotations();

        const sysEntry = [...(shipSrc.systems ?? []), ...(shipSrc.ordnance ?? []), ...(shipSrc.weapons ?? [])].find(
            (s) => (s as { id?: string }).id === clickedId
        );
        if (sysEntry) {
            const anns = weaponAnnotationsForSystem(
                shipSrc,
                shipObj.position as Position,
                shipObj.facing as Facing,
                sysEntry as ShipSystemEntry
            );
            for (const a of anns) {
                pushMapAnnotation(a);
            }
            const bounds = boundsFromAnnotations(anns);
            if (bounds) {
                import("@/stores/writeMapView").then(({ focusMapOnBounds }) =>
                    focusMapOnBounds(bounds, 2)
                );
            }
        }
    };

    onDestroy(() => {
        removeMapAnnotations();
    });
</script>

{#if shipJson !== undefined}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <section class="explore-panel explore-panel--ssd" on:click={handleSSDClick}>
        <p class="explore-panel__title">SSD</p>
        <p class="help mb-2">
            <strong>{shipId}</strong>
            {#if owner}<span> — {owner}</span>{/if}
        </p>
        <p class="help mb-2">
            Click hull, drive, core, or any system for its JSON. Click again to clear the
            selection.
        </p>
        <RenderSsd json={shipJson} opts={renderOpts} />
    </section>

    <section class="explore-panel explore-panel--system">
        <p class="explore-panel__title">Selected system</p>
        {#if sysData !== undefined}
            <p class="help mb-2">
                {#if sysID}<code>{sysID}</code>{/if}
            </p>
            <pre class="json-panel json-panel-selected">{sysData}</pre>
        {:else}
            <p class="help mb-2">Click a system on the SSD to inspect it.</p>
        {/if}

        <details class="full-ship-details">
            <summary>Ship design (full JSON)</summary>
            <pre class="json-panel">{fullShipJson}</pre>
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

    .explore-panel--ssd :global(.ssd-host svg *) {
        cursor: pointer;
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

    .json-panel-selected {
        max-height: 28vh;
        background: #eef4ff;
        border-color: #b5c4e8;
    }

    .full-ship-details {
        margin-top: 0.75rem;
    }

    .full-ship-details summary {
        cursor: pointer;
        font-size: 0.8rem;
        font-weight: 600;
        color: #4a4a4a;
        margin-bottom: 0.35rem;
    }
</style>
