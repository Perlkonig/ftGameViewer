import { describe, expect, it, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
    clearActMapInteraction,
    focusMapOnFightersId,
    focusMapOnObjectId,
    focusMapOnOrdnanceId,
    focusMapOnShipId,
} from "./actMapInteraction";
import { beacon } from "@/stores/writeBeacon";
import { clickMode } from "@/stores/writeClickMode";
import { annotations } from "@/stores/writeAnnotations";
import { mapFocusRequest } from "@/stores/writeMapView";
import { selectedObject } from "@/stores/writeSelectedObject";
import type { FullThrustGameObjects } from "@/schemas/position";

describe("clearActMapInteraction", () => {
    it("clears click mode, annotations, and beacon", () => {
        clickMode.set("beacon");
        annotations.set([
            {
                id: "test",
                type: "CIRCLE",
                note: { c: { x: 0, y: 0 }, r: 10 },
            },
        ]);
        beacon.set({ x: 1, y: 2 });

        clearActMapInteraction();

        expect(get(clickMode)).toBeUndefined();
        expect(get(annotations)).toEqual([]);
        expect(get(beacon)).toBeUndefined();
    });
});

describe("focusMapOnShipId", () => {
    const ships = [
        {
            objType: "ship",
            id: "CruiserA1",
            owner: "P1",
            object: {},
            svg: "",
            position: { x: 11.2, y: 12.2 },
            facing: 3,
            speed: 0,
        },
    ] as FullThrustGameObjects[];

    beforeEach(() => {
        mapFocusRequest.set(undefined);
        selectedObject.set(undefined);
    });

    it("pans to ship position and selects it", () => {
        expect(focusMapOnShipId("CruiserA1", ships)).toBe(true);
        expect(get(mapFocusRequest)).toEqual({ x: 11.2, y: 12.2, sizeMu: 24 });
        expect(get(selectedObject)).toBe("ship_CruiserA1");
    });

    it("returns false for unknown ship", () => {
        expect(focusMapOnShipId("Missing", ships)).toBe(false);
    });
});

describe("focusMapOnObjectId", () => {
    const objects = [
        {
            objType: "fighters",
            id: "Sq1",
            owner: "P1",
            type: "standard",
            position: { x: 4, y: 7 },
            number: 6,
            endurance: 6,
            skill: "standard",
        },
        {
            objType: "ordnance",
            id: "m1",
            owner: "P1",
            type: "missile",
            position: { x: 20, y: 11 },
        },
    ] as FullThrustGameObjects[];

    beforeEach(() => {
        mapFocusRequest.set(undefined);
        selectedObject.set(undefined);
    });

    it("focuses fighter groups with larger viewport", () => {
        expect(focusMapOnFightersId("Sq1", objects)).toBe(true);
        expect(get(mapFocusRequest)).toEqual({ x: 4, y: 7, sizeMu: 48 });
        expect(get(selectedObject)).toBe("fighters_Sq1");
    });

    it("focuses ordnance on the map", () => {
        expect(focusMapOnOrdnanceId("m1", objects)).toBe(true);
        expect(get(mapFocusRequest)).toEqual({ x: 20, y: 11, sizeMu: 24 });
        expect(get(selectedObject)).toBe("ordnance_m1");
    });
});
