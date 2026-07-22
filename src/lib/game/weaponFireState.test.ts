import { describe, expect, it } from "vitest";
import {
    applyBankEmpHitsCommand,
    markWeaponUsed,
    queueTransporterDelivery,
    consumeTransporterDeliverySlot,
    totalPendingTransporterSlots,
    pendingForFirer,
    hasPendingTransporterDeliveries,
    pendingTransporterSummary,
    assertNoPendingTransporterDeliveries,
} from "./weaponFireState";
import type { FoldState } from "./applyCommand";

describe("markWeaponUsed", () => {
    it("records pds and shipFire separately", () => {
        const fold: FoldState = {
            meta: {
                phase: 11,
                turn: 1,
                version: "",
                name: "",
                createdAt: "",
                dicePolicy: "hybrid",
            },
            position: { map: { mode: "fixed", width: 72, height: 48 } },
        };
        const afterPd = markWeaponUsed(fold, "w1", "pds");
        expect(afterPd.w1).toBe("pds");
        const afterFire = markWeaponUsed({ ...fold, weaponUsedThisTurn: afterPd }, "w2", "shipFire");
        expect(afterFire.w2).toBe("shipFire");
    });
});

describe("bankEmpHits", () => {
    it("accumulates hits per target", () => {
        let state = applyBankEmpHitsCommand(undefined, {
            targetShip: "T1",
            firerShip: "A",
            weapon: "e1",
            hits: 2,
        });
        state = applyBankEmpHitsCommand(state, {
            targetShip: "T1",
            firerShip: "B",
            weapon: "e2",
            hits: 1,
        });
        expect(state.T1?.totalHits).toBe(3);
        expect(state.T1?.contributors).toHaveLength(2);
    });
});

describe("transporter delivery queue", () => {
    it("queues and consumes slots", () => {
        let q = queueTransporterDelivery(undefined, "F1", "T1", "tr1", 2);
        expect(q[0].remaining).toBe(2);
        const c1 = consumeTransporterDeliverySlot(q, "F1", "T1", "tr1");
        expect(c1.hadSlot).toBe(true);
        expect(c1.remaining[0].remaining).toBe(1);
        const c2 = consumeTransporterDeliverySlot(c1.remaining, "F1", "T1", "tr1");
        expect(c2.hadSlot).toBe(true);
        expect(c2.remaining).toHaveLength(0);
    });

    it("helper functions summarize pending slots", () => {
        const pending = queueTransporterDelivery(undefined, "F1", "T1", "tr1", 2);
        expect(totalPendingTransporterSlots(pending)).toBe(2);
        expect(hasPendingTransporterDeliveries(pending)).toBe(true);
        expect(pendingForFirer(pending, "F1")).toHaveLength(1);
        expect(pendingTransporterSummary(pending)[0]).toMatch(/F1 → T1/);
        expect(() => assertNoPendingTransporterDeliveries(pending)).toThrow(
            /Transporter delivery pending/
        );
    });
});
