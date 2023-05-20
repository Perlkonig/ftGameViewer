<script lang="ts">
    import { currentState } from '@/stores/derivedState';
    import Map from './Commands/Map.svelte';
    import Players from './Commands/Players.svelte';
    import Select from './Commands/Select.svelte';
</script>

{#if $currentState.state === undefined}
    {#if $currentState.error !== undefined}
        <div class="content" style="font-color: red; font-size: smaller">
            <p>Move #{$currentState.error.location + 1}, command "{$currentState.error.command}"<br>{$currentState.error.description}</p>
        </div>
    {/if}
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
