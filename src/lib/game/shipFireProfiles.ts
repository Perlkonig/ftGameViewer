/** Phase 11 ship-fire weapon profile registry. */

import type { PointDefenseProfile } from "./pointDefenseProfiles";
import type { ShipSystemEntry } from "./shipSystems";

export type ShipFireProfileKey =
    | "beam"
    | "emp"
    | "plasma"
    | "graserStd"
    | "graserHeavy"
    | "phaser"
    | "transporter"
    | "gatlingBd"
    | "particleBd"
    | "mesonBd"
    | "needle"
    | "pulseTorpedo"
    | "submunition"
    | "kgun"
    | "mkp"
    | "boardingTorpedo"
    | "fusionFlare"
    | "fusionTorpedo"
    | "gravitic"
    | "pulserShort"
    | "pulserMedium"
    | "pulserLong"
    | "spinalBeam"
    | "spinalPlasma"
    | "pointSingularity"
    | "pds";

export type ShipFireAttackKind =
    | "beamPool"
    | "fixedBd"
    | "projectile"
    | "needle"
    | "emp"
    | "transporter"
    | "spinalLine"
    | "pds";

export type ShipFireDamageKind =
    | "standard"
    | "SAP"
    | "AP"
    | "none"
    | "plasmaPerHit"
    | "massScaled"
    | "bypassArmour";

export type ScreenInteraction = "normal" | "ignoreStandard" | "plasmaFormula";

export interface ShipFireProfile {
    key: ShipFireProfileKey;
    label: string;
    attackKind: ShipFireAttackKind;
    damageKind: ShipFireDamageKind;
    bandWidthMu?: number;
    maxRangeMu?: number;
    fixedDice?: number;
    screenInteraction: ScreenInteraction;
    dualPdProfile?: PointDefenseProfile;
    consumeAmmo?: boolean;
    allowReroll?: boolean;
}

const REGISTRY: Record<ShipFireProfileKey, ShipFireProfile> = {
    beam: {
        key: "beam",
        label: "Beam",
        attackKind: "beamPool",
        damageKind: "standard",
        bandWidthMu: 12,
        screenInteraction: "normal",
        dualPdProfile: "beam1",
        allowReroll: true,
    },
    emp: {
        key: "emp",
        label: "EMP",
        attackKind: "emp",
        damageKind: "none",
        bandWidthMu: 12,
        screenInteraction: "ignoreStandard",
        dualPdProfile: "beam1",
        allowReroll: true,
    },
    plasma: {
        key: "plasma",
        label: "Plasma",
        attackKind: "beamPool",
        damageKind: "plasmaPerHit",
        bandWidthMu: 12,
        screenInteraction: "plasmaFormula",
        allowReroll: true,
    },
    graserStd: {
        key: "graserStd",
        label: "Graser",
        attackKind: "beamPool",
        damageKind: "SAP",
        bandWidthMu: 12,
        screenInteraction: "normal",
        allowReroll: true,
    },
    graserHeavy: {
        key: "graserHeavy",
        label: "Heavy graser",
        attackKind: "beamPool",
        damageKind: "SAP",
        bandWidthMu: 18,
        screenInteraction: "normal",
        allowReroll: false,
    },
    phaser: {
        key: "phaser",
        label: "Phaser",
        attackKind: "beamPool",
        damageKind: "SAP",
        bandWidthMu: 12,
        screenInteraction: "normal",
        allowReroll: true,
    },
    transporter: {
        key: "transporter",
        label: "Transporter",
        attackKind: "transporter",
        damageKind: "none",
        bandWidthMu: 12,
        screenInteraction: "normal",
        allowReroll: false,
    },
    gatlingBd: {
        key: "gatlingBd",
        label: "Gatling",
        attackKind: "fixedBd",
        damageKind: "standard",
        maxRangeMu: 12,
        fixedDice: 6,
        screenInteraction: "normal",
        dualPdProfile: "gatling",
    },
    particleBd: {
        key: "particleBd",
        label: "Particle array",
        attackKind: "fixedBd",
        damageKind: "standard",
        maxRangeMu: 24,
        fixedDice: 2,
        screenInteraction: "normal",
        dualPdProfile: "tpa",
    },
    mesonBd: {
        key: "mesonBd",
        label: "Meson",
        attackKind: "fixedBd",
        damageKind: "standard",
        maxRangeMu: 48,
        fixedDice: 1,
        screenInteraction: "normal",
        dualPdProfile: "meson",
    },
    needle: {
        key: "needle",
        label: "Needle",
        attackKind: "needle",
        damageKind: "standard",
        bandWidthMu: 12,
        screenInteraction: "ignoreStandard",
        allowReroll: false,
    },
    pulseTorpedo: {
        key: "pulseTorpedo",
        label: "Pulse torpedo",
        attackKind: "projectile",
        damageKind: "SAP",
        screenInteraction: "ignoreStandard",
    },
    submunition: {
        key: "submunition",
        label: "Submunition",
        attackKind: "fixedBd",
        damageKind: "standard",
        maxRangeMu: 18,
        screenInteraction: "ignoreStandard",
        consumeAmmo: true,
    },
    kgun: {
        key: "kgun",
        label: "K-gun",
        attackKind: "projectile",
        damageKind: "AP",
        screenInteraction: "ignoreStandard",
        dualPdProfile: "k1",
    },
    mkp: {
        key: "mkp",
        label: "MKP",
        attackKind: "projectile",
        damageKind: "AP",
        maxRangeMu: 12,
        screenInteraction: "ignoreStandard",
        consumeAmmo: true,
    },
    boardingTorpedo: {
        key: "boardingTorpedo",
        label: "Boarding torpedo",
        attackKind: "projectile",
        damageKind: "bypassArmour",
        screenInteraction: "ignoreStandard",
    },
    fusionFlare: {
        key: "fusionFlare",
        label: "Fusion flare",
        attackKind: "projectile",
        damageKind: "standard",
        maxRangeMu: 36,
        screenInteraction: "ignoreStandard",
    },
    fusionTorpedo: {
        key: "fusionTorpedo",
        label: "Fusion torpedo",
        attackKind: "projectile",
        damageKind: "standard",
        maxRangeMu: 36,
        screenInteraction: "ignoreStandard",
    },
    gravitic: {
        key: "gravitic",
        label: "Gravitic",
        attackKind: "beamPool",
        damageKind: "standard",
        bandWidthMu: 12,
        screenInteraction: "normal",
        allowReroll: true,
    },
    pulserShort: {
        key: "pulserShort",
        label: "Pulser (short)",
        attackKind: "fixedBd",
        damageKind: "standard",
        maxRangeMu: 12,
        fixedDice: 6,
        screenInteraction: "normal",
        dualPdProfile: "pulser",
    },
    pulserMedium: {
        key: "pulserMedium",
        label: "Pulser (medium)",
        attackKind: "fixedBd",
        damageKind: "standard",
        maxRangeMu: 24,
        fixedDice: 2,
        screenInteraction: "normal",
        dualPdProfile: "pulser",
    },
    pulserLong: {
        key: "pulserLong",
        label: "Pulser (long)",
        attackKind: "fixedBd",
        damageKind: "standard",
        maxRangeMu: 48,
        fixedDice: 1,
        screenInteraction: "normal",
        dualPdProfile: "pulser",
    },
    spinalBeam: {
        key: "spinalBeam",
        label: "Spinal beam",
        attackKind: "spinalLine",
        damageKind: "standard",
        fixedDice: 12,
        screenInteraction: "normal",
        allowReroll: true,
    },
    spinalPlasma: {
        key: "spinalPlasma",
        label: "Spinal plasma",
        attackKind: "spinalLine",
        damageKind: "plasmaPerHit",
        fixedDice: 6,
        screenInteraction: "plasmaFormula",
        allowReroll: true,
    },
    pointSingularity: {
        key: "pointSingularity",
        label: "Point singularity",
        attackKind: "spinalLine",
        damageKind: "massScaled",
        fixedDice: 2,
        screenInteraction: "ignoreStandard",
        allowReroll: false,
    },
    pds: {
        key: "pds",
        label: "PDS",
        attackKind: "pds",
        damageKind: "none",
        screenInteraction: "normal",
        dualPdProfile: "pds",
    },
};

