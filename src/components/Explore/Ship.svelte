<script lang="ts">
    import { currentState } from "@/stores/derivedState";
    import { annotations, type IAnnotation } from "@/stores/writeAnnotations";
    import RenderSsd from "@/components/RenderSSD.svelte";
    import type { FullThrustShip } from "ftlibship";
    import type { FullThrustGameObjects, Position } from "@/schemas/position";
    import { onMount } from "svelte";
    import genArcs, { type Facing } from "@/lib/genArcs";
    import { onDestroy } from "svelte";
    import type { Arc } from "ftlibship/dist/lib/systems";

    export let shipId: string;

    let shipJson: string;
    let shipSrc: FullThrustShip;
    let shipObj: FullThrustGameObjects;
    onMount(() => {
        const found = $currentState.state.objects.find(o => o.objType === "ship" && o.id === shipId);
        if (found !== undefined) {
            shipObj = found;
            shipSrc = found.object as FullThrustShip;
            shipJson = JSON.stringify(found.object);
        } else {
            console.log(`Found is undefined`);
        }
    });

    const getInnermostHovered = (): Element|undefined => {
        let n = document.querySelector(":hover");
        let nn: Element;
        while (n) {
            nn = n;
            n = nn.querySelector(":hover");
        }
        return nn;
    }

    let sysID: string;
    let sysData: string;
    const handleSSDClick = (e: MouseEvent) => {
        if (shipSrc !== undefined) {
            const ele = getInnermostHovered();
            if (ele !== undefined) {
                // clicking twice should turn any display off
                if (sysID === ele.id) {
                    sysID = undefined;
                    sysData = undefined;
                    let idx = $annotations.findIndex(n => n.id === ele.id);
                    while (idx !== -1) {
                        $annotations.splice(idx, 1);
                        idx = $annotations.findIndex(n => n.id === ele.id);
                    }
                    $annotations = $annotations;
                } else {
                    sysID = ele.id;
                    if ( (sysID !== undefined) && (sysID.length > 0) ) {
                        // find system
                        const sys = [...shipSrc.systems, ...shipSrc.ordnance, ...shipSrc.weapons].find(s => s.id === sysID);
                        if (sys !== undefined) {
                            sysData = JSON.stringify(sys, null, 2);
                            // if system has arcs or range, draw them
                            // but first delete any pre-existing annotations
                            let idx = $annotations.findIndex(n => n.id === sys.id);
                            while (idx !== -1) {
                                $annotations.splice(idx, 1);
                                idx = $annotations.findIndex(n => n.id === sys.id);
                            }
                            switch (sys.name) {
                                // mineSweeper: 3 circle
                                case "mineSweeper":
                                    $annotations.push({
                                        type: "CIRCLE",
                                        id: sys.id,
                                        note: {
                                            c: shipObj.position as Position,
                                            r: 3,
                                        }
                                    } as IAnnotation);
                                    break;
                                // adfc: 6 circle
                                // pds: 6 circle
                                case "pds":
                                case "adfc":
                                    $annotations.push({
                                        type: "CIRCLE",
                                        id: sys.id,
                                        note: {
                                            c: shipObj.position as Position,
                                            r: 6,
                                        }
                                    } as IAnnotation);
                                    break;
                                // ecm (area only): 6 circle
                                case "ecm":
                                    if (sys.area) {
                                        $annotations.push({
                                            type: "CIRCLE",
                                            id: sys.id,
                                            note: {
                                                c: shipObj.position as Position,
                                                r: 6,
                                            }
                                        } as IAnnotation);
                                    }
                                    break;
                                // suicide: 1,2,3 circle
                                case "suicide":
                                    $annotations.push({
                                        type: "CIRCLE",
                                        id: sys.id,
                                        note: {
                                            c: shipObj.position as Position,
                                            r: 1,
                                        }
                                    } as IAnnotation);
                                    $annotations.push({
                                        type: "CIRCLE",
                                        id: sys.id,
                                        note: {
                                            c: shipObj.position as Position,
                                            r: 2,
                                            startR: 1
                                        }
                                    } as IAnnotation);
                                    $annotations.push({
                                        type: "CIRCLE",
                                        id: sys.id,
                                        note: {
                                            c: shipObj.position as Position,
                                            r: 3,
                                            startR: 2
                                        }
                                    } as IAnnotation);

                                // amt: 18
                                // rocketPod: 6, 12, 18
                                // missile + salvo: 24, 36 ER, 16–24 twostage
                                // salvoLauncher: depends on missile type
                                // ads: 6, 12
                                // scatterGun: 6
                                // grapeshot: 6
                                // spinalNova: start at +6, 2MU rect for 18, 4MU rect for 24, 6MU rect for 24
                                // spinalWave: 2MU for 12, 3MU for another 12, 4MU for another 12
                                // spinal beam, plasma, singularity:
                                    // short: 1MU for 24
                                    // medium: 1.5MU for 36
                                    // long: 2MU for 48
                                // submunition: 6, 12, 18
                                // pulser: 12, 24, 48
                                // beam, emp, plasmaCannon, phaser, graser, transporter, needle, gravitic?: 12 per
                                // graser, heavy: 18 per
                                case "beam":
                                case "emp":
                                case "plasmaCannon":
                                case "phaser":
                                case "graser":
                                case "transporter":
                                case "needle":
                                case "gravitic":
                                    let str = 12;
                                    if ( (sys.name === "graser") && (sys.heavy) ) {
                                        str = 18;
                                    }
                                    for (let i = 0; i < (sys.class as number); i++) {
                                        if ((sys.numArcs as number) < 6) {
                                            const [left, right] = genArcs(shipSrc.orientation, shipObj.facing as Facing, (sys.leftArc as Arc), (sys.numArcs as number))
                                            $annotations.push({
                                                type: "ARC",
                                                id: sys.id,
                                                note: {
                                                    left,
                                                    right,
                                                    c: shipObj.position as Position,
                                                    r: str * (i + 1),
                                                    startR: str * i,
                                                },
                                            } as IAnnotation);
                                        } else {
                                            $annotations.push({
                                                type: "CIRCLE",
                                                id: sys.id,
                                                note: {
                                                    c: shipObj.position as Position,
                                                    r: str * (i + 1),
                                                    startR: str * i,
                                                }
                                            } as IAnnotation);

                                        }
                                    }
                                    break;

                                // gatling, mkp: 12
                                // particle: 24
                                // meson 48
                                // fusion: 6, 12, 18, 24, 30, 36
                                // torpedoPulse, kgun:
                                    // short: 4, 8, 12, 16, 20
                                    // standard: 6, 12, 18, 24, 30
                                    // long: 9, 18, 27, 36, 45
                                // pbl: 30
                            }
                            $annotations = $annotations;
                        } else {
                            sysData = `No system found with an id of '${sysID}'`;
                        }
                    }
                }
            }
        }
    }

    onDestroy(() => {
        $annotations = [];
    });
</script>

{#if shipJson !== undefined}
<div class="columns">
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <div class="column is-one-third" on:click={handleSSDClick}>
        <p>Click a system for details, including a visual representation of arcs and range.</p>
        <RenderSsd
            json={shipJson}
        />
    </div>
    <div class="column is-one-third">
    {#if sysData !== undefined}
        <pre>{sysData}</pre>
    {/if}
    </div>
</div>
{/if}

