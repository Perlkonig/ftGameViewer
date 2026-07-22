import { describe, it, expect } from "vitest";
import fnv from "fnv-plus";
import { ssdPlateIds } from "./ssdPlates";

describe("ssdPlateIds", () => {
    it("matches ftlibship hashing for a hashseed", () => {
        const hashseed = "abc123";
        fnv.seed(hashseed);
        const expectedName = fnv.hash("_resizeNamePlate").hex();
        const expectedStats = fnv.hash("_resizeStats").hex();
        expect(ssdPlateIds(hashseed)).toEqual({
            namePlateId: expectedName,
            statsPlateId: expectedStats,
        });
    });

    it("uses literal ids without hashseed", () => {
        expect(ssdPlateIds(undefined)).toEqual({
            namePlateId: "_resizeNamePlate",
            statsPlateId: "_resizeStats",
        });
    });
});
