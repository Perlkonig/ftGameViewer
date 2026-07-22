/** Phase 11 ship-fire resolution by profile. */

import type { FullThrustGameCommand } from "@/schemas/commands";
import type { FullThrustGamePosition } from "@/schemas/position";
import { consumeLauncherAmmunitionPatch } from "@/lib/ammunition";
import type { RollSource } from "./dice";
import {
    beamDicePool,
    beamRangeBand,
    resolveBeamAttack,
    resolveBeamDieSplit,
    resolveBdPoolNoReroll,
    resolveFixedBdPool,
    resolveKgunDamage,
    resolveMkpHits,
    resolvePlasmaDamagePerHit,
    resolveSapPerHit,
    graviticDamagePerHit,
    type ScreenLevel,
} from "./combat";
import {
    decodeFireDeclarationNotes,
    pushHullDamageCommands,
    resolvePdsDeclaration,
    type FireDeclarationMeta,
    type ShipDamageTarget,
} from "./resolveCombat";
import { makeLogDice, formatAppliedDamage, formatNeedleResultNotes } from "./rollResults";
import { shipDestroyedByHullDamage } from "./thresholds";
import {
    inferProjectileRangeProfile,
    resolveProjectileToHit,
    targetStealthLevel,
} from "./projectileHit";
import { shipFireProfile, type ShipFireProfileKey } from "./shipFireProfiles";
import { resolveShipFireVsGunboats } from "./shipFireGunboats";
import { type ShipGameState, type ShipSystemEntry } from "./shipSystems";
import { fusionDamageDice, fusionHitThreshold, fusionInRange } from "./fusionArray";
import { boardingDeliveryCommands } from "./boardingDelivery";

export interface ShipFireResolveContext {
    position?: FullThrustGamePosition;
    firer?: ShipGameState;
    weapon?: ShipSystemEntry;
    targetSpeed?: number;
    targetStealth?: 0 | 1 | 2;
    targetMass?: number;
    aimPoint?: { x: number; y: number };
}

function screensForProfile(meta: FireDeclarationMeta, key: ShipFireProfileKey): ScreenLevel {
    const profile = shipFireProfile(key);
    if (profile.screenInteraction === "ignoreStandard") return 0;
    return Math.min(2, meta.screens ?? 0) as ScreenLevel;
}

function declParts(declaration: FullThrustGameCommand, meta: FireDeclarationMeta) {
    const c = declaration as { ship?: string; weapon?: string; target?: string };
    return {
        c,
        weaponLabel: meta.weaponName ?? c.weapon ?? "weapon",
        targetLabel: c.target ?? "—",
    };
}

function appendFireLog(
    cmds: FullThrustGameCommand[],
    declaration: FullThrustGameCommand,
    meta: FireDeclarationMeta,
    rolls: number[],
    resultNotes: string,
    damage?: number
): void {
    const { c, weaponLabel, targetLabel } = declParts(declaration, meta);
    cmds.push(
        makeLogDice({
            purpose: `resolveShipFire: ${c.ship} — ${weaponLabel} → ${targetLabel}`,
            rolls,
            source: "moderatorSequence",
            context: c.weapon,
            result: resultNotes,
        })
    );
    cmds.push({
        name: "fireWeapon",
        ship: c.ship,
        weapon: c.weapon,
        target: c.target,
        rolls,
        damage,
        notes: `${weaponLabel} → ${targetLabel}: ${resultNotes}`,
    } as FullThrustGameCommand);
}

function resolveNeedle(
    declaration: FullThrustGameCommand,
    source: RollSource,
    target: ShipDamageTarget | undefined
): FullThrustGameCommand[] {
    const meta = decodeFireDeclarationNotes((declaration as { notes?: string }).notes);
    const mark = source.mark();
    const roll = source.next();
    const consumed = source.consumedSince(mark);
    const { c, weaponLabel, targetLabel } = declParts(declaration, meta);
    const needleSystemId = meta.needleSystemId ?? "";
    const resultNotes = formatNeedleResultNotes(roll, needleSystemId || undefined);
    const cmds: FullThrustGameCommand[] = [];
    appendFireLog(cmds, declaration, meta, consumed, resultNotes);
    if (roll >= 4 && target && c.target) {
        pushHullDamageCommands(cmds, c.target, target, 1, 0, "standard");
    }
    if (roll === 6 && needleSystemId && c.target) {
        cmds.push({
            name: "sysDisable",
            ship: c.target,
            system: needleSystemId,
            state: "destroyed",
        } as FullThrustGameCommand);
    }
    return cmds;
}

