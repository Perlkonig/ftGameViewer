<script lang="ts">
    import { currentState } from "@/stores/derivedState";

</script>

{#if $currentState.state?.players}
<table class="table">
    <thead>
        <tr>
            <th>Name</th>
            <th>&nbsp;</th>
            <th>VP</th>
        </tr>
    </thead>
    <tbody>
    {#each $currentState.state.players as p, i}
        <tr>
            <td>{p.id}</td>
            <td><span style={`width: 100%; background-color: ${p.colour}`}>&nbsp;</span></td>
            <td>{p.vp}</td>
        </tr>
    {/each}
    </tbody>
</table>
{:else}
<p>No players defined</p>
{/if}

<style></style>
