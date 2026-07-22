/** Phase 3 fighter ordnance launch validation. */

import type { FullThrustGamePosition } from "@/schemas/position";
import type { ValidationIssue } from "./commandValidation";
import { FIGHTER_ATTACK_RANGE_MU } from "./fighterAttack";
import { isDeployedFighter } from "./fighterMove";
import { fighterProfileFor } from "./fighterProfiles";
import { fighterWingFromObj } from "./fighterTypeCommand";
import { isFighterMissionConfigured } from "./fighterWing";
import { distance } from "./movement";
import { isDeployedGunboat } from "./gunboatMove";
import { gunboatEcmLockRangePenalty } from "./gunboatProfiles";

type FighterObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "fighters" }
>;

export function validateLaunchFighterOrdnance(
    position: FullThrustGamePosition,
    fighterId: string,
    targetShipId: string,
    phase: number
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (phase !== 3) {
        issues.push({
            message: "Fighter ordnance launch is typically in phase 3.",
            severity: "warning",
        });
    }
    const fighter = position.objects?.find(
        (o) => o.objType === "fighters" && o.id === fighterId
    ) as FighterObj | undefined;
    if (!fighter || !isDeployedFighter(fighter)) {
        issues.push({ message: "Fighter group not deployed.", severity: "error" });
        return issues;
    }
    const wing = fighterWingFromObj(fighter);
    if (!isFighterMissionConfigured(wing)) {
        issues.push({
            message: "Configure multiRole wing via setFighterType before launch.",
            severity: "error",
        });
        return issues;
    }
    const profile = fighterProfileFor(wing);
    if (!profile.ordnanceLaunchType) {
        issues.push({
            message: "This fighter type does not launch ordnance in phase 3.",
            severity: "warning",
        });
    }
    const ship = position.objects?.find((o) => o.id === targetShipId);
    if (!ship || ship.objType !== "ship") {
        issues.push({ message: "Target must be a ship.", severity: "error" });
        return issues;
    }
    const fpos = fighter.position as { x: number; y: number };
    const spos = ship.position as { x: number; y: number };
    if (fpos && spos && "x" in fpos && "x" in spos) {
        let ecmPenalty = 0;
        for (const o of position.objects ?? []) {
            if (o.objType !== "gunboats" || o.owner === fighter.owner) continue;
            if (!isDeployedGunboat(o)) continue;
            const gpos = o.position as { x: number; y: number };
            if (gpos && "x" in gpos && distance(gpos, spos) <= 12) {
                ecmPenalty += gunboatEcmLockRangePenalty({
                    ecm: (o as { ecm?: number }).ecm,
                });
            }
        }
        const maxR = Math.max(0, profile.missileLockRangeMu - ecmPenalty);
        const d = distance(fpos, spos);
        if (d > maxR) {
            issues.push({
                message: `Target is ${d.toFixed(1)} MU away (max ${maxR} MU for this wing).`,
                severity: "warning",
            });
        }
        if (d > FIGHTER_ATTACK_RANGE_MU && profile.ordnanceLaunchType !== "missile") {
            issues.push({
                message: `Secondary weapons limited to ${FIGHTER_ATTACK_RANGE_MU} MU.`,
                severity: "warning",
            });
        }
    }
    if ((fighter as { payloadSpent?: boolean }).payloadSpent) {
        issues.push({ message: "Ordnance payload already spent.", severity: "error" });
    }
    return issues;
}