function resolveProjectileProfile(
    declaration: FullThrustGameCommand,
    source: RollSource,
    target: ShipDamageTarget | undefined,
    profileKey: ShipFireProfileKey,
    ctx: ShipFireResolveContext
): FullThrustGameCommand[] {
    const meta = decodeFireDeclarationNotes((declaration as { notes?: string }).notes);
    const profile = shipFireProfile(profileKey);
    const range = meta.range ?? 0;
    const { c } = declParts(declaration, meta);
    const cmds: FullThrustGameCommand[] = [];
    const mark = source.mark();

    if (profileKey === "mkp") {
        if (range > 12) {
            appendFireLog(cmds, declaration, meta, [], "Out of range");
            return cmds;
        }
        const mkp = resolveMkpHits(source);
        const damage = mkp.hits * 4;
        const applied =
            mkp.hits > 0 && target && c.target
                ? pushHullDamageCommands(cmds, c.target, target, damage, 0, "AP")
                : null;
        appendFireLog(
            cmds,
            declaration,
            meta,
            mkp.rolls,
            mkp.hits > 0 ? `MKP: ${mkp.hits} hit(s), ${damage} AP` : "Miss",
            damage
        );
        if (ctx.firer && c.weapon) {
            cmds.push({
                name: "useAmmo",
                ship: c.ship,
                systemId: c.weapon,
            } as FullThrustGameCommand);
        }
        return cmds;
    }

    if (profileKey === "fusionFlare" || profileKey === "fusionTorpedo") {
        const mode = profileKey === "fusionTorpedo" ? "torpedo" : "flare";
        if (!fusionInRange(range)) {
            appendFireLog(cmds, declaration, meta, [], "Out of range");
            return cmds;
        }
        const threshold = fusionHitThreshold(range, mode);
        const roll = source.next();
        const consumed = source.consumedSince(mark);
        if (roll < threshold) {
            appendFireLog(cmds, declaration, meta, consumed, "Miss");
            return cmds;
        }
        const dice = fusionDamageDice(range, mode);
        const screens = screensForProfile(meta, profileKey);
        const bd = resolveFixedBdPool(dice, 36, range, screens, source);
        const allRolls = [...consumed, ...source.consumedSince(mark)];
        const applied =
            target && c.target && bd.totalDamage > 0
                ? pushHullDamageCommands(
                      cmds,
                      c.target,
                      target,
                      bd.normalDamage,
                      bd.penetratingDamage,
                      "standard"
                  )
                : null;
        appendFireLog(
            cmds,
            declaration,
            meta,
            allRolls,
            formatAppliedDamage(bd.totalDamage, applied),
            bd.totalDamage
        );
        return cmds;
    }

    if (profileKey === "boardingTorpedo") {
        const stealth = ctx.targetStealth ?? 0;
        const shot = resolveProjectileToHit(range, "standard", stealth, source);
        const consumed = source.consumedSince(mark);
        if (ctx.firer && ctx.weapon?.magazine) {
            const magId = String(ctx.weapon.magazine);
            cmds.push({
                name: "useAmmo",
                ship: c.ship,
                systemId: magId,
            } as FullThrustGameCommand);
        }
        if (!shot.hit) {
            appendFireLog(cmds, declaration, meta, consumed, "Miss");
            return cmds;
        }
        if (target && c.target) {
            pushHullDamageCommands(cmds, c.target, target, 1, 0, "AP");
        }
        if (ctx.position) {
            cmds.push(...boardingDeliveryCommands(declaration, ctx.position, 1));
        }
        appendFireLog(cmds, declaration, meta, consumed, "Hit: 1 hull + 2 marines", 1);
        return cmds;
    }

    if (profileKey === "kgun") {
        const weapon = ctx.weapon;
        const prof = inferProjectileRangeProfile(weapon ?? { id: "" });
        const stealth = ctx.targetStealth ?? 0;
        const shot = resolveProjectileToHit(range, prof, stealth, source);
        const consumed = source.consumedSince(mark);
        if (!shot.hit) {
            appendFireLog(cmds, declaration, meta, consumed, "Miss");
            return cmds;
        }
        const cls = Number(weapon?.class ?? meta.beamClass ?? 1);
        const kgun = resolveKgunDamage(cls, source);
        const allRolls = [...consumed, ...kgun.rolls];
        const applied =
            target && c.target
                ? pushHullDamageCommands(cmds, c.target, target, kgun.damage, 0, "AP")
                : null;
        appendFireLog(
            cmds,
            declaration,
            meta,
            allRolls,
            formatAppliedDamage(kgun.damage, applied),
            kgun.damage
        );
        return cmds;
    }

    // pulseTorpedo
    const weapon = ctx.weapon;
    const prof = inferProjectileRangeProfile(weapon ?? { id: "" });
    const stealth = ctx.targetStealth ?? 0;
    const shot = resolveProjectileToHit(range, prof, stealth, source);
    const consumed = source.consumedSince(mark);
    if (!shot.hit) {
        appendFireLog(cmds, declaration, meta, consumed, "Miss");
        return cmds;
    }
    const sap = resolveSapPerHit(source, 6);
    const applied =
        target && c.target
            ? pushHullDamageCommands(cmds, c.target, target, sap, 0, "SAP")
            : null;
    appendFireLog(
        cmds,
        declaration,
        meta,
        consumed,
        formatAppliedDamage(sap, applied),
        sap
    );
    return cmds;
}

