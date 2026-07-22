import { derived } from "svelte/store";
import { initialState } from "./writeInitialState";
import { commands } from "./writeCommands";
import { headOffset } from "./writeHeadOffset";
import { gameMeta } from "./writeGameMeta";
import type { FullThrustGameCommand } from "@/schemas/commands";
import type { FullThrustGamePosition } from "@/schemas/position";
import type { GameMeta } from "@/lib/game/types";
import { foldCommands } from "@/lib/game/applyCommand";

import type { CommandAudit } from "@/lib/game/commandValidation";

export interface IDerivedState {
    state?: FullThrustGamePosition;
    meta?: GameMeta;
    pendingMoves?: FullThrustGameCommand[];
    pendingLaunches?: FullThrustGameCommand[];
    pendingFireDeclarations?: FullThrustGameCommand[];
    pendingBoardingOrders?: FullThrustGameCommand[];
    pendingRepairOrders?: FullThrustGameCommand[];
    pendingLayMines?: FullThrustGameCommand[];
    phase5ResolvedMoves?: import("@/lib/game/mineMovement").ResolvedShipMove[];
    phase5MovementResolved?: boolean;
    pendingOrdnanceAllocations?: import("@/lib/game/ordnanceAllocation").PendingOrdnanceAllocation[];
    phase8FurballDeclarations?: import("@/lib/game/fighterDogfight").FurballEngagement[];
    phase9PdDeclarations?: import("@/lib/game/pointDefensePhase9").PointDefenseDeclaration[];
    pendingTransporterDeliveries?: import("@/lib/game/weaponFireState").PendingTransporterDelivery[];
    bankedEmpHits?: import("@/lib/game/empFire").BankedEmpState;
    error?: CommandAudit;
    warnings?: CommandAudit[];
}

export const currentState = derived(
    [initialState, commands, headOffset, gameMeta],
    ([initialState, commands, headOffset, gameMeta]): IDerivedState => {
        const result = foldCommands(gameMeta, initialState, commands, headOffset);
        const pending = {
            pendingMoves: result.state.pendingMoves,
            pendingLaunches: result.state.pendingLaunches,
            pendingFireDeclarations: result.state.pendingFireDeclarations,
            pendingBoardingOrders: result.state.pendingBoardingOrders,
            pendingRepairOrders: result.state.pendingRepairOrders,
            pendingLayMines: result.state.pendingLayMines,
            phase5ResolvedMoves: result.state.phase5ResolvedMoves,
            phase5MovementResolved: result.state.phase5MovementResolved,
            pendingOrdnanceAllocations: result.state.pendingOrdnanceAllocations,
            phase8FurballDeclarations: result.state.phase8FurballDeclarations,
            phase9PdDeclarations: result.state.phase9PdDeclarations,
            pendingTransporterDeliveries: result.state.pendingTransporterDeliveries,
            bankedEmpHits: result.state.bankedEmpHits,
        };
        if (result.error) {
            return {
                error: result.error,
                meta: result.state.meta,
                ...pending,
                warnings: result.warnings,
            };
        }
        return {
            state: result.state.position,
            meta: result.state.meta,
            ...pending,
            warnings: result.warnings,
        };
    }
);
