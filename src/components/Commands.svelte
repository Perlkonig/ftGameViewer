<script lang="ts">
    import { currentState } from '@/stores/derivedState';
    import Map from './Commands/Map.svelte';
    import Players from './Commands/Players.svelte';
    import Select from './Commands/Select.svelte';
</script>

{#if $currentState.state === undefined}
    <p>Current state is undefined, so there are no commands I can offer. Refresh to start all over, or load a game.</p>
{:else}
    {#if $currentState.state.map === undefined}
        <Map />
    {:else if $currentState.state.players === undefined}
        <Players />
    {:else}
        <Select />
    {/if}
{/if}

<style></style>