function resolveBeamFamily(
    declaration: FullThrustGameCommand,
    source: RollSource,
    target: ShipDamageTarget | undefined,
    profileKey: ShipFireProfileKey,
    ctx: ShipFireResolveContext
): FullThrustGameCommand[] {
    const meta = decodeFireDeclarationNotes((declaration as { notes?: string }).notes);
    const profile = shipFireProfile(profileKey);
    const beamClass = meta.beamClass ?? 2;
    const range = meta.range ?? 0;
    const bandWidth = profile.bandWidthMu ?? 12;
    const screens = screensForProfile(meta, profileKey);
    const { c } = declParts(declaration, meta);
    const cmds: FullThrustGameCommand[] = [];
    const mark = source.mark();
    const dicePool = beamDicePool(beamClass, range, bandWidth);

    if (profileKey === "emp") {
        const resolution = resolveBeamAttack({ beamClass, rangeMu: range, screens: 0 }, source);
        const consumed = source.consumedSince(mark);
        appendFireLog(
            cmds,
            declaration,
            meta,
            consumed,
            resolution.totalDamage > 0
                ? `${resolution.totalDamage} EMP hit(s) banked`
                : "Miss",
            resolution.totalDamage
        );
        if (resolution.totalDamage > 0 && c.target && c.ship && c.weapon) {
            cmds.push({
                name: "bankEmpHits",
                targetShip: c.target,
                firerShip: c.ship,
                weapon: c.weapon,
                hits: resolution.totalDamage,
            } as FullThrustGameCommand);
        }
        return cmds;
    }

    if (profileKey === "transporter") {
        const pool = resolveBdPoolNoReroll(dicePool, screens, source);
        const consumed = source.consumedSince(mark);
        appendFireLog(
            cmds,
            declaration,
            meta,
            consumed,
            pool.hits > 0 ? `${pool.hits} transporter hit(s) — declare delivery` : "Miss"
        );
        if (pool.hits > 0 && c.ship && c.target && c.weapon) {
            cmds.push({
                name: "queueTransporterDelivery",
                firerShip: c.ship,
                targetShip: c.target,
                weapon: c.weapon,
                hits: pool.hits,
            } as FullThrustGameCommand);
        }
        return cmds;
    }

    if (profile.damageKind === "plasmaPerHit") {
        let totalDamage = 0;
        const allRolls: number[] = [];
        for (let i = 0; i < dicePool; i++) {
            const { result } = resolveBeamDieSplit(source, screens);
            allRolls.push(result.roll, ...result.rerolls);
            if (result.damage > 0) {
                const plasma = resolvePlasmaDamagePerHit(screens, source);
                totalDamage += plasma.damage;
                allRolls.push(...plasma.rolls);
            }
        }
        const consumed = source.consumedSince(mark);
        const applied =
            target && c.target && totalDamage > 0
                ? pushHullDamageCommands(cmds, c.target, target, totalDamage, 0, "standard")
                : null;
        appendFireLog(
            cmds,
            declaration,
            meta,
            consumed.length ? consumed : allRolls,
            formatAppliedDamage(totalDamage, applied),
            totalDamage
        );
        return cmds;
    }

    if (profile.damageKind === "SAP") {
        let totalSap = 0;
        const dieSize = profileKey === "graserHeavy" ? 6 : 3;
        const allowReroll =
            profileKey === "graserHeavy"
                ? ctx.weapon?.highIntensity === true
                : profile.allowReroll !== false;
        const beamOpts = { allowPenetratingReroll: allowReroll };
        for (let i = 0; i < dicePool; i++) {
            const { result } = resolveBeamDieSplit(source, screens, beamOpts);
            if (result.damage > 0) totalSap += resolveSapPerHit(source, dieSize);
        }
        const consumed = source.consumedSince(mark);
        const applied =
            target && c.target && totalSap > 0
                ? pushHullDamageCommands(cmds, c.target, target, totalSap, 0, "SAP")
                : null;
        appendFireLog(
            cmds,
            declaration,
            meta,
            consumed,
            formatAppliedDamage(totalSap, applied),
            totalSap
        );
        return cmds;
    }

    if (profileKey === "gravitic") {
        const resolution = resolveBeamAttack({ beamClass, rangeMu: range, screens }, source);
        const hits = resolution.results.filter((r) => r.damage > 0).length;
        const totalDamage = hits * graviticDamagePerHit(ctx.targetSpeed ?? 0);
        const consumed = source.consumedSince(mark);
        const applied =
            target && c.target && totalDamage > 0
                ? pushHullDamageCommands(cmds, c.target, target, totalDamage, 0, "standard")
                : null;
        appendFireLog(
            cmds,
            declaration,
            meta,
            consumed,
            formatAppliedDamage(totalDamage, applied),
            totalDamage
        );
        return cmds;
    }

    const resolution = resolveBeamAttack({ beamClass, rangeMu: range, screens }, source);
    const consumed = source.consumedSince(mark);
    const applied =
        target && c.target && resolution.totalDamage > 0
            ? pushHullDamageCommands(
                  cmds,
                  c.target,
                  target,
                  resolution.normalDamage,
                  resolution.penetratingDamage,
                  "standard"
              )
            : null;
    appendFireLog(
        cmds,
        declaration,
        meta,
        consumed,
        formatAppliedDamage(resolution.totalDamage, applied),
        resolution.totalDamage
    );
    return cmds;
}

