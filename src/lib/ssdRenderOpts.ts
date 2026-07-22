/** Shared ftLibShip RenderOpts from game ship state. */

import type { RenderOpts, HangarState } from "ftlibship";
import { buildAmmunitionRemaining } from "./ammunition";
import {
    boardersToInvaderEntries,
    type ShipWithBoarders,
} from "./game/boardingState";
import { buildDcpState } from "./game/crewDeployment";
import { coreDisabledRenderIds, type CoreState } from "./game/coreSystems";
import { shipHangarState } from "./hangars";
import type { ShipGameState } from "./game/shipSystems";

export function buildShipRenderOpts(
    ship: ShipWithBoarders,
    opts: { minimal?: boolean } = {}
): RenderOpts {
    const dmgArmour = Array.isArray(ship.dmgArmour) ? ship.dmgArmour : [];
    const dcp = buildDcpState(ship);
    const coreDisabled = coreDisabledRenderIds(ship.coreState as CoreState | undefined);
    const disabled = [...(dcp.disabled ?? []), ...coreDisabled];
    const armour = dmgArmour.map(
        (a: { standard?: number; regenerative?: number; regenerativeLost?: number }) =>
            [a.standard ?? 0, [a.regenerative ?? 0, a.regenerativeLost ?? 0]] as [
                number,
                [number, number],
            ]
    );
    const invaders = boardersToInvaderEntries(ship);
    const ammunition = buildAmmunitionRemaining(ship);
    const hangars = shipHangarState(ship as ShipGameState & { hangars?: HangarState });
    const base: RenderOpts = {
        minimal: opts.minimal ?? true,
        damage: dcp.damage,
        armour: armour.length ? armour : undefined,
        disabled: disabled.length ? disabled : undefined,
        destroyed: dcp.destroyed,
        deployed: dcp.deployed,
        deployedBuiltinDcp: dcp.deployedBuiltinDcp,
        ammunition: Object.keys(ammunition).length ? ammunition : undefined,
    };
    if (invaders.length) {
        base.invaders = invaders;
    }
    if (Object.keys(hangars).length > 0) {
        base.hangars = hangars;
    }
    return base;
}
