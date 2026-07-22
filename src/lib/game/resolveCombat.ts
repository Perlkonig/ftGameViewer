import type { FullThrustGameCommand } from "@/schemas/commands";
import type { RollSource } from "./dice";
import {
    applyDamageToShip,
    normalizeArmourDamageTaken,
    normalizeArmourLayers,
    resolvePdsPool,
    type DamageApplication,
    type DamageType,
} from "./combat";
import {
    formatAppliedDamage,
    formatPdsResultNotes,
    makeLogDice,
} from "./rollResults";
import type { FullThrustGamePosition } from "@/schemas/position";
import { shipDestroyedByHullDamage } from "./thresholds";
import type { ShipFireProfileKey } from "./shipFireProfiles";
import {
    fireProfileDiceInfo,
    resolveShipFireProfile,
    type ShipFireResolveContext,
} from "./shipFireResolve";
import { findWeaponEntry, type ShipGameState } from "./shipSystems";
import { targetStealthLevel } from "./projectileHit";
import { pushGunboatKillCommands } from "./shipFireGunboats";

export { formatAppliedDamage as formatBeamFireResultNotes } from "./rollResults";

export interface ShipDamageTarget {
    dmgHull?: number;
    dmgArmour?: { standard?: number; regenerative?: number }[];
    object?: {
        hull?: { points?: number; rows?: number; stealth?: string | number };
        armour?: { standard?: number; regenerative?: number }[];
    };
    mass?: number;
    speed?: number;
}

export interface FireDeclarationMeta {
    profile: ShipFireProfileKey;
    beamClass?: number;
    screens?: number;
    pdsDice?: number;
    needleSystemId?: string;
    range?: number;
    arc?: number;
    weaponName?: string;
    fireControlId?: string;
    alteredFromDefaults?: string[];
    aimPoint?: { x: number; y: number };
}

export function encodeFireDeclarationNotes(meta: FireDeclarationMeta): string {
    return JSON.stringify(meta);
}

export function decodeFireDeclarationNotes(notes: string | undefined): FireDeclarationMeta {
    if (!notes) return { profile: "beam" };
    try {
        return JSON.parse(notes) as FireDeclarationMeta;
    } catch {
        return { profile: "beam" };
    }
}

/** Compute armour/hull damage application without mutating command list. */
export function computeShipDamageApplication(
    ship: ShipDamageTarget,
    normal: number,
    penetrating: number,
    type: DamageType
): DamageApplication | null {
    if (normal + penetrating <= 0) return null;
    const hull = ship.object?.hull;
    const hullBoxes = hull?.points ?? 12;
    const dmgBefore = Number(ship.dmgHull ?? 0) || 0;
    const armourSrc = ship.object?.armour;
    const armourLayers = normalizeArmourLayers(armourSrc);
    const already = Array.isArray(ship.dmgArmour)
        ? ship.dmgArmour.map(normalizeArmourDamageTaken)
        : [];
    return applyDamageToShip(
        armourLayers,
        already,
        Math.max(0, hullBoxes - dmgBefore),
        normal,
        type,
        penetrating
    );
}

/** Append destroy commands when hull damage fills the last hull box. */
export function pushShipDestroyedCommands(
    cmds: FullThrustGameCommand[],
    shipId: string
): void {
    cmds.push({
        name: "_custom",
        msg: `Ship ${shipId} destroyed.`,
    } as FullThrustGameCommand);
    cmds.push({ name: "objDestroy", uuid: shipId } as FullThrustGameCommand);
}

/** Append dmgShip from a resolved damage application. */
export function pushAppliedHullDamageCommands(
    cmds: FullThrustGameCommand[],
    shipId: string,
    ship: ShipDamageTarget,
    applied: DamageApplication
): void {
    cmds.push({
        name: "dmgShip",
        ship: shipId,
        hull: applied.hullDamage,
        armour: applied.armourDamage.length ? applied.armourDamage : undefined,
    } as FullThrustGameCommand);
    if (shipDestroyedByHullDamage(ship, applied.hullDamage)) {
        pushShipDestroyedCommands(cmds, shipId);
    }
}

/** Hull-only damage — screens and armour do not apply (e.g. AMT rack explosion). */
export function pushRawHullDamageCommands(
    cmds: FullThrustGameCommand[],
    shipId: string,
    ship: ShipDamageTarget,
    hullDamage: number
): void {
    if (hullDamage <= 0) return;
    cmds.push({
        name: "dmgShip",
        ship: shipId,
        hull: hullDamage,
    } as FullThrustGameCommand);
    if (shipDestroyedByHullDamage(ship, hullDamage)) {
        pushShipDestroyedCommands(cmds, shipId);
    }
}

