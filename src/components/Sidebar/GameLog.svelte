<script lang="ts">
    import { commands } from "@/stores/writeCommands";
    import { afterUpdate } from "svelte";

    let lst: string[];
    commands.subscribe((val) => {
        lst = val.map(c => c.name);
        console.log(val);
    });
</script>

{#if lst !== undefined}
<ol>
{#each lst as c}
    <li>{c}</li>
{/each}
</ol>
{/if}
