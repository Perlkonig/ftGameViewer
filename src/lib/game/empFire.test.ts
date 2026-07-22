import { describe, expect, it } from "vitest";
import {
    empFailThreshold,
    empContributorsNeedingAllocation,
    mergedEmpAllocationsForTarget,
    resolveBankedEmp,
    empHullRowDrmForShip,
} from "./empFire";
import { arrayRollSource } from "./dice";
import type { FullThrustGameCommand } from "@/schemas/commands";

describe("empFailThreshold", () => {
    it("uses 6/5/4 by hit count", () => {
        expect(empFailThreshold(1)).toBe(6);
        expect(empFailThreshold(2)).toBe(5);
        expect(empFailThreshold(3)).toBe(4);
        expect(empFailThreshold(7)).toBe(4);
    });
});

describe("resolveBankedEmp", () => {
    it("damages systems on failed threshold rolls", () => {
        const { cmds } = resolveBankedEmp(
            "Target1",
            2,
            [{ systemId: "fc1", hitCount: 2 }],
            0,
            arrayRollSource([6, 3])
        );
        expect(cmds.some((c) => c.name === "sysDisable")).toBe(true);
        expect(cmds.some((c) => c.name === "_custom")).toBe(true);
    });

    it("applies hull-row DRM", () => {
        const { cmds } = resolveBankedEmp(
            "Target1",
            1,
            [{ systemId: "fc1", hitCount: 1 }],
            2,
            arrayRollSource([4])
        );
        expect(cmds.some((c) => c.name === "sysDisable")).toBe(true);
    });
});

describe("emp allocation helpers", () => {
    const banked = {
        Cruiser: {
            totalHits: 3,
            contributors: [
                { shipId: "A1", weaponId: "e1", hits: 2 },
                { shipId: "B1", weaponId: "e2", hits: 1 },
            ],
        },
    };

    it("lists contributors needing allocation", () => {
        const need = empContributorsNeedingAllocation(banked, []);
        expect(need).toHaveLength(2);
    });

    it("merges per-attacker allocations in contributor order", () => {
        const cmds = [
            {
                name: "declareEmpAllocation",
                targetShip: "Cruiser",
                firerShip: "A1",
                weapon: "e1",
                allocations: [{ systemId: "fc1", hitCount: 2 }],
            },
            {
                name: "declareEmpAllocation",
                targetShip: "Cruiser",
                firerShip: "B1",
                weapon: "e2",
                allocations: [{ systemId: "drv1", hitCount: 1 }],
            },
        ] as FullThrustGameCommand[];
        const merged = mergedEmpAllocationsForTarget("Cruiser", banked.Cruiser, cmds);
        expect(merged).toEqual([
            { systemId: "fc1", hitCount: 2 },
            { systemId: "drv1", hitCount: 1 },
        ]);
    });
});

describe("empHullRowDrmForShip", () => {
    it("reads ship field", () => {
        expect(empHullRowDrmForShip({ empHullRowDrm: 2 } as never)).toBe(2);
    });
});
