<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import {
        gameUidCollision,
        handleHtmlUidInput,
        HTML_UID_HELP,
        isValidHtmlUid,
    } from "@/lib/htmlId";
    import type { FullThrustGamePosition } from "@/schemas/position";

    export let value = "";
    export let id: string | undefined = undefined;
    export let name: string | undefined = undefined;
    export let placeholder = "";
    export let help = HTML_UID_HELP;
    export let inputClass = "input";
    /** Live game position to check for duplicate ids. */
    export let gameState: FullThrustGamePosition | undefined = undefined;
    /** Ignore this id (e.g. when editing an existing record). */
    export let excludeId = "";

    const dispatch = createEventDispatcher<{ input: string }>();

    $: collision =
        value.trim() && isValidHtmlUid(value)
            ? gameUidCollision(gameState, value, { excludeId })
            : null;
    $: blocked = collision !== null;

    const onInput = (e: Event) => {
        handleHtmlUidInput(e, (next) => {
            value = next;
            dispatch("input", next);
        });
    };
</script>

<input
    {id}
    {name}
    class={inputClass}
    class:is-danger={blocked}
    type="text"
    {placeholder}
    {value}
    on:input={onInput}
/>
{#if collision}
    <p class="help has-text-danger">{collision}</p>
{:else if help}
    <p class="help">{help}</p>
{/if}
