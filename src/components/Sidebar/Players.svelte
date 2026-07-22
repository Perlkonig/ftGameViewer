<script lang="ts">
    import { currentState } from "@/stores/derivedState";
    import { gameMeta } from "@/stores/writeGameMeta";
    import { shipsOnMap, shipDesignStats } from "@/lib/exploreObjects";
    import type { ShipDesignStats } from "@/lib/exploreObjects";

    $: limits = $currentState.meta?.fleetLimits ?? $gameMeta.fleetLimits ?? [];

    interface PlayerFleetStats {
        ships: number;
        mass: number;
        cpv: number;
        npv: number;
        hasCpv: boolean;
        hasNpv: boolean;
    }

    const emptyStats = (): PlayerFleetStats => ({
        ships: 0,
        mass: 0,
        cpv: 0,
        npv: 0,
        hasCpv: false,
        hasNpv: false,
    });

    const addShip = (stats: PlayerFleetStats, design: ShipDesignStats) => {
        stats.ships += 1;
        if (design.mass !== undefined) {
            stats.mass += design.mass;
        }
        if (design.cpv !== undefined) {
            stats.cpv += design.cpv;
            stats.hasCpv = true;
        }
        if (design.npv !== undefined) {
            stats.npv += design.npv;
            stats.hasNpv = true;
        }
    };

    $: statsByOwner = (() => {
        const map = new Map<string, PlayerFleetStats>();
        for (const o of shipsOnMap($currentState.state?.objects)) {
            if (!o.owner) continue;
            const design = shipDesignStats(o);
            if (!design) continue;
            if (!map.has(o.owner)) map.set(o.owner, emptyStats());
            addShip(map.get(o.owner)!, design);
        }
        return map;
    })();

    const fmtTotal = (value: number, hasAny: boolean): string =>
        hasAny ? String(Math.round(value)) : "—";
</script>

<p class="heading">Fleet summary</p>

{#if $currentState.state?.players}
<table class="table is-fullwidth is-size-7 fleet-table">
    <thead>
        <tr>
            <th>Name</th>
            <th>&nbsp;</th>
            <th>VP</th>
            <th>Ships</th>
            <th class="has-text-right">Mass</th>
            <th class="has-text-right">CPV</th>
            <th class="has-text-right">NPV</th>
        </tr>
    </thead>
    <tbody>
    {#each $currentState.state.players as p}
        {@const lim = limits.find((l) => l.playerId === p.id)}
        {@const stats = statsByOwner.get(p.id) ?? emptyStats()}
        <tr>
            <td>{p.id}</td>
            <td><span style={`display:inline-block;width:1.2em;background-color: ${p.colour}`}>&nbsp;</span></td>
            <td>{p.vp ?? 0}</td>
            <td>
                {stats.ships}{#if lim?.maxShips != null}/{lim.maxShips}{/if}
            </td>
            <td class="has-text-right">{stats.ships ? Math.round(stats.mass) : "—"}</td>
            <td class="has-text-right">{fmtTotal(stats.cpv, stats.hasCpv)}</td>
            <td class="has-text-right">{fmtTotal(stats.npv, stats.hasNpv)}</td>
        </tr>
        {#if lim}
            <tr>
                <td colspan="7" class="is-size-7 has-text-grey limit-row">
                    {#if lim.maxPoints != null}Max pts: {lim.maxPoints}. {/if}
                    {#if lim.notes}{lim.notes}{/if}
                </td>
            </tr>
        {/if}
    {/each}
    </tbody>
</table>
{:else}
<p>No players defined</p>
{/if}

<style>
    .fleet-table th,
    .fleet-table td {
        white-space: nowrap;
    }

    .limit-row {
        padding-top: 0;
        border: none;
    }
</style>
