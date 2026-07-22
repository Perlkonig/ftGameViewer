import type { FullThrustGameCommand } from "@/schemas/commands";
import { get } from "svelte/store";
import { foldCommands } from "@/lib/game/applyCommand";
import { truncateMasterCommands } from "@/lib/game/commandLog";
import { commands } from "@/stores/writeCommands";
import { proposalCommands } from "@/stores/writeProposalCommands";
import { userSettings } from "@/stores/writeUserSettings";
import { headOffset } from "@/stores/writeHeadOffset";
import { gameMeta } from "@/stores/writeGameMeta";
import { initialState } from "@/stores/writeInitialState";

/** Keep package header meta aligned with the folded command log. */
export function syncFoldedGameMeta(): void {
    const folded = foldCommands(
        get(gameMeta),
        get(initialState),
        get(commands),
        get(headOffset)
    );
    if (!folded.error && folded.state.meta) {
        gameMeta.set(folded.state.meta);
    }
}

/** Append to master log (moderator) or proposal bundle (player). */
export function appendGameCommand(cmd: FullThrustGameCommand, forceMaster = false): "master" | "proposal" {
    const role = get(userSettings).role ?? "player";
    if (forceMaster || role === "moderator") {
        commands.update((c) => [...c, cmd]);
        syncFoldedGameMeta();
        return "master";
    }
    proposalCommands.update((c) => [...c, cmd]);
    return "proposal";
}

export function appendGameCommands(cmds: FullThrustGameCommand[], forceMaster = false): "master" | "proposal" {
    const role = get(userSettings).role ?? "player";
    if (forceMaster || role === "moderator") {
        commands.update((c) => [...c, ...cmds]);
        syncFoldedGameMeta();
        return "master";
    }
    proposalCommands.update((c) => [...c, ...cmds]);
    return "proposal";
}

/** Remove commands from the end of the master log (moderator only, at latest replay). */
export function popMasterCommands(count = 1): number {
    const role = get(userSettings).role ?? "player";
    if (role !== "moderator") {
        throw new Error("Moderator role required");
    }
    if (get(headOffset) !== 0) {
        throw new Error("Return to the latest command before removing log entries");
    }

    const current = get(commands);
    const next = truncateMasterCommands(current, count);
    const removed = current.length - next.length;
    if (removed === 0) return 0;

    commands.set(next);
    headOffset.set(0);

    syncFoldedGameMeta();

    return removed;
}
