import { describe, it, expect } from "vitest";
import { SeededDice, parseDiceString, DiceSequence, createDiceFromPolicy, arrayRollSource, InsufficientDiceError, fixedDiceRolls } from "./dice";
import { resolveBeamAttack } from "./combat";

describe("dice", () => {
    it("parses comma-separated dice strings", () => {
        expect(parseDiceString("4,6,6,2,5")).toEqual([4, 6, 6, 2, 5]);
    });

    it("parses compact dice strings", () => {
        expect(parseDiceString("46625")).toEqual([4, 6, 6, 2, 5]);
    });

    it("rejects invalid values", () => {
        expect(() => parseDiceString("4,7")).toThrow();
    });

    it("fixedDiceRolls uses policy when input is empty", () => {
        const { rolls, source } = fixedDiceRolls("", 3, "client", { seed: "test-seed" });
        expect(rolls).toHaveLength(3);
        expect(rolls.every((n) => n >= 1 && n <= 6)).toBe(true);
        expect(source).toBe("client");
    });

    it("fixedDiceRolls parses pasted dice", () => {
        const { rolls, source } = fixedDiceRolls("4,6,2", 3, "client", { seed: "x" });
        expect(rolls).toEqual([4, 6, 2]);
        expect(source).toBe("moderatorSequence");
    });

    it("fixedDiceRolls rejects short pasted sequences", () => {
        expect(() => fixedDiceRolls("4,6", 3, "client")).toThrow(/Need 3 dice/);
    });

    it("SeededDice is deterministic", () => {
        const a = new SeededDice("test-seed").roll(10);
        const b = new SeededDice("test-seed").roll(10);
        expect(a).toEqual(b);
        expect(a.every((n) => n >= 1 && n <= 6)).toBe(true);
    });

    it("reuses the same first roll when separate instances share a seed", () => {
        const seed = 42_424_242;
        expect(new SeededDice(seed).next()).toBe(new SeededDice(seed).next());
    });

    it("advances through rolls on a single instance", () => {
        const rng = new SeededDice("initiative-roll-all");
        expect(rng.roll(2)).toEqual(new SeededDice("initiative-roll-all").roll(2));
    });

    it("DiceSequence consumes in order", () => {
        const seq = new DiceSequence([1, 2, 3, 4]);
        expect(seq.take(2)).toEqual([1, 2]);
        expect(seq.remaining()).toBe(2);
        expect(() => seq.take(3)).toThrow();
    });

    it("createDiceFromPolicy uses sequence when hybrid + sequence provided", () => {
        const d = createDiceFromPolicy("hybrid", { sequence: [6, 5, 4] });
        expect(d.roll(2)).toEqual({ rolls: [6, 5], source: "moderatorSequence" });
    });

    it("arrayRollSource throws when exhausted", () => {
        const source = arrayRollSource([6]);
        expect(source.next()).toBe(6);
        expect(() => source.next()).toThrow(InsufficientDiceError);
    });

    it("arrayRollSource tracks consumed dice in order", () => {
        const source = arrayRollSource([4, 5, 3]);
        resolveBeamAttack({ beamClass: 3, rangeMu: 5, screens: 0 }, source);
        expect(source.consumed()).toEqual([4, 5, 3]);
    });
});
