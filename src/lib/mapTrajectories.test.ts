import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { foldCommands } from "@/lib/game/applyCommand";
import { parseLoadable } from "@/lib/game/package";
import { buildTrajectoryLines } from "./mapTrajectories";

describe("mapTrajectories", () => {
    it("builds preview lines for ships with pending movement orders", () => {
        const raw = JSON.parse(
            readFileSync("public/presets/Intro_Scenario.ftgame.json", "utf8")
        );
        const pkg = parseLoadable(raw);
        const cmds = [
            ...pkg.commands,
            {
                name: "moveShip",
                id: "CruiserA1",
                cinematicAllocation: {
                    speedChange: "accel",
                    speedChangeThrust: 4,
                    turns: 0,
                },
            },
        ];
        const folded = foldCommands(
            {
                turn: pkg.turn,
                phase: pkg.phase,
                dicePolicy: pkg.dicePolicy,
                allowVectorMovement: pkg.allowVectorMovement,
            },
            pkg.initialState,
            cmds,
            0
        );
        const cs = {
            state: folded.state.position,
            meta: folded.state.meta,
            pendingMoves: folded.state.pendingMoves,
        };
        const lines = buildTrajectoryLines(cs, true);
        expect(lines.length).toBeGreaterThan(0);
        const cruiser = lines.find((l) => l.key === "CruiserA1");
        expect(cruiser).toBeDefined();
        expect(cruiser!.stroke).toBe("#6eb5ff");
        expect(cruiser!.points.split(" ").length).toBeGreaterThanOrEqual(2);
        expect(cruiser!.endX).toBeGreaterThan(0);
        expect(cruiser!.endY).toBeGreaterThan(0);
    });

    it("returns empty when hidden", () => {
        const raw = JSON.parse(
            readFileSync("public/presets/Intro_Scenario.ftgame.json", "utf8")
        );
        const pkg = parseLoadable(raw);
        const folded = foldCommands(
            {
                turn: pkg.turn,
                phase: pkg.phase,
                dicePolicy: pkg.dicePolicy,
                allowVectorMovement: pkg.allowVectorMovement,
            },
            pkg.initialState,
            pkg.commands,
            0
        );
        const cs = {
            state: folded.state.position,
            meta: folded.state.meta,
            pendingMoves: folded.state.pendingMoves,
        };
        expect(buildTrajectoryLines(cs, false)).toEqual([]);
    });
});
