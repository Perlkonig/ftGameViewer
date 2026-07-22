import { describe, expect, it } from "vitest";
import {
    EvalErrorCode,
    ValErrorCode,
    interpretShipValidation,
    type IValidation,
} from "@/lib/shipValidation";

describe("shipValidation", () => {
    it("blocks malformed JSON (parse / schema)", () => {
        const result: IValidation = {
            valid: false,
            code: ValErrorCode.BadJSON,
            ajvErrors: [{ instancePath: "/mass", message: "must be number" }],
        };
        const v = interpretShipValidation(result);
        expect(v.wellFormed).toBe(false);
        expect(v.strictlyValid).toBe(false);
        expect(v.blockingMessages[0]).toMatch(/schema/i);
        expect(v.warnings).toHaveLength(0);
    });

    it("allows well-formed ships with construction errors but warns", () => {
        const result: IValidation = {
            valid: false,
            code: ValErrorCode.BadConstruction,
            evalErrors: [EvalErrorCode.OverMass, EvalErrorCode.DblUID],
        };
        const v = interpretShipValidation(result);
        expect(v.wellFormed).toBe(true);
        expect(v.strictlyValid).toBe(false);
        expect(v.blockingMessages).toHaveLength(0);
        expect(v.warnings.some((w) => /mass allowance/i.test(w))).toBe(true);
        expect(v.warnings.some((w) => /Duplicate system ID/i.test(w))).toBe(true);
    });

    it("warns on points mismatch without blocking", () => {
        const result: IValidation = {
            valid: false,
            code: ValErrorCode.PointsMismatch,
        };
        const v = interpretShipValidation(result);
        expect(v.wellFormed).toBe(true);
        expect(v.warnings.some((w) => /points or CPV/i.test(w))).toBe(true);
    });

    it("passes strictly valid designs", () => {
        const v = interpretShipValidation({ valid: true });
        expect(v.wellFormed).toBe(true);
        expect(v.strictlyValid).toBe(true);
        expect(v.warnings).toHaveLength(0);
    });
});