function resolveFixedBd(
    declaration: FullThrustGameCommand,
    source: RollSource,
    target: ShipDamageTarget | undefined,
    profileKey: ShipFireProfileKey
): FullThrustGameCommand[] {
    const meta = decodeFireDeclarationNotes((declaration as { notes?: string }).notes);
    const profile = shipFireProfile(profileKey);
    const range = meta.range ?? 0;
    const screens = screensForProfile(meta, profileKey);
    let dice = profile.fixedDice ?? 1;
    if (profileKey === "submunition") {
        if (range <= 6) dice = 3;
        else if (range <= 12) dice = 2;
        else if (range <= 18) dice = 1;
        else dice = 0;
    }
    const mark = source.mark();
    const resolution = resolveFixedBdPool(dice, profile.maxRangeMu ?? 48, range, screens, source);
    const consumed = source.consumedSince(mark);
    const { c } = declParts(declaration, meta);
    const cmds: FullThrustGameCommand[] = [];
    const applied =
        target && c.target && resolution.totalDamage > 0
            ? pushHullDamageCommands(
                  cmds,
                  c.target,
                  target,
                  resolution.normalDamage,
                  resolution.penetratingDamage,
                  "standard"
              )
            : null;
    appendFireLog(
        cmds,
        declaration,
        meta,
        consumed,
        formatAppliedDamage(resolution.totalDamage, applied),
        resolution.totalDamage
    );
    if (profile.consumeAmmo && c.ship && c.weapon) {
        cmds.push({ name: "useAmmo", ship: c.ship, systemId: c.weapon } as FullThrustGameCommand);
    }
    return cmds;
}

