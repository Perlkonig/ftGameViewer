<script lang="ts">
    import { mousePos } from "@/stores/writeMousePos";
</script>

{#if $mousePos !== undefined}
<div class="level">
    <div class="level-left">
        <div class="level-item">
            <span class="bold">x:</span>&nbsp;{$mousePos.x}
        </div>
        <div class="level-item">
            <span class="bold">y:</span>&nbsp;{$mousePos.y}
        </div>
        <div class="level-item">
            <span class="bold">ID:</span>&nbsp;{$mousePos.id}
        </div>
    </div>
</div>
{/if}

<style>
    .bold {
        font-weight: bolder;
    }
</style>