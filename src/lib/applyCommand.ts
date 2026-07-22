/**
 * Compatibility shim — prefer `@/lib/game/applyCommand`.
 * Legacy callers expect position-only transform.
 */
import type { FullThrustGamePosition } from "@/schemas/position";
import type { FullThrustGameCommand } from "@/schemas/commands";
import {
    applyCommand as applyFoldCommand,
    type ITransformedState as FoldTransformed,
} from "@/lib/game/applyCommand";
import { DEFAULT_META } from "@/lib/game/types";

export interface ITransformedState {
    state: FullThrustGamePosition;
    warnings?: string[];
}

export const applyCommand = (
    state: FullThrustGamePosition,
    cmd: FullThrustGameCommand
): ITransformedState => {
    const result: FoldTransformed = applyFoldCommand(
        { meta: DEFAULT_META(), position: state },
        cmd
    );
    return {
        state: result.state.position,
        warnings: result.warnings,
    };
};
