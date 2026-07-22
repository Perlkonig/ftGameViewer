/** Per-boat gunboat weapon profiles — GunboatRules §9.2. */

import type { GunboatType } from "ftlibship";
import type { RollSource } from "./dice";
import { resolveBeamDieSplit, type ScreenLevel } from "./combat";

export interface GunboatSquadronContext {
    protection?: "heavy" | "screened";
    ecm?: number;
}

export type GunboatStrikeMode =
    | "beam1"
    | "beam1x2"
    | "plasma1"
    | "graserSap"
    | "gatlingClose"
    | "gatlingLong"
    | "pulseTorpedo"
    | "submunitionClose"
    | "submunitionLong"
    | "mkp"
    | "kgun"
    | "needle";

export interface GunboatBoatProfile {
    type: string;
    strikeMode: GunboatStrikeMode;
    rangeMu: number;
}

const PROFILES: Record<string, GunboatBoatProfile> = {
    beam: { type: "beam", strikeMode: "beam1x2", rangeMu: 12 },
    plasma: { type: "plasma", strikeMode: "plasma1", rangeMu: 12 },
    graser: { type: "graser", strikeMode: "graserSap", rangeMu: 12 },
    needle: { type: "needle", strikeMode: "needle", rangeMu: 12 },
    gatling: { type: "gatling", strikeMode: "gatlingClose", rangeMu: 6 },
    pulseTorpedo: { type: "pulseTorpedo", strikeMode: "pulseTorpedo", rangeMu: 12 },
    submunition: { type: "submunition", strikeMode: "submunitionClose", rangeMu: 12 },
    kGun: { type: "kGun", strikeMode: "kgun", rangeMu: 12 },
    mkp: { type: "mkp", strikeMode: "mkp", rangeMu: 12 },
    scatterpack: { type: "scatterpack", strikeMode: "beam1", rangeMu: 12 },
};

export function gunboatBoatProfile(boatType: string): GunboatBoatProfile {
    return (
        PROFILES[boatType] ?? {
            type: boatType,
            strikeMode: "beam1",
            rangeMu: 12,
        }
    );
}

export function gunboatProtectionDrm(ctx: GunboatSquadronContext): number {
    return ctx.protection === "heavy" || ctx.protection === "screened" ? -1 : 0;
}

export function gunboatEcmLockRangePenalty(ctx: GunboatSquadronContext): number {
    return Math.max(0, ctx.ecm ?? 0);
}

export function resolveGunboatBoatStrike(
    profile: GunboatBoatProfile,
    screens: ScreenLevel,
    distanceMu: number,
    source: RollSource
): { normalDamage: number; penetratingDamage: number; hits: number } {
    if (distanceMu > profile.rangeMu) {
        return { normalDamage: 0, penetratingDamage: 0, hits: 0 };
    }
    let normalDamage = 0;
    let penetratingDamage = 0;
    let hits = 0;

    switch (profile.strikeMode) {
        case "beam1x2": {
            for (let i = 0; i < 2; i++) {
                const { result } = resolveBeamDieSplit(source, screens);
                normalDamage += result.normalDamage;
                penetratingDamage += result.penetratingDamage;
                if (result.normalDamage + result.penetratingDamage > 0) hits++;
            }
            break;
        }
        case "graserSap": {
            const { result } = resolveBeamDieSplit(source, screens);
            if (result.penetratingDamage > 0 || result.normalDamage > 0) {
                hits = 1;
                penetratingDamage += Math.max(1, Math.min(3, source.next()));
            }
            break;
        }
        case "beam1":
        case "needle":
        case "plasma1":
        default: {
            const { result } = resolveBeamDieSplit(source, screens);
            normalDamage += result.normalDamage;
            penetratingDamage += result.penetratingDamage;
            if (result.normalDamage + result.penetratingDamage > 0) hits = 1;
            break;
        }
    }
    return { normalDamage, penetratingDamage, hits };
}

export function liveGunboatBoats(gunboat: {
    number?: number;
    boats?: { type: string; id?: string }[];
    type?: string;
    id: string;
}): { type: string; id?: string }[] {
    const n = gunboat.number ?? 6;
    const boats = gunboat.boats ?? [];
    if (boats.length > 0) return boats.slice(0, n);
    const squadType = gunboat.type ?? "beam";
    return Array.from({ length: n }, (_, i) => ({
        type: squadType,
        id: `${gunboat.id}-b${i}`,
    }));
}

export function isGunboatOrdnanceType(type: string): boolean {
    return type === "missile" || type === "rocket" || type === "plasmaBomber";
}

export const GUNBOAT_MISSILE_SALVO_COUNT = 4;

export type { GunboatType };
