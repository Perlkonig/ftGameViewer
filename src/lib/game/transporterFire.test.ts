import { describe, expect, it } from "vitest";
import type { FullThrustShip } from "ftlibship";
import { arrayRollSource } from "./dice";
import {
    applyTransporterDelivery,
    commandoValidTargets,
    isCommandoValidTarget,
    resolveCommandoRaidRoll,
    transporterFirerCapacity,
} from "./transporterFire";
import { repairTargetsForShip } from "./repairSystems";
import type { ShipWithCrewDeployment } from "./crewDeployment";
import type { ShipWithBoarders } from "./boardingState";
import type { FullThrustGamePosition } from "@/schemas/position";
import type { ShipGameState } from "./shipSystems";

const validTacoma = `{"hull":{"points":15,"rows":4,"stealth":"0","streamlining":"none"},"armour":[],"systems":[{"name":"drive","thrust":6,"advanced":false,"id":"CX-A9"},{"name":"ftl","advanced":false,"id":"O_hFB"},{"name":"fireControl","id":"1lIra"},{"name":"beam","class":1,"leftArc":"F","numArcs":6,"id":"U66Pl"}],"weapons":[],"ordnance":[],"extras":[],"fighters":[],"mass":50,"class":"Tacoma","name":"Test","points":100,"cpv":80,"notes":"","orientation":"alpha"}`;

function tacomaShip(
    id: string,
    owner: string,
    extra?: Partial<ShipWithCrewDeployment & ShipWithBoarders>
): ShipWithCrewDeployment & ShipWithBoarders {
    const object = JSON.parse(validTacoma) as FullThrustShip;
    object.systems!.push(
        { name: "marines", id: `${id}-m1` },
        { name: "marines", id: `${id}-m2` },
        { name: "damageControl", id: `${id}-dcp1` }
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
    } as ShipWithCrewDeployment & ShipWithBoarders;
}

describe("resolveCommandoRaidRoll", () => {
    it("maps golden chart outcomes", () => {
        expect(resolveCommandoRaidRoll(1, arrayRollSource([1]))).toMatchObject({
            systemDestroyed: false,
            marinesSurvive: true,
        });
        expect(resolveCommandoRaidRoll(2, arrayRollSource([2]))).toMatchObject({
            systemDestroyed: false,
            marinesSurvive: false,
        });
        expect(resolveCommandoRaidRoll(5, arrayRollSource([5]))).toMatchObject({
            systemDestroyed: true,
            marinesSurvive: false,
        });
        expect(resolveCommandoRaidRoll(6, arrayRollSource([6]))).toMatchObject({
            systemDestroyed: true,
            marinesSurvive: true,
        });
    });

    it("retries on roll 4 and survives when retry is 4+", () => {
        const survive = resolveCommandoRaidRoll(4, arrayRollSource([5]));
        expect(survive.rolls).toEqual([4, 5]);
        expect(survive.marinesSurvive).toBe(true);
        const killed = resolveCommandoRaidRoll(4, arrayRollSource([3]));
        expect(killed.rolls).toEqual([4, 3]);
        expect(killed.marinesSurvive).toBe(false);
    });
});

describe("commandoValidTargets", () => {
    const target: ShipGameState = {
        id: "T1",
        object: {
            systems: [
                { id: "drive1", name: "drive" },
                { id: "b1", name: "beam" },
                { id: "stealth1", name: "stealth" },
                { id: "core1", name: "reactor" },
            ],
        },
        systems: [
            { id: "drive1", state: "ok" },
            { id: "b1", state: "ok" },
            { id: "stealth1", state: "ok" },
            { id: "core1", state: "ok" },
            { id: "dead", state: "destroyed" },
        ],
    };

    it("excludes core, stealth, and destroyed systems", () => {
        const ids = commandoValidTargets(target).map((t) => t.id);
        expect(ids).toEqual(["b1"]);
        expect(
            isCommandoValidTarget({ id: "drive1", name: "drive" }, target)
        ).toBe(false);
        expect(isCommandoValidTarget({ id: "b1", name: "beam" }, target)).toBe(true);
    });
});

describe("applyTransporterDelivery", () => {
    it("boards a marine from firer to target", () => {
        const position: FullThrustGamePosition = {
            map: { mode: "fixed", width: 72, height: 48 },
            objects: [tacomaShip("F1", "P1"), tacomaShip("T1", "P2")] as never,
        };
        applyTransporterDelivery(
            position,
            "F1",
            "T1",
            "P1",
            { mode: "boarding", payload: "marine" },
            arrayRollSource([6])
        );
        const target = position.objects!.find((o) => o.id === "T1") as ShipWithBoarders;
        const firer = position.objects!.find((o) => o.id === "F1") as ShipWithCrewDeployment;
        expect(target.boarders?.units?.filter((u) => u.type === "marine")).toHaveLength(1);
        expect(target.boarders?.units?.[0]?.fromShip).toBe("F1");
        expect(firer.crewDeployment?.deployed).toContain("F1-m1");
    });

    it("boards DCP via hired team when available", () => {
        const position: FullThrustGamePosition = {
            map: { mode: "fixed", width: 72, height: 48 },
            objects: [tacomaShip("F1", "P1"), tacomaShip("T1", "P2")] as never,
        };
        applyTransporterDelivery(
            position,
            "F1",
            "T1",
            "P1",
            { mode: "boarding", payload: "dcp" },
            arrayRollSource([6])
        );
        const target = position.objects!.find((o) => o.id === "T1") as ShipWithBoarders;
        const firer = position.objects!.find((o) => o.id === "F1") as ShipWithCrewDeployment;
        expect(target.boarders?.units?.filter((u) => u.type === "dcp")).toHaveLength(1);
        expect(firer.crewDeployment?.deployed).toContain("F1-dcp1");
    });

    it("destroys commando target on roll 5", () => {
        const position: FullThrustGamePosition = {
            map: { mode: "fixed", width: 72, height: 48 },
            objects: [
                tacomaShip("F1", "P1"),
                tacomaShip("T1", "P2", {
                    systems: [{ id: "U66Pl", state: "ok" }],
                }),
            ] as never,
        };
        const { logCommands } = applyTransporterDelivery(
            position,
            "F1",
            "T1",
            "P1",
            { mode: "commando", payload: "marine", commandoSystemId: "U66Pl" },
            arrayRollSource([5])
        );
        const target = position.objects!.find((o) => o.id === "T1") as ShipWithCrewDeployment;
        expect(target.systems?.find((s) => s.id === "U66Pl")?.state).toBe("destroyed");
        expect(logCommands.some((c) => c.name === "logDice")).toBe(true);
        const repairShip = {
            id: "T1",
            object: target.object,
            systems: target.systems,
        };
        expect(repairTargetsForShip(repairShip).some((t) => t.id === "U66Pl")).toBe(false);
    });
});

describe("transporterFirerCapacity", () => {
    it("counts undeployed marines and DCP", () => {
        const firer = tacomaShip("F1", "P1", {
            crewDeployment: { deployed: ["F1-m1"], deployedBuiltinDcp: 0 },
        });
        const cap = transporterFirerCapacity(firer);
        expect(cap.marinesAvailable).toBe(1);
        expect(cap.dcpAvailable).toBeGreaterThan(0);
    });
});
