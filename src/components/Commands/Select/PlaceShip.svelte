<script lang="ts">
    import { onDestroy } from "svelte";
    import { clickMode } from "@/stores/writeClickMode";
    import { beacon } from "@/stores/writeBeacon";
    import { nanoid } from "nanoid";
    import { toast } from "@zerodevx/svelte-toast";
    import { XMLBuilder, XMLValidator, XMLParser } from "fast-xml-parser";
    import type { Position } from "@/schemas/commands";
    import RenderShip from "@/components/RenderShip.svelte";
    import presets from "@/stores/counters.json";
    import { currentState } from "@/stores/derivedState";
    import Clock from "@/assets/clock.svg.svelte";

    interface ICommand {
        name: string;
        id: string;
        object: string;
        svg: string;
        owner: string;
        position: null|Position;
        facing: number;
        course?: number;
        speed: number;
    }

    let cmd: ICommand = {
        name: "placeShip",
        id: nanoid(10),
        object: "",
        svg: "",
        owner: "",
        position: undefined,
        facing: 0,
        speed: 0
    };

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
    }

    let customCounter: string;
    const processCustomCounter = () => {
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
    $: if (customCounter !== undefined) { processCustomCounter(); }

    let owner: string;
    let ownedCounter: string;
    $: if (owner !== undefined) {
        if (counterSymbol !== undefined) {
            ownedCounter = counterSymbol;
        } else if (customCounter !== undefined) {
            ownedCounter = customCounter;
        } else {
            ownedCounter = undefined;
        }
        if (ownedCounter !== undefined) {
            const obj = $currentState.state.players.find(x => x.id === owner);
            if (obj !== undefined) {
                ownedCounter = ownedCounter.replaceAll(`#030303`, obj.colour);
            }
        }
    }

    $clickMode = "beacon"
    let posStr: string;
    let posX: number;
    let posY: number;
    beacon.subscribe(val => {
        if (val !== undefined) {
            posStr = `${val.x}, ${val.y}`;
            posX = val.x;
            posY = val.y;
        } else {
            posStr = "";
            posX = undefined;
            posY = undefined;
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
                <textarea class="textarea" name="shipJSON" bind:value={cmd.object}></textarea>
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
            {#if counterSymbol !== undefined}
                <svg id="_counterSVG" width="100%" height="100" viewBox="-1 -1 102 102">
                    <defs>
                        {@html counterSymbol.replace(`<symbol `, `<symbol id="_counter" `)}
                    </defs>
                    <use href={`#_counter`} x="0" y="0" width="100" height="100" />
                </svg>
            {/if}
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
            {#if customCounter !== undefined}
                <svg id="_counterSVG" width="100%" height="100" viewBox="-1 -1 102 102">
                    <defs>
                        {@html customCounter.replace(`<symbol `, `<symbol id="_counter" `)}
                    </defs>
                    <use href={`#_counter`} x="0" y="0" width="100" height="100" />
                </svg>
            {/if}
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
            {#if ownedCounter !== undefined}
                <svg id="_counterSVG" width="100%" height="100" viewBox="-1 -1 102 102">
                    <defs>
                        {@html ownedCounter.replace(`<symbol `, `<symbol id="_ownedCounter" `)}
                    </defs>
                    <use href={`#_ownedCounter`} x="0" y="0" width="100" height="100" />
                </svg>
            {/if}
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
                {#if ownedCounter !== undefined && facing !== undefined}
                    <svg id="_counterSVG" width="100%" height="100" viewBox="-1 -1 102 102">
                        <use href={`#_ownedCounter`} x="0" y="0" width="100" height="100" transform="rotate({facing * 30} 50 50)" />
                    </svg>
                {/if}
                </div>
            </div>
    </div>
    <div class="column">
{#key cmd.object}
    {#if ( (cmd.object !== undefined) && (cmd.object.length > 0) )}
        <RenderShip json={cmd.object} />
    {/if}
{/key}
    </div>
</div>

<style></style>