export function shipFireProfile(key: ShipFireProfileKey): ShipFireProfile {
    return REGISTRY[key];
}

export function allShipFireProfileKeys(): ShipFireProfileKey[] {
    return Object.keys(REGISTRY) as ShipFireProfileKey[];
}

export function inferShipFireProfile(weapon: ShipSystemEntry): ShipFireProfileKey {
    const name = (weapon.name ?? "").toLowerCase();
    switch (name) {
        case "beam":
            return "beam";
        case "emp":
            return "emp";
        case "plasmacannon":
            return "plasma";
        case "graser":
            return weapon.heavy ? "graserHeavy" : "graserStd";
        case "phaser":
            return "phaser";
        case "transporter":
            return "transporter";
        case "gatling":
            return "gatlingBd";
        case "particle":
        case "tpa":
            return "particleBd";
        case "meson":
            return "mesonBd";
        case "needle":
            return "needle";
        case "torpedopulse":
            return "pulseTorpedo";
        case "submunition":
            return "submunition";
        case "kgun":
            return "kgun";
        case "mkp":
            return "mkp";
        case "boardingtorpedolauncher":
            return "boardingTorpedo";
        case "fusion":
            return weapon.mode === "torpedo" ? "fusionTorpedo" : "fusionFlare";
        case "gravitic":
            return "gravitic";
        case "pulser": {
            const range = String(weapon.range ?? "short").toLowerCase();
            if (range === "long") return "pulserLong";
            if (range === "medium") return "pulserMedium";
            return "pulserShort";
        }
        case "spinalbeam":
            return "spinalBeam";
        case "spinalplasma":
            return "spinalPlasma";
        case "spinalsingularity":
            return "pointSingularity";
        case "pds":
        case "ads":
            return "pds";
        default:
            return "beam";
    }
}

export function canOperateAsPointDefense(weapon: ShipSystemEntry): boolean {
    const profile = inferShipFireProfile(weapon);
    const entry = REGISTRY[profile];
    if (entry.dualPdProfile) return true;
    if (profile === "pds") return true;
    const name = (weapon.name ?? "").toLowerCase();
    return name === "adfc" || name === "scattergun" || name === "grapeshot";
}

export function canOperateAsShipFire(weapon: ShipSystemEntry): boolean {
    const name = (weapon.name ?? "").toLowerCase();
    if (name === "adfc" || name === "aadfc" || name === "pds" || name === "ads") return false;
    if (name === "grapeshot") return false;
    const profile = inferShipFireProfile(weapon);
    return profile !== "pds";
}

export function defaultBeamClassForWeapon(weapon: ShipSystemEntry): number {
    const cls = Number(weapon.class);
    if (Number.isFinite(cls) && cls >= 1 && cls <= 5) return cls;
    return 2;
}
