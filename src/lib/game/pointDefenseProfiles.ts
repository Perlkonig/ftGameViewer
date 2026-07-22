/** Point defense weapon profiles and dice resolution — rules 6.4, 8.8, 7.12–7.15. */

import type { RollSource } from "./dice";
import { resolvePdsDie } from "./combat";

export type PointDefenseProfile =
    | "pds"
    | "beam1"
    | "k1"
    | "grapeshot"
    | "scattergun"
    | "ads"
    | "gatling"
    | "tpa"
    | "pulser"
    | "meson"
    | "fighterPd";

export type PointDefenseThreatKind = "fighters" | "salvo" | "heavy" | "gunboats";

export interface PointDefenseRollResult {
    kills: number;
    rolls: number[];
    fighterSelfDestructRolls?: number[];
    fighterSelfDestructLosses?: number;
}

function applyDrm(roll: number, drm: number): number {
    return Math.max(1, Math.min(6, roll + drm));
}

/** Beam-1 style: 5–6 = 1 kill, 6 rerolls. vs heavy: 6 only. */
function resolveBeam1StyleDie(
    source: RollSource,
    threatKind: PointDefenseThreatKind,
    drm = 0
): { kills: number; used: number[] } {
    const mark = source.mark();
    const first = applyDrm(source.next(), drm);
    if (threatKind === "heavy") {
        return { kills: first === 6 ? 1 : 0, used: source.consumedSince(mark) };
    }
    if (first <= 4) {
        return { kills: 0, used: source.consumedSince(mark) };
    }
    if (first === 5) {
        return { kills: 1, used: source.consumedSince(mark) };
    }
    let kills = 2;
    while (true) {
        const rr = applyDrm(source.next(), drm);
        if (rr <= 4) break;
        if (rr === 5) {
            kills += 1;
            break;
        }
        kills += 2;
    }
    return { kills, used: source.consumedSince(mark) };
}

/** PDS vs heavy: 5–6 kills one missile. */
function resolvePdsVsHeavy(source: RollSource): { kills: number; used: number[] } {
    const mark = source.mark();
    const roll = source.next();
    return {
        kills: roll >= 5 ? 1 : 0,
        used: source.consumedSince(mark),
    };
}

export function profileDiceCount(profile: PointDefenseProfile): number {
    if (profile === "grapeshot") return 4;
    return 1;
}

/** Default attack dice for a weapon operating in point-defense mode. */
export function defaultPdsDiceForWeapon(weapon: { name?: string }): number {
    return profileDiceCount(inferProfileFromWeaponName(weapon.name));
}

export function threatKindForTarget(
    objType: string | undefined,
    ordnanceType?: string
): PointDefenseThreatKind {
    if (objType === "gunboats") return "gunboats";
    if (objType === "fighters") return "fighters";
    if (ordnanceType === "missile" || ordnanceType === "amt") return "heavy";
    return "salvo";
}

/** PDS vs gunboats: hit only on 6 (after DRM). */
function resolvePdsVsGunboat(
    source: RollSource,
    drm = 0
): { kills: number; used: number[] } {
    const mark = source.mark();
    const roll = applyDrm(source.next(), drm);
    return {
        kills: roll === 6 ? 1 : 0,
        used: source.consumedSince(mark),
    };
}

export function resolvePointDefenseProfile(
    profile: PointDefenseProfile,
    threatKind: PointDefenseThreatKind,
    source: RollSource,
    diceCount = 1,
    drm = 0
): PointDefenseRollResult {
    const rolls: number[] = [];
    let kills = 0;

    const count =
        profile === "grapeshot"
            ? 4
            : profile === "fighterPd"
              ? Math.max(0, diceCount)
              : profileDiceCount(profile);

    for (let i = 0; i < count; i++) {
        if (profile === "pds" || profile === "scattergun" || profile === "ads" || profile === "gatling" || profile === "tpa" || profile === "pulser" || profile === "meson") {
            if (threatKind === "gunboats") {
                if (profile === "scattergun") {
                    const r = resolveBeam1StyleDie(source, "fighters", drm);
                    kills += r.kills;
                    rolls.push(...r.used);
                } else {
                    const r = resolvePdsVsGunboat(source, drm);
                    kills += r.kills;
                    rolls.push(...r.used);
                }
            } else if (threatKind === "heavy") {
                const r = resolvePdsVsHeavy(source);
                kills += r.kills;
                rolls.push(...r.used);
            } else {
                const r = resolvePdsDie(source);
                kills += r.kills;
                rolls.push(...r.used);
            }
        } else if (profile === "grapeshot") {
            if (threatKind === "heavy") {
                const r = resolvePdsVsHeavy(source);
                kills += r.kills;
                rolls.push(...r.used);
            } else {
                const r = resolvePdsDie(source);
                kills += r.kills;
                rolls.push(...r.used);
            }
        } else if (profile === "beam1" || profile === "fighterPd") {
            const r =
                threatKind === "gunboats"
                    ? resolveBeam1StyleDie(source, "heavy", drm)
                    : resolveBeam1StyleDie(source, threatKind, drm);
            kills += r.kills;
            rolls.push(...r.used);
        } else if (profile === "k1") {
            const r =
                threatKind === "gunboats"
                    ? resolveBeam1StyleDie(source, "heavy", drm - 1)
                    : resolveBeam1StyleDie(source, threatKind, drm - 1);
            kills += r.kills;
            rolls.push(...r.used);
        }
    }

    return { kills, rolls };
}

/** Per missile kill by fighters: roll D6, 6 destroys one fighter. */
export function resolveFighterPdSelfDestruct(
    missileKills: number,
    source: RollSource
): { losses: number; rolls: number[] } {
    const mark = source.mark();
    let losses = 0;
    for (let i = 0; i < missileKills; i++) {
        if (source.next() === 6) losses++;
    }
    return { losses, rolls: source.consumedSince(mark) };
}

export function inferProfileFromWeaponName(name: string | undefined): PointDefenseProfile {
    const n = (name ?? "").toLowerCase();
    if (n === "pds") return "pds";
    if (n === "adfc" || n === "aadfc") return "pds";
    if (n === "beam" || n === "emp") return "beam1";
    if (n === "kgun") return "k1";
    if (n === "grapeshot") return "grapeshot";
    if (n === "scattergun") return "scattergun";
    if (n === "ads") return "ads";
    if (n === "gatling") return "gatling";
    if (n === "particle" || n === "tpa" || n === "twinparticlearray") return "tpa";
    if (n === "pulser") return "pulser";
    if (n === "meson") return "meson";
    return "pds";
}

const PROFILE_LABELS: Record<PointDefenseProfile, string> = {
    pds: "PDS",
    beam1: "Beam-1",
    k1: "K-1",
    grapeshot: "Grapeshot",
    scattergun: "Scattergun",
    ads: "ADS",
    gatling: "Gatling",
    tpa: "TPA",
    pulser: "Pulser",
    meson: "Meson",
    fighterPd: "Fighter PD",
};

export function pointDefenseProfileLabel(profile: PointDefenseProfile): string {
    return PROFILE_LABELS[profile] ?? profile;
}
