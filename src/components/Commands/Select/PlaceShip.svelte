<script lang="ts">
    import { onDestroy, createEventDispatcher } from "svelte";
    import { clickMode } from "@/stores/writeClickMode";
    import { beacon } from "@/stores/writeBeacon";
    import { currentState } from "@/stores/derivedState";
    import { commands } from "@/stores/writeCommands";
    import { nanoid } from "nanoid";
    import { toast } from "@zerodevx/svelte-toast";
    import { XMLBuilder, XMLValidator, XMLParser } from "fast-xml-parser";
    import { validate } from "ftlibship";
    import type { Position, FullThrustShip } from "@/schemas/commands";
    import RenderSSD from "@/components/RenderSSD.svelte";
    import RenderCounter from "@/components/RenderCounter.svelte";
    import presets from "@/stores/counters.json";
    import Clock from "@/assets/clock.svg.svelte";

    const dispatch = createEventDispatcher();

    interface ICommand {
        [k: string]: unknown;
        name: "placeShip";
        id: string;
        object: FullThrustShip;
        svg: string;
        owner: string;
        position: null|Position;
        facing: Facing;
        course?: number;
        speed: number;
    }

    let cmd: ICommand = {
        name: "placeShip",
        id: nanoid(10),
        object: undefined,
        svg: "",
        owner: "",
        position: undefined,
        facing: 12,
        speed: 0,
        course: 0,
    };

    let shipJSON: string;
    $: if (shipJSON !== undefined) {
        try {
            const results = validate(shipJSON);
            if (results.valid) {
                cmd.object = JSON.parse(shipJSON) as FullThrustShip;
            } else {
                cmd.object = undefined;
            }
        } catch (e) {
            cmd.object = undefined;
        }
    }

    let counterType: "preset"|"custom" = "preset";
    let counterBase = 1;
    let counterVariant = 1;
    let counterSymbol: string|undefined;
    $: if ( (counterBase !== undefined) && (counterVariant !== undefined) ) {
        const counter = presets.find(x => x.base === counterBase && x.variant === counterVariant);
        if (counter !== undefined) {
            counterSymbol = counter.svg;
        } else {
            counterSymbol = undefined;
        }
        cmd.svg = counterSymbol;
    }

    let customCounter: string;
    const processCustomCounter = () => {
        if ( (customCounter !== null) && (customCounter !== undefined) && (customCounter.length > 30) ) {
            // Process customCounter
            const result = XMLValidator.validate(customCounter, {
                allowBooleanAttributes: true
            });
            if ( (typeof result === "boolean") && (result === true) ) {
                let interim = customCounter.trim();
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
                    toast.push("The custom counter has multiple root nodes.");
                    return;
                }
                const root = output[0];
                // Must be an SVG or symbol tag
                const rootName = [...Object.keys(root)][0] as string;
                if ( (rootName !== "svg") && (rootName !== "symbol") ) {
                    toast.push("You must provide either an &lt;svg&gt; or a &lt;symbol&gt; tag.");
                    return;
                }
                // Must have a viewbox attribute
                if (! root[":@"].hasOwnProperty("@_viewBox")) {
                    toast.push("No `viewBox` attribute found.");
                    return;
                }
                // Strip ID if present
                if (root[":@"].hasOwnProperty("@_id")) {
                    delete root[":@"]["@_id"];
                }
                // Rename <svg> to <symbol>
                if (rootName === "svg") {
                    Object.defineProperty(root, "symbol", Object.getOwnPropertyDescriptor(root, "svg"));
                    delete root["svg"];
                }

                // Save the result
                const builder = new XMLBuilder({
                    ignoreAttributes: false,
                    attributeNamePrefix : "@_",
                    preserveOrder: true,
                });
                let built = builder.build(output);
                customCounter = built;
            } else {
                toast.push("The custom counter code you provided is not well formed.")
            }
        }
    }
    $: if ( (counterType === "custom") && (customCounter !== undefined) && (customCounter !== null) && (customCounter.length >= 30) ) {
        processCustomCounter();
        counterSymbol = customCounter;
        cmd.svg = counterSymbol;
    }

    let owner: string;
    let ownerColour: string;
    $: if (owner !== undefined) {
        const obj = $currentState.state.players.find(x => x.id === owner);
        if (obj !== undefined) {
            ownerColour = obj.colour;
            cmd.owner = obj.id;
        } else {
            ownerColour = undefined;
            cmd.owner = undefined;
        }
    }

    $clickMode = "beacon"
    let posStr: string;
    beacon.subscribe(val => {
        if (val !== undefined) {
            posStr = `${val.x}, ${val.y}`;
            cmd.position = {x: val.x, y: val.y};
        } else {
            posStr = "";
            cmd.position = undefined;
        }
    });

    type Facing = 1|2|3|4|5|6|7|8|9|10|11|12;
    let facing: Facing  = 12;
    const handleClockClick = (e) => {
        if (e.target.id.startsWith("face")) {
            facing = parseInt(e.target.id.substring(4), 10) as Facing;
        } else {
            facing = 12;
        }
        cmd.facing = facing;
    }

    let speed = 0;
    let courseEnabled = false;

    let validShip = false;
    let warnings: string[] = [];
    const validateCommand = () => {
        warnings = [];
        const reID = /^[A-Za-z0-9_\-]+$/;
        if ( (cmd.id !== undefined) && (reID.test(cmd.id)) ) {
            if (cmd.object !== undefined) {
                if ( (cmd.svg !== undefined) && (cmd.svg !== null) && (cmd.svg.length >= 30) ) {
                    if ( (cmd.owner !== undefined) && (cmd.owner.length > 0) && ($currentState.state.players.find(x => x.id === cmd.owner) !== undefined) ) {
                        if ( (cmd.position !== undefined) && (cmd.position.hasOwnProperty("x")) && (cmd.position.x !== undefined) && (cmd.position.hasOwnProperty("y")) && (cmd.position.y !== undefined) ) {
                            if ( (cmd.facing !== undefined) && (cmd.facing >= 1) && (cmd.facing <= 12) ) {
                                if ( (cmd.speed !== undefined) && (typeof cmd.speed === "number") ) {
                                    if ( (courseEnabled !== undefined) && (courseEnabled) ) {
                                        if ( (cmd.course !== undefined) && (typeof cmd.course === "number") && (cmd.course >= 0) && (cmd.course <= 360) ) {
                                            validShip = true;
                                        } else {
                                            validShip = false;
                                            warnings.push("Invalid course")
                                        }
                                    } else {
                                        cmd.course = undefined;
                                        validShip = true;
                                    }
                                } else {
                                    validShip = false;
                                    warnings.push("Invalid speed");
                                }
                            } else {
                                validShip = false;
                                warnings.push("Invalid facing")
                            }
                        } else {
                            validShip = false;
                            warnings.push("Invalid position");
                        }
                    } else {
                        validShip = false;
                        warnings.push("Missing owner");
                    }
                } else {
                    validShip = false;
                    warnings.push("Invalid ship object")
                }
            } else {
                validShip = false;
                warnings.push(`Invalid ship JSON`);
            }
        } else {
            validShip = false;
            warnings.push(`Invalid ID`);
        }

        if (validShip) {
            commands.update(l => [...l, cmd])
            console.log("saving command");
            dispatch("done");
        }
    }

    onDestroy(() => {
        $clickMode = undefined;
        $beacon = undefined;
    });
