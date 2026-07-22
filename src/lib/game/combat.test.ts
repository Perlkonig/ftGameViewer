import { describe, it, expect } from "vitest";
import {
    beamDicePool,
    resolveBeamAttack,
    resolveBeamAttackFromRolls,
    applyDamageToShip,
    resolvePdsDie,
    resolvePdsPoolFromRolls,
} from "./combat";
import {
    arrayRollSource,
    generatorRollSource,
    InsufficientDiceError,
} from "./dice";

describe("combat", () => {
    it("computes beam dice pool by range band", () => {
        expect(beamDicePool(3, 5)).toBe(3);
        expect(beamDicePool(3, 12)).toBe(2);
        expect(beamDicePool(3, 24)).toBe(1);
        expect(beamDicePool(3, 36)).toBe(0);
    });

    it("resolves beam attack with provided rolls", () => {
        const res = resolveBeamAttackFromRolls(
            { beamClass: 3, rangeMu: 5, screens: 0 },
            [4, 5, 3]
        );
        expect(res.dicePool).toBe(3);
        expect(res.totalDamage).toBe(2);
        expect(res.penetratingDamage).toBe(0);
    });

    it("handles penetrating 6 with reroll", () => {
        const res = resolveBeamAttackFromRolls(
            { beamClass: 1, rangeMu: 5, screens: 0 },
            [6, 5]
        );
        expect(res.normalDamage).toBe(2);
        expect(res.penetratingDamage).toBe(1);
        expect(res.totalDamage).toBe(3);
    });

    it("handles long penetrating 6 chain from pasted sequence", () => {
        const res = resolveBeamAttackFromRolls(
            { beamClass: 1, rangeMu: 5, screens: 0 },
            [6, 6, 6, 6, 3]
        );
        expect(res.normalDamage).toBe(2);
        expect(res.penetratingDamage).toBe(6);
        expect(res.totalDamage).toBe(8);
    });

    it("rolls penetrating rerolls on demand via generator source", () => {
        const faces = [6, 6, 6, 3];
        const source = generatorRollSource(() => faces.shift() ?? 3);
        const res = resolveBeamAttack({ beamClass: 1, rangeMu: 5, screens: 0 }, source);
        expect(res.normalDamage).toBe(2);
        expect(res.penetratingDamage).toBe(4);
        expect(source.consumed()).toEqual([6, 6, 6, 3]);
    });

    it("throws when pasted sequence runs out mid penetrating chain", () => {
        const source = arrayRollSource([6]);
        expect(() =>
            resolveBeamAttack({ beamClass: 1, rangeMu: 5, screens: 0 }, source)
        ).toThrow(InsufficientDiceError);
    });

    it("screen L1 ignores 4s", () => {
        const res = resolveBeamAttackFromRolls(
            { beamClass: 1, rangeMu: 5, screens: 1 },
            [4]
        );
        expect(res.totalDamage).toBe(0);
    });

    it("applies standard damage through armour", () => {
        const app = applyDamageToShip(
            [{ standard: 2 }, { standard: 2 }],
            [0, 0],
            10,
            3,
            "standard"
        );
        expect(app.armourDamage[0]).toBe(2);
        expect(app.armourDamage[1]).toBe(1);
        expect(app.hullDamage).toBe(0);
    });

    it("SAP splits half up to armour", () => {
        const app = applyDamageToShip(
            [{ standard: 10 }],
            [0],
            10,
            5,
            "SAP"
        );
        expect(app.armourDamage[0]).toBe(3);
        expect(app.hullDamage).toBe(2);
    });

    it("resolves PDS kills", () => {
        expect(resolvePdsDie(arrayRollSource([4])).kills).toBe(1);
        expect(resolvePdsPoolFromRolls([6, 3], 1).kills).toBe(2);
        expect(resolvePdsPoolFromRolls([6, 6, 5], 1).kills).toBe(5);
    });
});
