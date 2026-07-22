/** Encode/decode declareRepairOrders notes JSON. */

export interface RepairAllocation {
    targetId: string;
    dcp: number;
}

export interface RepairOrdersV1 {
    v: 1;
    allocations: RepairAllocation[];
    repairRegenArmour?: boolean;
}

export function encodeRepairOrdersNotes(orders: RepairOrdersV1): string {
    return JSON.stringify(orders);
}

export function decodeRepairOrdersNotes(notes: string | undefined): RepairOrdersV1 | null {
    if (!notes) return null;
    try {
        const parsed = JSON.parse(notes) as RepairOrdersV1;
        if (parsed.v !== 1 || !Array.isArray(parsed.allocations)) return null;
        return parsed;
    } catch {
        return null;
    }
}

export function totalDcpAllocated(orders: RepairOrdersV1): number {
    return orders.allocations.reduce((s, a) => s + Math.max(0, Math.floor(a.dcp)), 0);
}
