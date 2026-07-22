<script lang="ts">
    import { currentState } from '@/stores/derivedState';
    import Select from './Commands/Select.svelte';

    $: ready =
        $currentState.state?.map !== undefined &&
        $currentState.state?.players !== undefined &&
        ($currentState.state.players?.length ?? 0) > 0;
</script>

{#if $currentState.state === undefined}
    {#if $currentState.error !== undefined}
        <div class="content" style="color: red; font-size: smaller">
            <p>Move #{$currentState.error.location + 1}, command "{$currentState.error.command}"<br>{$currentState.error.description}</p>
        </div>
    {/if}
{:else if !ready}
    <div class="notification is-info is-light">
        <p>
            This game is missing map or player setup. Use <strong>New game</strong> at the top
            of the page to create a game, or import an existing game file.
        </p>
    </div>
{:else}
    <Select />
{/if}

<style></style>
