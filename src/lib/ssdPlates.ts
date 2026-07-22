import fnv from "fnv-plus";

/** ftlibship hashes plate element ids when hashseed is set (always after renderSvg). */
export function ssdPlateIds(hashseed: string | undefined): {
    namePlateId: string;
    statsPlateId: string;
} {
    if (hashseed === undefined) {
        return { namePlateId: "_resizeNamePlate", statsPlateId: "_resizeStats" };
    }
    fnv.seed(hashseed);
    return {
        namePlateId: fnv.hash("_resizeNamePlate").hex(),
        statsPlateId: fnv.hash("_resizeStats").hex(),
    };
}