/** Append dmgShip for resolved weapon damage (pending threshold set in applyCommand). */
export function pushHullDamageCommands(
    cmds: FullThrustGameCommand[],
    shipId: string,
    ship: ShipDamageTarget,
    normal: number,
    penetrating: number,
    type: DamageType
): DamageApplication | null {
    const applied = computeShipDamageApplication(ship, normal, penetrating, type);
    if (!applied) return null;
    pushAppliedHullDamageCommands(cmds, shipId, ship, applied);
    return applied;
}

/** @deprecated Use resolveFireDeclaration */
export function resolveBeamDeclaration(
    declaration: FullThrustGameCommand,
    source: RollSource,
    target: ShipDamageTarget | undefined,
    position?: FullThrustGamePosition
): FullThrustGameCommand[] {
    return resolveFireDeclaration(declaration, source, target, position);
}

/** Dice breakdown for resolving a stored fire declaration. */
export interface FireDeclarationDiceInfo {
    attackPool: number;
    rangeBand: number;
    rangeMu: number;
}

export function fireDeclarationDiceInfo(
    declaration: FullThrustGameCommand
): FireDeclarationDiceInfo {
    return fireProfileDiceInfo(declaration);
}

export function resolvePdsDeclaration(
    declaration: FullThrustGameCommand,
    source: RollSource,
    target: { objType?: string; id?: string; number?: number } | undefined
): FullThrustGameCommand[] {
    const c = declaration as {
        ship?: string;
        weapon?: string;
        target?: string;
        notes?: string;
    };
    const meta = decodeFireDeclarationNotes(c.notes);
    const pdsDice = meta.pdsDice ?? 1;
    const mark = source.mark();
    const pds = resolvePdsPool(source, pdsDice);
    const consumed = source.consumedSince(mark);
    const cmds: FullThrustGameCommand[] = [];
    const weaponLabel = meta.weaponName ?? c.weapon ?? "weapon";
    const targetLabel = c.target ?? "—";
    const beforeFighters =
        target?.objType === "fighters" ? Number(target.number ?? 6) || 0 : undefined;
    const afterFighters =
        beforeFighters !== undefined
            ? Math.max(0, beforeFighters - pds.kills)
            : undefined;
    const resultNotes = formatPdsResultNotes(
        pds.kills,
        target?.objType,
        beforeFighters,
        afterFighters
    );
    const summary = `${weaponLabel} → ${targetLabel}: ${resultNotes}`;

    cmds.push(
        makeLogDice({
            purpose: `resolveShipFire: ${c.ship} — ${weaponLabel} → ${targetLabel}`,
            rolls: consumed,
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
        rolls: consumed,
        notes: summary,
    } as FullThrustGameCommand);
    if (target?.objType === "fighters" && c.target) {
        const before = beforeFighters ?? 0;
        const after = afterFighters ?? 0;
        cmds.push({
            name: "adjustFighters",
            id: c.target,
            number: after,
        } as FullThrustGameCommand);
        if (after === 0) {
            cmds.push({ name: "objDestroy", uuid: c.target } as FullThrustGameCommand);
        }
    } else if (target?.objType === "ordnance" && c.target && pds.kills > 0) {
        cmds.push({ name: "objDestroy", uuid: c.target } as FullThrustGameCommand);
    } else if (target?.objType === "gunboats" && c.target && pds.kills > 0) {
        const gunboat = { ...target, id: c.target };
        pushGunboatKillCommands(cmds, c.target, gunboat, pds.kills, source);
    }
    return cmds;
}

export function buildShipFireContext(
    declaration: FullThrustGameCommand,
    position?: FullThrustGamePosition
): ShipFireResolveContext {
    const c = declaration as { ship?: string; weapon?: string; target?: string };
    const firer = position?.objects?.find((o) => o.id === c.ship && o.objType === "ship") as
        | ShipGameState
        | undefined;
    const targetObj = position?.objects?.find((o) => o.id === c.target);
    const weapon = firer && c.weapon ? findWeaponEntry(firer, c.weapon) : undefined;
    const meta = decodeFireDeclarationNotes((declaration as { notes?: string }).notes);
    const stealth =
        targetObj && "object" in targetObj
            ? targetStealthLevel(
                  (targetObj as ShipDamageTarget).object?.hull?.stealth ?? 0
              )
            : 0;
    return {
        position,
        firer,
        weapon,
        targetSpeed: Number((targetObj as { speed?: number })?.speed ?? 0),
        targetStealth: stealth,
        targetMass: Number((targetObj as { mass?: number } | undefined)?.mass ?? 50),
        aimPoint: meta.aimPoint,
    };
}

export function resolveFireDeclaration(
    declaration: FullThrustGameCommand,
    source: RollSource,
    target: ShipDamageTarget | { objType?: string; id?: string; number?: number } | undefined,
    position?: FullThrustGamePosition
): FullThrustGameCommand[] {
    const ctx = buildShipFireContext(declaration, position);
    return resolveShipFireProfile(declaration, source, target, ctx);
}