function resolveSpinal(
    declaration: FullThrustGameCommand,
    source: RollSource,
    ctx: ShipFireResolveContext
): FullThrustGameCommand[] {
    const meta = decodeFireDeclarationNotes((declaration as { notes?: string }).notes);
    const profileKey = meta.profile as ShipFireProfileKey;
    const profile = shipFireProfile(profileKey);
    const weapon = ctx.weapon;
    const size = spinalSizeFromRange(weapon?.range);
    const spec = spinalSpec(size);
    const firer = ctx.firer;
    const cmds: FullThrustGameCommand[] = [];
    if (!firer?.position || !ctx.position) {
        appendFireLog(cmds, declaration, meta, [], "Missing position");
        return cmds;
    }
    const origin = firer.position;
    const facing = Number(firer.facing ?? 12);
    const aim = ctx.aimPoint ?? (meta.aimPoint as { x: number; y: number } | undefined);
    const targetObj = ctx.position.objects?.find(
        (o) => o.id === (declaration as { target?: string }).target
    );
    const aimPoint =
        aim ??
        (targetObj && "position" in targetObj && targetObj.position
            ? targetObj.position
            : {
                  x: origin.x + facingDirection(facing).x * spec.rangeMu,
                  y: origin.y + facingDirection(facing).y * spec.rangeMu,
              });

    const ships =
        ctx.position.objects
            ?.filter((o) => o.objType === "ship" && o.position)
            .map((o) => ({ id: o.id, position: o.position! })) ?? [];

    const inBeam = enumerateSpinalTargets(origin, facing, aimPoint, spec, ships);

    for (const t of inBeam) {
        const shipState = ctx.position.objects?.find((o) => o.id === t.id) as
            | ShipDamageTarget
            | undefined;
        if (!shipState) continue;
        const subDecl = { ...declaration, target: t.id } as FullThrustGameCommand;
        if (profileKey === "pointSingularity") {
            const mark = source.mark();
            let total = 0;
            const rolls: number[] = [];
            const mass = Number((shipState as { mass?: number }).mass ?? ctx.targetMass ?? 50);
            for (let i = 0; i < (profile.fixedDice ?? 2); i++) {
                const hitRoll = source.next();
                rolls.push(hitRoll);
                if (hitRoll >= 4) {
                    const dice = pspDamageDicePerHit(mass);
                    for (let d = 0; d < dice; d++) {
                        total += source.next();
                        rolls.push(rolls[rolls.length - 1]);
                    }
                }
            }
            const consumed = source.consumedSince(mark);
            if (total > 0) {
                pushHullDamageCommands(cmds, t.id, shipState, total, 0, "AP");
            }
            appendFireLog(cmds, subDecl, meta, consumed, `PSP → ${t.id}: ${total} AP`, total);
        } else if (profileKey === "spinalPlasma") {
            const mark = source.mark();
            let total = 0;
            const screens = screensForProfile(meta, profileKey);
            for (let i = 0; i < (profile.fixedDice ?? 6); i++) {
                const plasma = resolvePlasmaDamagePerHit(screens, source);
                total += plasma.damage;
            }
            const consumed = source.consumedSince(mark);
            if (total > 0) {
                pushHullDamageCommands(cmds, t.id, shipState, total, 0, "standard");
            }
            appendFireLog(cmds, subDecl, meta, consumed, `Spinal plasma → ${t.id}: ${total}`, total);
        } else {
            const mark = source.mark();
            const screens = screensForProfile(meta, profileKey);
            const bd = resolveFixedBdPool(profile.fixedDice ?? 12, spec.rangeMu, 0, screens, source);
            const consumed = source.consumedSince(mark);
            if (bd.totalDamage > 0) {
                pushHullDamageCommands(
                    cmds,
                    t.id,
                    shipState,
                    bd.normalDamage,
                    bd.penetratingDamage,
                    "standard"
                );
            }
            appendFireLog(
                cmds,
                subDecl,
                meta,
                consumed,
                `Spinal beam → ${t.id}: ${bd.totalDamage}`,
                bd.totalDamage
            );
        }
    }

    if (cShipWeapon(declaration)) {
        const sw = cShipWeapon(declaration);
        if (sw.ship && sw.weapon) {
            cmds.push({
                name: "spinalWeaponFired",
                ship: sw.ship,
                weapon: sw.weapon,
            } as FullThrustGameCommand);
        }
    }
    return cmds;
}

