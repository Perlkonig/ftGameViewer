import { describe, expect, it } from "vitest";
import type { FullThrustShip } from "ftlibship";
import { dcpAvailability } from "ftlibship";
import {
    allocateDeployment,
    buildDcpState,
    casualtyIdsFromDeployed,
    dcpAvailabilityForShip,
    syncDeploymentCasualties,
    type ShipWithCrewDeployment,
} from "./crewDeployment";
import { applyCommand, foldCommands } from "./applyCommand";
import { DEFAULT_META } from "./types";
import type { FullThrustGamePosition } from "@/schemas/position";
import type { ShipWithBoarders } from "./boardingState";

const validTacoma = `{"hull":{"points":15,"rows":4,"stealth":"0","streamlining":"none"},"armour":[],"systems":[{"name":"drive","thrust":6,"advanced":false,"id":"CX-A9"},{"name":"ftl","advanced":false,"id":"O_hFB"},{"name":"fireControl","id":"1lIra"},{"name":"fireControl","id":"z8Ahb"},{"name":"screen","id":"xJc7e"}],"weapons":[{"name":"pds","id":"zkCHa"},{"name":"pds","id":"kRzGt"},{"name":"beam","class":1,"leftArc":"F","numArcs":6,"id":"U66Pl"},{"name":"beam","class":1,"leftArc":"F","numArcs":6,"id":"rnlPA"},{"name":"beam","class":2,"leftArc":"AP","numArcs":3,"id":"pxn5M"},{"name":"beam","class":2,"leftArc":"F","numArcs":3,"id":"Y174V"},{"name":"beam","class":2,"leftArc":"FP","numArcs":3,"id":"eySY3"}],"ordnance":[],"extras":[],"fighters":[],"mass":50,"class":"Tacoma Class Light Cruiser","name":"Aaron","points":167,"cpv":142,"notes":"","orientation":"alpha"}`;

function tacomaShip(overrides: Partial<ShipWithCrewDeployment> = {}): ShipWithCrewDeployment {
    const object = JSON.parse(validTacoma) as FullThrustShip;
    object.systems!.push(
        { name: "marines", id: "m1" },
        { name: "marines", id: "m2" },
        { name: "damageControl", id: "dcp1" }
    );
    return {
        objType: "ship",
        id: "Tacoma",
        owner: "P1",
        object,
        svg: "<symbol></symbol>",
        position: { x: 0, y: 0 },
        facing: 0,
        speed: 0,
        ...overrides,
    } as ShipWithCrewDeployment;
}

describe("buildDcpState", () => {
    it("maps damage, deployed, and disabled systems", () => {
        const ship = tacomaShip({
            dmgHull: 5,
            crewDeployment: { deployed: ["m1", "dcp1"], deployedBuiltinDcp: 1 },
            systems: [{ id: "U66Pl", state: "damaged" }],
        });
        const state = buildDcpState(ship);
        expect(state.damage).toBe(5);
        expect(state.deployed).toEqual(["m1", "dcp1"]);
        expect(state.deployedBuiltinDcp).toBe(1);
        expect(state.disabled).toEqual(["U66Pl"]);
    });
});

describe("dcpAvailabilityForShip", () => {
    it("matches ftLibShip for Tacoma-style fixtures", () => {
        const ship = tacomaShip();
        const expected = dcpAvailability(ship.object as FullThrustShip, buildDcpState(ship));
        expect(dcpAvailabilityForShip(ship)).toEqual(expected);
    });

    it("reduces available when crew is deployed away", () => {
        const ship = tacomaShip({
            crewDeployment: { deployed: ["dcp1"], deployedBuiltinDcp: 1 },
        });
        const dcp = dcpAvailabilityForShip(ship);
        expect(dcp.hiredDeployed).toBe(1);
        expect(dcp.builtinDeployed).toBe(1);
        expect(dcp.available).toBe(2);
    });
});

describe("allocateDeployment", () => {
    it("picks marine and DCP ids and increments deployedBuiltinDcp", () => {
        const ship = tacomaShip();
        const alloc = allocateDeployment(ship, {
            marines: 1,
            hiredDcp: 1,
            builtinDcp: 1,
        });
        expect(alloc.marineIds).toEqual(["m1"]);
        expect(alloc.dcpIds).toEqual(["dcp1"]);
        expect(alloc.builtinDcp).toBe(1);
        expect(ship.crewDeployment?.deployed).toContain("m1");
        expect(ship.crewDeployment?.deployed).toContain("dcp1");
        expect(ship.crewDeployment?.deployedBuiltinDcp).toBe(1);
    });
});

