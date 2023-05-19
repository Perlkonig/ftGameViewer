<script lang="ts">
    import type { SvelteComponentTyped, ComponentType } from "svelte";
    import PlaceShip from "./Select/PlaceShip.svelte";

    interface ICommand {
        key: string;
        name: string;
        component: ComponentType<SvelteComponentTyped>;
        help: string;
    }
    const options: ICommand[] = [
        {
            key: "placeShip",
            name: "Place a ship",
            component: PlaceShip,
            help: "Used for placing new ships on the board"
        }
    ];

    let selected = "";
    let option: ICommand;
    $: option = options.find(o => o.key === selected);

    const handleDone = () => {
        selected = "";
    }
</script>

<div class="field">
    <div class="control">
        <div class="select">
            <select name="cmdSelect" bind:value={selected}>
                <option value="">-- select an action --</option>
            {#each options as opt}
                <option value="{opt.key}">{opt.name}</option>
            {/each}
            </select>
        </div>
    </div>
{#if option?.help}
    <p class="help">{option.help}</p>
{/if}
</div>

<div class="container">
{#if option !== undefined}
    <svelte:component this={option.component} on:done={handleDone} />
{/if}
</div>

<style></style>
