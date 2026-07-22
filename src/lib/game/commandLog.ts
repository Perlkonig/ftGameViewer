import type { FullThrustGameCommand } from "@/schemas/commands";

/** Remove up to `count` commands from the end of a command log. */
export function truncateMasterCommands(
    cmds: FullThrustGameCommand[],
    count: number
): FullThrustGameCommand[] {
    const n = Math.min(Math.max(0, Math.floor(count)), cmds.length);
    return n === 0 ? cmds : cmds.slice(0, cmds.length - n);
}
