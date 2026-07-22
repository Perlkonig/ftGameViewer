import { describe, expect, it } from "vitest";
import { buildActivationQueue } from "./activation";
import type { FullThrustGamePosition } from "@/schemas/position";

const basePosition = (): FullThrustGamePosition => ({
    map: { mode: "fixed", width: 72, height: 48 },
    players: [
        { id: "P1", colour: "#f00", vp: 0 },
        { id: "P2", colour: "#00f", vp: 0 },
    ],
    objects: [
        {
            objType: "ship",
            id: "S1",
            owner: "P1",
            object: {
                systems: [{ name: "drive", id: "d1" }],
                weapons: [{ name: "Salvo-1", id: "sal1" }],
            },
            svg: "<symbol viewBox='0 0 1 1'></symbol>",
            position: { x: 1, y: 1 },
            facing: 12,
            speed: 0,
        },
        {
            objType: "ship",
            id: "S2",
            owner: "P2",
            object: {
                systems: [{ name: "Salvo-1", id: "sal2" }],
            },
            svg: "<symbol viewBox='0 0 1 1'></symbol>",
            position: { x: 2, y: 2 },
            facing: 12,
            speed: 0,
        },
        {
            objType: "ship",
            id: "S3",
            owner: "P1",
            object: {
                systems: [{ name: "Salvo-1", id: "sal3" }],
            },
            svg: "<symbol viewBox='0 0 1 1'></symbol>",
            position: { x: 3, y: 3 },
            facing: 12,
            speed: 0,
        },
        ] as unknown as FullThrustGamePosition["objects"],
    });

const initiative = {
    rolls: [
        { player: "P1", roll: 2 },
        { player: "P2", roll: 5 },
    ],
    winner: "P2",
};

describe("buildActivationQueue", () => {
    it("alternates loser-first in phase 3 launch", () => {
        const queue = buildActivationQueue(
            3,
            basePosition(),
            ["P1", "P2"],
            initiative
        );
        expect(queue).toEqual(["S1", "S2", "S3"]);
    });

    it("includes fighter-only carriers in phase 3 launch", () => {
        const pos = basePosition();
        const carrier = pos.objects!.find((o) => o.id === "S3")!;
        (carrier as { object: Record<string, unknown> }).object = {
            systems: [{ name: "hangar", id: "h1", fighters: 6 }],
        };
        (carrier as { hangars?: Record<string, unknown> }).hangars = {
            h1: { occupied: true, deployed: false },
        };
        pos.objects!.push({
            objType: "fighters",
            id: "F3",
            owner: "P1",
            type: "standard",
            position: { ship: "S3", hangar: "h1" },
            number: 6,
            endurance: 6,
            skill: "standard",
        });
        const queue = buildActivationQueue(3, pos, ["P1", "P2"], initiative);
        expect(queue).toContain("S3");
    });

    it("alternates winner-first in phase 11 ship fire", () => {
        const pos = basePosition();
        for (const obj of pos.objects ?? []) {
            if (obj.objType === "ship") {
                (obj as { object: Record<string, unknown> }).object = {
                    systems: [{ name: "drive", id: "d1" }],
                    weapons: [
                        { name: "beam", id: "b1", class: 2, leftArc: "F", numArcs: 6 },
                    ],
                };
            }
        }
        const queue = buildActivationQueue(11, pos, ["P1", "P2"], initiative);
        expect(queue).toEqual(["S2", "S1", "S3"]);
    });

    it("lists deployed fighter groups in phase 4", () => {
        const pos = basePosition();
        pos.objects!.push({
            objType: "fighters",
            id: "F1",
            owner: "P1",
            type: "standard",
            position: { x: 1, y: 1 },
            facing: 12,
            number: 6,
            endurance: 6,
            skill: "standard",
        });
        pos.objects!.push({
            objType: "fighters",
            id: "F2",
            owner: "P2",
            type: "standard",
            position: { x: 2, y: 2 },
            facing: 12,
            number: 6,
            endurance: 6,
            skill: "standard",
        });
        pos.objects!.push({
            objType: "fighters",
            id: "F3",
            owner: "P1",
            type: "standard",
            position: { ship: "S1", hangar: "h1" },
            number: 6,
            endurance: 6,
            skill: "standard",
        });
        const queue = buildActivationQueue(4, pos, ["P1", "P2"], initiative);
        expect(queue).toEqual(["F1", "F2"]);
    });
});
