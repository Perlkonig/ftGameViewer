import type { FullThrustGamePosition } from "@/schemas/position"
import type { FullThrustGameCommand } from "@/schemas/commands"

export interface ITransformedState {
    state: FullThrustGamePosition;
    warnings?: string[];
}

export const applyCommand = (state: FullThrustGamePosition, cmd: FullThrustGameCommand): ITransformedState => {
    switch (cmd.name) {
        default:
            throw new Error(`I don't know how to process the command named "${cmd.name}".`);
    }
}
