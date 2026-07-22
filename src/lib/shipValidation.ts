/** ftLibShip validate() wrapper — malformed JSON blocks placement; construction issues warn. */

import {
    validate,
    ValErrorCode,
    EvalErrorCode,
    type IValidation,
} from "ftlibship";

export { ValErrorCode, EvalErrorCode };
export type { IValidation };

export interface ShipJsonValidation {
    /** JSON parses and matches the ship schema (required to place). */
    wellFormed: boolean;
    /** No construction or points issues per ftLibShip. */
    strictlyValid: boolean;
    /** Hard blockers for malformed JSON. */
    blockingMessages: string[];
    /** Soft issues — placement allowed but player/moderator should review. */
    warnings: string[];
    raw: IValidation;
}

const EVAL_ERROR_MESSAGES: Record<EvalErrorCode, string> = {
    [EvalErrorCode.NoMass]: "Ship has no mass rating.",
    [EvalErrorCode.BadMass]: "Mass rating is outside the valid range (2–300 MU).",
    [EvalErrorCode.LowHull]: "Hull structure is insufficient for this design.",
    [EvalErrorCode.OverMarine]: "Too many marine squads for this hull mass.",
    [EvalErrorCode.OverDCP]: "Too many damage-control parties for this hull mass.",
    [EvalErrorCode.OverCrew]: "Crew factor exceeds the limit for this hull mass.",
    [EvalErrorCode.OverSpinal]: "Spinal mount exceeds the mass limit for this hull.",
    [EvalErrorCode.OverTurret]: "Too many turrets for this hull mass.",
    [EvalErrorCode.OverMass]: "Design exceeds mass allowance (systems, armour, or fighters).",
    [EvalErrorCode.OverPBL]: "Too many plasma bolt launchers for this hull mass.",
    [EvalErrorCode.DblUID]: "Duplicate system ID — each system must have a unique id.",
    [EvalErrorCode.FlawedUnderMass]: "Flawed trait requires hull mass 60 MU or greater.",
    [EvalErrorCode.UnknownSystem]: "Unknown or unsupported system type in this design.",
};

function formatAjvErrors(errors: NonNullable<IValidation["ajvErrors"]>): string[] {
    return errors.slice(0, 4).map((e) => {
        const path = e.dataPath || e.instancePath || "";
        const loc = path ? ` at ${path}` : "";
        return `Schema${loc}: ${e.message ?? "invalid value"}`;
    });
}

function constructionWarnings(result: IValidation): string[] {
    const warnings: string[] = [];
    for (const code of result.evalErrors ?? []) {
        const msg = EVAL_ERROR_MESSAGES[code as EvalErrorCode];
        warnings.push(msg ?? `Construction issue: ${code}`);
    }
    if (result.code === ValErrorCode.PointsMismatch) {
        warnings.push(
            "Stated points or CPV do not match the evaluated design — confirm values in the ship builder before play."
        );
    }
    return warnings;
}

export function interpretShipValidation(result: IValidation): ShipJsonValidation {
    if (result.code === ValErrorCode.BadJSON) {
        const blocking: string[] = [];
        if (result.ajvErrors?.length) {
            blocking.push(
                "Ship JSON does not match the expected ship-builder schema:",
                ...formatAjvErrors(result.ajvErrors)
            );
        } else {
            blocking.push("Ship JSON is not valid JSON.");
        }
        return {
            wellFormed: false,
            strictlyValid: false,
            blockingMessages: blocking,
            warnings: [],
            raw: result,
        };
    }

    const warnings = constructionWarnings(result);
    const wellFormed = true;
    const strictlyValid = result.valid === true;

    return {
        wellFormed,
        strictlyValid,
        blockingMessages: [],
        warnings,
        raw: result,
    };
}

export function validateShipJson(shipJson: string): ShipJsonValidation {
    try {
        return interpretShipValidation(validate(shipJson));
    } catch {
        return {
            wellFormed: false,
            strictlyValid: false,
            blockingMessages: ["Could not validate ship JSON."],
            warnings: [],
            raw: { valid: false, code: ValErrorCode.BadJSON },
        };
    }
}

export function validateShipObject(ship: unknown): ShipJsonValidation {
    return validateShipJson(JSON.stringify(ship ?? {}));
}

/** Single-line summary for errors and toasts. */
export function shipValidationSummary(v: ShipJsonValidation): string | undefined {
    if (v.blockingMessages.length) return v.blockingMessages[0];
    if (v.warnings.length) return v.warnings.join("; ");
    return undefined;
}
