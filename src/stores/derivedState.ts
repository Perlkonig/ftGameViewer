import { derived } from "svelte/store";
import { initialState } from "./writeInitialState";
import { commands } from "./writeCommands";
import { headOffset } from "./writeHeadOffset";
import type { FullThrustGamePosition } from "@/schemas/position";
import { applyCommand } from "@/lib/applyCommand";

interface IProblem {
    location: number;
    command: string;
    description: string;
}

export interface IDerivedState {
    state?: FullThrustGamePosition;
    /* Errors are fatal.
     * If errors are present, then `state` should be undefined.
    */
    error?: IProblem;
    /* Warnings signal potential rules issues that don't stop
     * the state from being calculated (e.g., firing a disabled weapon).
    */
    warnings?: IProblem[];
}

export const currentState = derived(
    [initialState, commands, headOffset],
    ([initialState, commands, headOffset]): IDerivedState => {
        // Normalize headOffset
        let offset = Math.round(Math.abs(headOffset));
        if (offset > commands.length) {
            offset = commands.length;
        }

        // Make a copy of the state to work with
        let state = JSON.parse(JSON.stringify(initialState)) as FullThrustGamePosition;

        const errors: IProblem[] = [];
        const warnings: IProblem[] = [];
        for (let i = 0; i < commands.length - offset; i++) {
            try {
                const newstate = applyCommand(state, commands[i]);
                state = newstate.state;
                if (newstate.warnings !== undefined) {
                    warnings.push({
                        location: i,
                        command: commands[i].name,
                        description: warnings.join("\n")
                    });
                }
            } catch (e) {
                console.log(`Error: ${e}`);
                return {
                    error: {
                        location: i,
                        command: commands[i].name,
                        description: e
                    }
                };
            }
        }

        return {
            state,
            warnings
        };
    }
);
