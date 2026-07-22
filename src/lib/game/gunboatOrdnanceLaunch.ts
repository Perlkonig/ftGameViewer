/** Phase 3 gunboat ordnance launch validation. */

import type { FullThrustGamePosition } from "@/schemas/position";
import type { ValidationIssue } from "./commandValidation";
import { GUNBOAT_ATTACK_RANGE_MU } from "./gunboatAttack";
import { distance } from "./movement";
import { isDeployedGunboat } from "./gunboatMove";
import { gunboatTypeLaunchesOrdnance } from "./gunboatWeapons";

type GunboatObj = Extract<
    NonNullable<FullThrustGamePosition["objects"]>[number],
    { objType: "gunboats" }
>;

function mapPos(obj: { position?: unknown }) {
    const p = obj.position;
    if (!p || typeof p !== "object" || !("x" in p)) return undefined;
    return p as { x: number; y: number };
}

export function gunboatOrdnanceType(gunboat: GunboatObj): string {
    return gunboat.type ?? gunboat.boats?.[0]?.type ?? "";
}

export function validateLaunchGunboatOrdnance(
    position: FullThrustGamePosition,
    gunboatId: string,
    targetShipId: string,
    phase: number
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (phase !== 3) {
        issues.push({
            message: "Gunboat ordnance launch is typically in phase 3.",
            severity: "warning",
        });
    }
    const gunboat = position.objects?.find(
        (o) => o.objType === "gunboats" && o.id === gunboatId
    ) as GunboatObj | undefined;
    if (!gunboat || !isDeployedGunboat(gunboat)) {
        issues.push({ message: "Gunboat squadron not deployed.", severity: "error" });
        return issues;
    }
    const ordType = gunboatOrdnanceType(gunboat);
    if (!gunboatTypeLaunchesOrdnance(ordType)) {
        issues.push({
            message: `Squadron type “${ordType}” does not launch ordnance in phase 3.`,
            severity: "warning",
        });
    }
    if ((gunboat.endurance ?? 6) <= 0) {
        issues.push({
            message: "No squad endurance remaining for ordnance launch.",
            severity: "warning",
        });
    }
    const target = position.objects?.find((o) => o.id === targetShipId && o.objType === "ship");
    if (!target) {
        issues.push({ message: `Target ship not found: ${targetShipId}`, severity: "error" });
        return issues;
    }
    if (target.owner && gunboat.owner && target.owner === gunboat.owner) {
        issues.push({ message: "Target must be an enemy ship.", severity: "warning" });
    }
    const from = mapPos(gunboat);
    const to = mapPos(target);
    if (from && to) {
        const d = distance(from, to);
        if (d > GUNBOAT_ATTACK_RANGE_MU) {
            issues.push({
                message: `Target is ${d.toFixed(1)} MU away (max ${GUNBOAT_ATTACK_RANGE_MU} MU for launch).`,
                severity: "warning",
            });
        }
    }
    return issues;
}

export function deployedOrdnanceGunboats(
    position: FullThrustGamePosition,
    owner?: string
): GunboatObj[] {
    return (position.objects ?? []).filter((o): o is GunboatObj => {
        if (o.objType !== "gunboats" || !isDeployedGunboat(o)) return false;
        if (owner && o.owner !== owner) return false;
        return gunboatTypeLaunchesOrdnance(gunboatOrdnanceType(o));
    });
}
