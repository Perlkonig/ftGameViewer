<script lang="ts">
    import Players from "./Sidebar/Players.svelte";
    import GameLog from "./Sidebar/GameLog.svelte";
    import { proposalCommands } from "@/stores/writeProposalCommands";
</script>

<div class="sidebar-column">
    <Players />
    {#if $proposalCommands.length}
        <div class="proposals-log-scroll">
            <GameLog variant="proposals" />
        </div>
    {/if}
    <div class="master-log-scroll">
        <GameLog variant="master" />
    </div>
</div>

<style>
    .sidebar-column {
        display: flex;
        flex-direction: column;
        min-height: 0;
    }

    .proposals-log-scroll {
        flex-shrink: 0;
        max-height: 14rem;
        overflow-y: auto;
        padding-right: 0.2rem;
        margin-bottom: 0.5rem;
    }

    .master-log-scroll {
        flex: 1;
        min-height: 0;
        max-height: calc(100vh - 26rem);
        overflow-y: auto;
        padding-right: 0.2rem;
    }
</style>
