<script lang="ts">
    interface IButton {
        // The label that appears in the button
        label: string;
        // The on:click function called
        action: (...args: any) => any;
        // If given, the exact string to insert into the `class` attribute of the button
        class?: string;
    }

    export let title: string;
    // The first button must be the "close" action
    // Close is always placed to the far right, the rest will appear L2R as declared
    export let buttons: IButton[];

    const on_key_up = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
            buttons[0].action();
        }
    }
</script>

<svelte:window
    on:keyup={on_key_up}
/>

<div class="modal is-active">
    <div class="modal-background" on:click={buttons[0].action}></div>
    <div class="modal-card">
      <header class="modal-card-head">
        <p class="modal-card-title">{title}</p>
        <button class="delete" aria-label="close" on:click={buttons[0].action}></button>
      </header>
      <section class="modal-card-body">
        <slot></slot>
      </section>
      <footer class="modal-card-foot">
        {#each buttons as btn, i}
            {#if i !== 0}
                <button class="button{buttons[i].class !== undefined ? ` ${buttons[i].class}` : ""}" on:click={buttons[i].action}>{buttons[i].label}</button>
            {/if}
        {/each}
        <button class="button{buttons[0].class !== undefined ? ` ${buttons[0].class}` : ""}" on:click={buttons[0].action}>{buttons[0].label}</button>
      </footer>
    </div>
</div>

<style></style>
