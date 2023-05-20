<script lang="ts">
    import { commands } from "@/stores/writeCommands";
    import { currentState } from "@/stores/derivedState";
    import { initialState } from "@/stores/writeInitialState";
    import type { FullThrustGameCommand } from "@/schemas/commands";
    import type { FullThrustGamePosition } from "@/schemas/position";
    import { toast } from "@zerodevx/svelte-toast";

    interface IGame {
        commands: FullThrustGameCommand[];
        initialState: FullThrustGamePosition;
    }

    const handleDump = () => {
        console.log($commands);
        console.log($currentState);
    }

    const saveLocal = () => {
        localStorage.setItem("working", JSON.stringify({
            commands: $commands,
            initialState: $initialState
        } as IGame));
        toast.push("Current state saved locally");
    }

    const loadLocal = () => {
        const val = localStorage.getItem("working");
        if (val !== null) {
            const obj = JSON.parse(val) as IGame;
            initialState.set(obj.initialState);
            commands.set(obj.commands);
        } else {
            toast.push("No saved state found")
        }
    }
</script>

<div class="level">
    <div class="level-left">
        <div class="level-item">
            <button class="button" on:click={saveLocal}>Save Local</button>
        </div>
        <div class="level-item">
            <button class="button" on:click={loadLocal}>Load Local</button>
        </div>
        <div class="level-item">
            <button class="button" on:click={handleDump}>Dump State</button>
        </div>
    </div>
</div>

<style></style>
