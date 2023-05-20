import type { FullThrustGamePosition } from "@/schemas/position"
import type { FullThrustGameCommand } from "@/schemas/commands"
import { validate } from "ftlibship";
import { XMLValidator, XMLParser } from "fast-xml-parser";
import deepclone from "rfdc/default";

export interface ITransformedState {
    state: FullThrustGamePosition;
    warnings?: string[];
}

export const applyCommand = (state: FullThrustGamePosition, cmd: FullThrustGameCommand): ITransformedState => {
    switch (cmd.name) {
        case "placeShip":
            const [s, w] = placeShip(state, cmd);
            return { state: s, warnings: w };
        default:
            throw new Error(`I don't know how to process the command named "${cmd.name}".`);
    }
}

const placeShip = (state: FullThrustGamePosition, cmd: FullThrustGameCommand): [FullThrustGamePosition, string[]|undefined] => {
    const newstate = deepclone(state) as FullThrustGamePosition;

    if (cmd.name !== "placeShip") {
        throw new Error("This function only handles 'placeShip' commands.");
    }

    // Ensure id is valid and unique
    if ( (cmd.id === undefined) || (cmd.id.length === 0) ) {
        throw new Error(`placeShip: Missing ID`);
    }
    const reID = /^[A-Za-z0-9_\-]+$/;
    if (! reID.test(cmd.id)) {
        throw new Error(`placeShip: Invalid ID`);
    }
    if (state.objects !== undefined) {
        const obj = state.objects.find(o => o.id === cmd.id);
        if (obj !== undefined) {
            throw new Error(`placeShip: Duplicate ID`);
        }
    }

    // validate ship object
    if (cmd.object === undefined) {
        throw new Error(`placeShip: Missing ship object`);
    }
    try {
        const results = validate(JSON.stringify(cmd.object));
        if (! results.valid) {
            throw new Error(`placeShip: Invalid ship object`);
        }
    } catch (e) {
        throw new Error(`placeShip: Could not validate ship object`);
    }

    // validate SVG
    if ( (cmd.svg === undefined) || (cmd.svg.length < 30) ) {
        throw new Error(`placeShip: Missing ship SVG`);
    }
    const result = XMLValidator.validate(cmd.svg, {
        allowBooleanAttributes: true
    });
    if ( (typeof result === "boolean") && (result === true) ) {
        let interim = cmd.svg.trim();
        // Parse the well-formed XML and do basic sanity check
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix : "@_",
            allowBooleanAttributes: true,
            preserveOrder: true,
            ignoreDeclaration: true,
            removeNSPrefix: true,
        });
        const output = parser.parse(interim);
        // Can only be one root tag
        if (output.length > 1) {
            throw new Error("placeShip: The custom counter has multiple root nodes");
        }
        const root = output[0];
        // Must be a symbol tag
        const rootName = [...Object.keys(root)][0] as string;
        if (rootName !== "symbol") {
            throw new Error("placeShip: Must be a <symbol> tag");
        }
        // Must have a viewbox attribute
        if (! root[":@"].hasOwnProperty("@_viewBox")) {
            throw new Error("placeShip: No `viewBox` attribute found");
        }
        // Strip ID if present
        if (root[":@"].hasOwnProperty("@_id")) {
            throw new Error("placeShip: Counter SVG must not have an ID attribute");
        }
    } else {
        throw new Error(`placeShip: Could not validate SVG`);
    }

    // validate owner
    if ( (state.players === undefined) || (state.players.length === 0) ) {
        throw new Error(`placeShip: No players found`);
    }
    if ( (cmd.owner === undefined) || (cmd.owner.length === 0) ) {
        throw new Error(`placeShip: No owner specified`);
    }
    const obj = state.players.find(p => p.id === cmd.owner);
    if (obj === undefined) {
        throw new Error(`placeShip: The given owner doesn't appear to be playing`);
    }

    // validate position
    if ( (cmd.position === undefined) || (cmd.position === null) ) {
        throw new Error(`placeShip: No position given`);
    }
    if ( (typeof cmd.position.x !== "number") || (typeof cmd.position.y !== "number") ) {
        throw new Error(`placeShip: Position must be numeric`);
    }

    // validate facing
    if (cmd.facing === undefined) {
        throw new Error(`placeShip: No facing given`);
    }
    if ( (cmd.facing < 1) || (cmd.facing > 12) ) {
        throw new Error(`placeShip: Invalid facing given`);
    }

    // validate speed
    if ( (cmd.speed === undefined) || (typeof cmd.speed !== "number") || (cmd.speed < 0) ) {
        throw new Error(`placeShip: Invalid speed given`);
    }

    // validate course
    if (cmd.course !== undefined) {
        if ( (typeof cmd.course !== "number") || (cmd.course < 0) || (cmd.course > 360) ) {
            throw new Error(`placeShip: Invalid course given`);
        }
    }

    // If we've made it here, we're good
    if (newstate.objects === undefined) { newstate.objects = [];}
    newstate.objects.push({
        objType: "ship",
        id: cmd.id,
        owner: cmd.owner,
        object: cmd.object,
        svg: cmd.svg,
        position: {x: cmd.position.x, y: cmd.position.y},
        facing: cmd.facing,
        speed: cmd.speed,
        course: cmd.course
    });

    return [newstate, undefined];
}