/** Encode/decode boarding order notes JSON (attacker / defender commands). */

import type { FullThrustGameCommand } from "@/schemas/commands";

export interface UnitAllocation {
    unitId: string;
    allocation: "kill" | "raze";
}

export interface DcpRepelAssignment {
    boarderId: string;
    dcp: number;
}

export interface MarineFightAssignment {
    boarderId: string;
    marineId: string;
}

export interface AttackerBoardingNotes {
    v: 2;
    attackerOwner: string;
    unitAllocations: UnitAllocation[];
}

export interface DefenderBoardingNotes {
    v: 2;
    dcpRepel?: DcpRepelAssignment[];
    marineFight?: MarineFightAssignment[];
}

/** Internal resolver shape (role inferred from command). */
export interface BoardingOrdersV2 {
    v: 2;
    role: "attacker" | "defender";
    attackerOwner?: string;
    unitAllocations?: UnitAllocation[];
    dcpRepel?: DcpRepelAssignment[];
    marineFight?: MarineFightAssignment[];
}

export type BoardingOrders = BoardingOrdersV2;

/** Standard boarding step names (rules: three steps with 1a–1c substeps). */
export const BOARDING_STEP_LABELS = {
    attackerAllocation: "Step 1a: Attacker Allocation",
    defenderAllocation: "Step 1b: Defender Allocation",
    dcpRepel: "Step 1c: DCP Repel",
    resolveCombat: "Step 2: Resolve Combat",
    raze: "Step 3: Raze",
} as const;

export function isBoardingDeclareCommand(cmd: FullThrustGameCommand): boolean {
    return (
        cmd.name === "declareBoardingAttackerOrders" ||
        cmd.name === "declareBoardingDefenderOrders"
    );
}

export function boardingCommandRole(
    cmd: FullThrustGameCommand
): "attacker" | "defender" | null {
    if (cmd.name === "declareBoardingAttackerOrders") return "attacker";
    if (cmd.name === "declareBoardingDefenderOrders") return "defender";
    return null;
}

export function encodeAttackerBoardingNotes(notes: AttackerBoardingNotes): string {
    return JSON.stringify(notes);
}

export function encodeDefenderBoardingNotes(notes: DefenderBoardingNotes): string {
    return JSON.stringify(notes);
}

export function decodeAttackerBoardingNotes(notes: string | undefined): AttackerBoardingNotes | null {
    if (!notes) return null;
    try {
        const parsed = JSON.parse(notes) as AttackerBoardingNotes;
        if (parsed.v !== 2 || !parsed.attackerOwner) return null;
        return parsed;
    } catch {
        return null;
    }
}

export function decodeDefenderBoardingNotes(notes: string | undefined): DefenderBoardingNotes | null {
    if (!notes) return null;
    try {
        const parsed = JSON.parse(notes) as DefenderBoardingNotes;
        if (parsed.v !== 2) return null;
        return parsed;
    } catch {
        return null;
    }
}

export function decodeBoardingOrdersNotes(notes: string | undefined): BoardingOrdersV2 | null {
    const att = decodeAttackerBoardingNotes(notes);
    if (att) {
        return {
            v: 2,
            role: "attacker",
            attackerOwner: att.attackerOwner,
            unitAllocations: att.unitAllocations ?? [],
        };
    }
    const def = decodeDefenderBoardingNotes(notes);
    if (def) {
        return {
            v: 2,
            role: "defender",
            dcpRepel: def.dcpRepel,
            marineFight: def.marineFight,
        };
    }
    return null;
}

export function boardingNotesFromCommand(cmd: FullThrustGameCommand): BoardingOrdersV2 | null {
    const notesStr = (cmd as { notes?: string }).notes;
    const role = boardingCommandRole(cmd);
    if (!role) return null;
    if (role === "attacker") {
        const att = decodeAttackerBoardingNotes(notesStr);
        if (!att) return null;
        return {
            v: 2,
            role: "attacker",
            attackerOwner: att.attackerOwner,
            unitAllocations: att.unitAllocations ?? [],
        };
    }
    const def = decodeDefenderBoardingNotes(notesStr);
    if (!def) return null;
    return {
        v: 2,
        role: "defender",
        dcpRepel: def.dcpRepel,
        marineFight: def.marineFight,
    };
}

/** @deprecated Use encodeAttackerBoardingNotes / encodeDefenderBoardingNotes */
export function encodeBoardingOrdersNotes(orders: BoardingOrdersV2): string {
    if (orders.role === "attacker") {
        return encodeAttackerBoardingNotes({
            v: 2,
            attackerOwner: orders.attackerOwner ?? "",
            unitAllocations: orders.unitAllocations ?? [],
        });
    }
    return encodeDefenderBoardingNotes({
        v: 2,
        dcpRepel: orders.dcpRepel,
        marineFight: orders.marineFight,
    });
}
