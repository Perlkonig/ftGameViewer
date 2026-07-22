import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import { truncateMasterCommands } from "./commandLog";
import { proposalCommands, popProposalCommands } from "@/stores/writeProposalCommands";
import type { FullThrustGameCommand } from "@/schemas/commands";

describe("truncateMasterCommands", () => {
    const cmds = [
        { name: "placeShip" },
        { name: "moveShip" },
        { name: "advancePhase" },
    ] as FullThrustGameCommand[];

    it("removes only from the end", () => {
        expect(truncateMasterCommands(cmds, 1).map((c) => c.name)).toEqual([
            "placeShip",
            "moveShip",
        ]);
        expect(truncateMasterCommands(cmds, 2).map((c) => c.name)).toEqual(["placeShip"]);
    });

    it("clamps count to log length", () => {
        expect(truncateMasterCommands(cmds, 99)).toEqual([]);
        expect(truncateMasterCommands(cmds, 0)).toEqual(cmds);
        expect(truncateMasterCommands([], 1)).toEqual([]);
    });
});

describe("popProposalCommands", () => {
    beforeEach(() => {
        proposalCommands.set([]);
    });

    it("removes the last proposal only (LIFO)", () => {
        proposalCommands.set([
            { name: "moveShip", id: "S1" },
            { name: "declareShipFire", ship: "S1" },
        ] as FullThrustGameCommand[]);

        expect(popProposalCommands(1)).toBe(1);
        expect(get(proposalCommands).map((c) => c.name)).toEqual(["moveShip"]);
    });

    it("returns 0 when proposals are empty", () => {
        expect(popProposalCommands(1)).toBe(0);
    });
});
