/** Phase 11 ship fire vs deployed gunboat squadrons — 1 hit destroys 1 boat. */

import type { FullThrustGameCommand } from "@/schemas/commands";
import type { RollSource } from "./dice";
import {
    beamDicePool,
    resolveBdPoolNoReroll,
    resolveFixedBdPool,
    resolveMkpHits,
    type ScreenLevel,
} from "./combat";
import {
    decodeFireDeclarationNotes,
    type FireDeclarationMeta,
} from "./resolveCombat";
import { makeLogDice } from "./rollResults";
import { gunboatProtectionDrm } from "./gunboatProfiles";
import { applyGunboatKills } from "./gunboatHull";
import type { ShipFireProfileKey } from "./shipFireProfiles";
import { shipFireProfile } from "./shipFireProfiles";

type GunboatTarget = {
    objType?: string;
    id?: string;
    number?: number;
    boats?: { type: string; id?: string }[];
    protection?: "heavy" | "screened";
};

function bdHitsWithProtectionDrm(
    dice: number,
    screens: ScreenLevel,
    protectionDrm: number,
    source: RollSource
): { hits: number; rolls: number[] } {
    const rolls: number[] = [];
    let hits = 0;
    for (let i = 0; i < Math.max(0, dice); i++) {
        const roll = source.next();
        rolls.push(roll);
        const adjusted = Math.max(1, Math.min(6, roll + protectionDrm));
        if (adjusted <= 3) continue;
        if (adjusted === 4 && screens >= 1) continue;
        if (adjusted === 5) hits += 1;
        else if (adjusted === 6) hits += screens >= 2 ? 1 : 2;
    }
    return { hits, rolls };
}

export function pushGunboatKillCommands(
    cmds: FullThrustGameCommand[],
    targetId: string,
    gunboat: GunboatTarget,
    kills: number,
    source: RollSource
): void {
    if (kills <= 0 || !targetId) return;
    const before = gunboat.number ?? 6;
    applyGunboatKills(gunboat, kills, source);
    cmds.push({
        name: "adjustGunboats",
        id: targetId,
        number: gunboat.number,
    } as FullThrustGameCommand);
    if ((gunboat.number ?? 0) <= 0) {
        cmds.push({ name: "objDestroy", uuid: targetId } as FullThrustGameCommand);
    } else if (gunboat.number !== before) {
        void before;
    }
}

export function resolveShipFireVsGunboats(
    declaration: FullThrustGameCommand,
    source: RollSource,
    target: GunboatTarget | undefined,
    profileKey: ShipFireProfileKey
): FullThrustGameCommand[] {
    const c = declaration as {
        ship?: string;
        weapon?: string;
        target?: string;
        notes?: string;
    };
    const meta = decodeFireDeclarationNotes(c.notes) as FireDeclarationMeta;
    const profile = shipFireProfile(profileKey);
    const protectionDrm = gunboatProtectionDrm({
        protection: target?.protection,
    });
    const screens = 0 as ScreenLevel;
    const range = meta.range ?? 0;
    const mark = source.mark();
    let hits = 0;

    if (profileKey === "needle") {
        const roll = source.next();
        hits = roll >= 4 ? 1 : 0;
    } else if (profileKey === "mkp") {
        const mkp = resolveMkpHits(range, source);
        hits = mkp.hits;
    } else if (profile.attackKind === "fixedBd") {
        let dice = profile.fixedDice ?? 1;
        if (profileKey === "submunition") {
            if (range <= 6) dice = 3;
            else if (range <= 12) dice = 2;
            else if (range <= 18) dice = 1;
            else dice = 0;
        }
        if (profileKey === "gatlingBd") {
            const pool = bdHitsWithProtectionDrm(profile.fixedDice ?? 1, screens, protectionDrm, source);
            hits = pool.hits;
        } else {
            const resolution = resolveFixedBdPool(
                dice,
                profile.maxRangeMu ?? 48,
                range,
                screens,
                source
            );
            hits = resolution.totalDamage;
        }
    } else {
        const beamClass = meta.beamClass ?? 2;
        const bandWidth = profile.bandWidthMu ?? 12;
        const dicePool = beamDicePool(beamClass, range, bandWidth);
        if (profile.damageKind === "plasmaPerHit") {
            for (let i = 0; i < dicePool; i++) {
                const roll = source.next();
                const adjusted = Math.max(1, Math.min(6, roll + protectionDrm));
                if (adjusted >= 4) hits += 1;
            }
        } else {
            const pool = bdHitsWithProtectionDrm(dicePool, screens, protectionDrm, source);
            hits = pool.hits;
        }
    }

    const consumed = source.consumedSince(mark);
    const weaponLabel = meta.weaponName ?? c.weapon ?? "weapon";
    const targetLabel = c.target ?? "—";
    const before = target?.number ?? 6;
    const kills = Math.min(before, hits);
    const after = Math.max(0, before - kills);
    const summary = `${weaponLabel} → ${targetLabel}: ${kills} gunboat(s) destroyed (${after} remain)`;

    const cmds: FullThrustGameCommand[] = [
        makeLogDice({
            purpose: `resolveShipFire: ${c.ship} — ${weaponLabel} → ${targetLabel}`,
            rolls: consumed,
            source: "moderatorSequence",
            context: c.weapon,
            result: summary,
        }),
        {
            name: "fireWeapon",
            ship: c.ship,
            weapon: c.weapon,
            target: c.target,
            rolls: consumed,
            notes: summary,
        } as FullThrustGameCommand,
    ];

    if (target && c.target && kills > 0) {
        pushGunboatKillCommands(cmds, c.target, target, kills, source);
    }
    return cmds;
}
