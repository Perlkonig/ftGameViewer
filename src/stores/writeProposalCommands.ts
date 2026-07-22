import { get, writable } from "svelte/store";
import type { FullThrustGameCommand } from "@/schemas/commands";
import { truncateMasterCommands } from "@/lib/game/commandLog";

/** Commands drafted locally for export as a proposal bundle (not yet on master). */
export const proposalCommands = writable<FullThrustGameCommand[]>([]);

/** Remove commands from the end of the proposal bundle (LIFO; does not touch master log). */
export function popProposalCommands(count = 1): number {
    const current = get(proposalCommands);
    const next = truncateMasterCommands(current, count);
    const removed = current.length - next.length;
    if (removed === 0) return 0;
    proposalCommands.set(next);
    return removed;
}