describe("syncDeploymentCasualties", () => {
    it("removes deployed ids and marks systems destroyed", () => {
        const ship = tacomaShip({
            crewDeployment: { deployed: ["m1", "m2", "dcp1"], deployedBuiltinDcp: 1 },
        });
        syncDeploymentCasualties(ship, { marineIds: ["m1"], dcpIds: ["dcp1"], builtinDcp: 1 });
        expect(ship.crewDeployment?.deployed).toEqual(["m2"]);
        expect(ship.crewDeployment?.deployedBuiltinDcp).toBe(0);
        expect(ship.systems?.find((s) => s.id === "m1")?.state).toBe("destroyed");
        expect(ship.systems?.find((s) => s.id === "dcp1")?.state).toBe("destroyed");
    });

    it("casualtyIdsFromDeployed picks FIFO within deployed list", () => {
        const ship = tacomaShip({
            crewDeployment: { deployed: ["m2", "m1", "dcp1"], deployedBuiltinDcp: 2 },
        });
        const ids = casualtyIdsFromDeployed(ship, { marines: 1, hiredDcp: 1, builtinDcp: 1 });
        expect(ids.marineIds).toEqual(["m2"]);
        expect(ids.dcpIds).toEqual(["dcp1"]);
        expect(ids.builtinDcp).toBe(1);
    });
});

describe("applyCommand deployment integration", () => {
    const baseShip = (
        id: string,
        owner: string,
        extra?: Partial<ShipWithBoarders>
    ): ShipWithBoarders => {
        const object = JSON.parse(validTacoma) as FullThrustShip;
        object.systems!.push(
            { name: "marines", id: `${id}-m1` },
            { name: "marines", id: `${id}-m2` }
        );
        return {
            objType: "ship",
            id,
            owner,
            object,
            svg: "<symbol></symbol>",
            position: { x: 0, y: 0 },
            facing: 0,
            speed: 0,
            ...extra,
        } as ShipWithBoarders;
    };

    it("adjustBoarders with fromShip deploys marines on source", () => {
        const position: FullThrustGamePosition = {
            map: { mode: "fixed", width: 72, height: 48 },
            objects: [baseShip("F1", "P1"), baseShip("T1", "P2")] as FullThrustGamePosition["objects"],
        };
        const fold = { meta: DEFAULT_META(), position };
        const next = applyCommand(fold, {
            name: "adjustBoarders",
            ship: "T1",
            owner: "P1",
            marines: 1,
            fromShip: "F1",
        }).state;
        const source = next.position.objects!.find((o) => o.id === "F1") as ShipWithCrewDeployment;
        const target = next.position.objects!.find((o) => o.id === "T1") as ShipWithBoarders;
        expect(source.crewDeployment?.deployed).toContain("F1-m1");
        expect(target.boarders?.units?.filter((u) => u.type === "marine")).toHaveLength(1);
        expect(target.boarders?.units?.[0]?.fromShip).toBe("F1");
    });

    it("negative adjustBoarders syncs casualties on source ship", () => {
        const position: FullThrustGamePosition = {
            map: { mode: "fixed", width: 72, height: 48 },
            objects: [
                baseShip("F1", "P1", {
                    crewDeployment: { deployed: ["F1-m1"] },
                }),
                baseShip("T1", "P2", {
                    boarders: {
                        units: [
                            {
                                id: "brd-1",
                                type: "marine",
                                owner: "P1",
                                fromShip: "F1",
                                sourceMarineId: "F1-m1",
                            },
                        ],
                    },
                }),
            ] as FullThrustGamePosition["objects"],
        };
        const fold = { meta: DEFAULT_META(), position };
        const next = applyCommand(fold, {
            name: "adjustBoarders",
            ship: "T1",
            owner: "P1",
            marines: -1,
        }).state;
        const source = next.position.objects!.find((o) => o.id === "F1") as ShipWithCrewDeployment;
        expect(source.crewDeployment?.deployed ?? []).not.toContain("F1-m1");
        expect(source.systems?.find((s) => s.id === "F1-m1")?.state).toBe("destroyed");
    });

    it("transporter delivery fold updates defender boarders and source deployment", () => {
        const position: FullThrustGamePosition = {
            map: { mode: "fixed", width: 72, height: 48 },
            objects: [baseShip("F1", "P1"), baseShip("T1", "P2")] as FullThrustGamePosition["objects"],
        };
        const { state } = foldCommands(DEFAULT_META(), position, [
            {
                name: "adjustBoarders",
                ship: "T1",
                owner: "P1",
                marines: 1,
                fromShip: "F1",
            },
            {
                name: "adjustBoarders",
                ship: "T1",
                owner: "P1",
                marines: 1,
                fromShip: "F1",
            },
        ]);
        const source = state.position.objects!.find((o) => o.id === "F1") as ShipWithCrewDeployment;
        const target = state.position.objects!.find((o) => o.id === "T1") as ShipWithBoarders;
        expect(target.boarders?.units?.filter((u) => u.type === "marine")).toHaveLength(2);
        expect(source.crewDeployment?.deployed?.length).toBe(2);
    });
});