</script>

<div class="columns">
    <div class="column is-three-fifths">
        <div class="field">
            <label class="label" for="shipID">Unique ID</label>
            <div class="control">
                <input class="input" type="text" name="shipID" bind:value={cmd.id}>
            </div>
            <p class="help">The ID cannot contain any spaces and must be unique across all objects in the game. You don't normally need to change the default.</p>
        </div>
        <div class="field">
            <label class="label" for="shipJSON">Ship JSON</label>
            <div class="control">
                <textarea class="textarea" name="shipJSON" bind:value={shipJSON}></textarea>
            </div>
            <p class="help">The JSON exported from <a href="https://www.perlkonig.com/ftShipBuilder" target="_blank">the ship builder</a></p>
        </div>
        <div class="field">
            <label class="label" for="counterType">Map Counter</label>
            <div class="control">
                <label class="radio">
                    <input type="radio" name="counterType" bind:group={counterType} value="preset">
                    Preset
                </label>
                <label class="radio">
                    <input type="radio" name="counterType" bind:group={counterType} value="custom">
                    Custom
                </label>
            </div>
            <p class="help">This is the image on the playing field that represents this ship. It is automatically resized based on the ship's mass.</p>
        </div>
    {#if (counterType !== undefined) && (counterType === "preset")}
        <div class="columns">
            <div class="column">
                <div class="field">
                    <label class="label" for="baseClass">Base</label>
                    <div class="control">
                        <div class="select">
                            <select name="baseClass" bind:value={counterBase}>
                            {#each [...new Set(presets.map(x => x.base))].sort((a, b) => a - b) as n}
                                <option value="{n}">{n}</option>
                            {/each}
                            </select>
                        </div>
                    </div>
                </div>
            </div>
        {#key counterBase}
            <div class="column">
                <div class="field">
                    <label class="label" for="classVariant">Variant</label>
                    <div class="control">
                        <div class="select">
                            <select name="classVariant" bind:value={counterVariant}>
                            {#each presets.filter(x => x.base === counterBase).map(x => x.variant).sort((a,b) => a-b) as n}
                                <option value="{n}" selected={n === 1}>{n}</option>
                            {/each}
                            </select>
                        </div>
                    </div>
                </div>
            </div>
            <div class="column">
            {#key cmd.svg}
                {#if cmd.svg !== undefined}
                    <RenderCounter
                        svg={cmd.svg}
                    />
                {/if}
            {/key}
            </div>
        {/key}
        </div>
    {:else if (counterType !== undefined) && (counterType === "custom")}
        <div class="columns">
            <div class="column is-two-thirds">
                <div class="field">
                    <label class="label" for="customSvg">Custom counter</label>
                    <div class="control">
                        <textarea class="textarea" name="customSvg" bind:value={customCounter}></textarea>
                    </div>
                    <p class="help">Must be a valid <code>&lt;svg&gt;</code> or <code>&lt;symbol&gt;</code> tag with a <code>viewBox</code> attribute.</p>
                </div>
            </div>
            <div class="column">
            {#key cmd.svg}
                {#if customCounter !== undefined}
                    <RenderCounter
                        svg={cmd.svg}
                    />
                {/if}
            {/key}
            </div>
        </div>
    {/if}
        <div class="columns">
            <div class="column is-two-thirds">
                <div class="field">
                    <label class="label" for="owner">Owner</label>
                    <div class="control">
                    {#each $currentState.state.players as p}
                        <label class="radio">
                            <input type="radio" name="owner" bind:group={owner} value="{p.id}">
                            {p.id}
                        </label>
                        {/each}
                    </div>
                </div>
            </div>
            <div class="column">
            {#key cmd.svg}
                {#if ownerColour !== undefined}
                    <RenderCounter
                        svg={cmd.svg}
                        colour={ownerColour}
                    />
                {/if}
            {/key}
            </div>
        </div>
        <div class="field">
            <label class="label" for="position">Position</label>
            <div class="control">
                <input class="input" type="text" name="position" bind:value={posStr} readonly>
            </div>
            <p class="help">Left-click on the map where you want the ship to go. A beacon will appear. You can zoom into the map to get more precise. Additional left-clicks will move the beacon. You can also right-click to clear it.</p>
        </div>
        <div class="columns">
            <div class="column is-two-thirds">
                <div class="field">
                    <label class="label" for="facing">Facing</label>
                    <div class="control" style="max-width: 15vw" on:click={handleClockClick}>
                        <Clock />
                    </div>
                    <p class="help">Select the ship's initial facing by clicking on the appropriate number.</p>
                </div>
            </div>
            <div class="column">
            {#key cmd.svg}
                {#if ownerColour !== undefined && facing !== undefined}
                    <RenderCounter
                        svg={cmd.svg}
                        colour={ownerColour}
                        facing={cmd.facing}
                    />
                {/if}
            {/key}
            </div>
        </div>
        <div class="columns">
            <div class="column">
                <div class="field">
                    <label class="label" for="shipSpeed">Speed</label>
                    <div class="control">
                        <input class="input" name="shipSpeed" type="number" min="0" step="1" bind:value={cmd.speed}>
                    </div>
                </div>
            </div>
            <div class="column">
                <div class="field">
                    <label class="label" for="shipCourse">Course</label>
                    <div class="control">
                        <input class="input" name="shipCourse" type="number" min="0" max="360" bind:value={cmd.course} disabled={!courseEnabled}>
                    </div>
                    <div class="control">
                        <label class="checkbox">
                            <input type="checkbox" bind:checked={courseEnabled}>
                            Vector movement enabled
                        </label>
                    </div>
                    <p class="help">If enabled, enter the ship's starting course. The movement helper is aware of which ships are vector enabled. For ease of math, course uses the default coordinate system where 0&deg; is direct starboard and increases <em>counter</em>clockwise. You shouldn't have to keep track of this during normal game play.</p>
                </div>
            </div>
            <div class="column">
            {#key cmd.svg}
                {#if ownerColour !== undefined && facing !== undefined && speed !== undefined}
                    <RenderCounter
                        svg={cmd.svg}
                        colour={ownerColour}
                        facing={cmd.facing}
                        speed={cmd.speed}
                        course={courseEnabled ? cmd.course : undefined}
                    />
                {/if}
            {/key}
            </div>
        </div>
    </div>
    <div class="column">
{#key cmd.object}
    {#if ( (shipJSON !== undefined) && (shipJSON.length > 0) )}
        <RenderSSD json={shipJSON} />
    {/if}
{/key}
    </div>
</div>
<div class="control">
    <button class="button is-primary" on:click={validateCommand}>Place ship</button>
</div>
{#each warnings as w}
    <p class="help is-danger">{w}</p>
{/each}

<style></style>