function cShipWeapon(declaration: FullThrustGameCommand) {
    return declaration as { ship?: string; weapon?: string };
}

export function resolveShipFireProfile(
    declaration: FullThrustGameCommand,
    source: RollSource,
    target: ShipDamageTarget | { objType?: string; id?: string; number?: number } | undefined,
    ctx: ShipFireResolveContext = {}
): FullThrustGameCommand[] {
    const meta = decodeFireDeclarationNotes((declaration as { notes?: string }).notes);
    const profileKey = (meta.profile ?? "beam") as ShipFireProfileKey;
    const profile = shipFireProfile(profileKey);

    if (target && target.objType === "gunboats") {
        return resolveShipFireVsGunboats(
            declaration,
            source,
            target as {
                id?: string;
                number?: number;
                boats?: { type: string; id?: string }[];
                protection?: "heavy" | "screened";
            },
            profileKey
        );
    }

    if (profile.attackKind === "pds") {
        return resolvePdsDeclaration(
            declaration,
            source,
            target as { objType?: string; id?: string; number?: number } | undefined
        );
    }
    if (profile.attackKind === "needle") {
        return resolveNeedle(declaration, source, target as ShipDamageTarget);
    }
    if (profile.attackKind === "projectile") {
        return resolveProjectileProfile(
            declaration,
            source,
            target as ShipDamageTarget,
            profileKey,
            ctx
        );
    }
    if (profile.attackKind === "fixedBd") {
        return resolveFixedBd(declaration, source, target as ShipDamageTarget, profileKey);
    }
    if (profile.attackKind === "spinalLine") {
        return resolveSpinal(declaration, source, ctx);
    }
    return resolveBeamFamily(
        declaration,
        source,
        target as ShipDamageTarget,
        profileKey,
        ctx
    );
}

export function fireProfileDiceInfo(declaration: FullThrustGameCommand): {
    attackPool: number;
    rangeBand: number;
    rangeMu: number;
} {
    const meta = decodeFireDeclarationNotes((declaration as { notes?: string }).notes);
    const profileKey = (meta.profile ?? "beam") as ShipFireProfileKey;
    const profile = shipFireProfile(profileKey);
    const rangeMu = meta.range ?? 0;
    if (profile.attackKind === "pds") {
        return { attackPool: meta.pdsDice ?? 1, rangeBand: 0, rangeMu };
    }
    if (profile.attackKind === "needle") {
        return { attackPool: beamDicePool(meta.beamClass ?? 1, rangeMu), rangeBand: 0, rangeMu };
    }
    if (profile.fixedDice !== undefined) {
        return { attackPool: profile.fixedDice, rangeBand: 1, rangeMu };
    }
    const beamClass = meta.beamClass ?? 2;
    const bandWidth = profile.bandWidthMu ?? 12;
    return {
        attackPool: beamDicePool(beamClass, rangeMu, bandWidth),
        rangeBand: beamRangeBand(rangeMu, beamClass, bandWidth),
        rangeMu,
    };
}