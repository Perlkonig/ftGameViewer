<script lang="ts">
    import type { ValidationIssue } from "@/lib/game/commandValidation";

    export let issues: ValidationIssue[] = [];
    export let errorsOnly = false;

    $: visible = errorsOnly
        ? issues.filter((i) => i.severity === "error")
        : issues;
</script>

{#each visible as issue}
    <p
        class="act-error"
        class:is-warning={issue.severity === "warning"}
        role="alert"
    >
        {issue.message}
    </p>
{/each}

<style>
    .act-error {
        color: #cc0f35;
        font-size: 0.875rem;
        margin-top: 0.35rem;
        margin-bottom: 0;
    }
    .act-error.is-warning {
        color: #b86b00;
    }
</style>
