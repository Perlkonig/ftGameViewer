<script lang="ts">
    import type { RenderOpts } from "ftlibship";
    import { renderSvg, validate } from "ftlibship";
    import { afterUpdate, onMount } from "svelte";
    import { toast } from "@zerodevx/svelte-toast";
    import { nanoid } from "nanoid";

    const uuid = nanoid();
    export let json: string;
    export let opts: RenderOpts = {};
    opts.minimal = true;
    opts.id = uuid;

    let svg: string;
    try {
        const results = validate(json);
        if (! results.valid) {
            toast.push("Invalid ship JSON received. See console for details.");
            if (results.ajvErrors) {
                console.log("Schema errros:");
                console.log(results.ajvErrors);
            }
            if (results.code) {
                console.log("Error code");
                console.log(results.code);
            }
            if (results.evalErrors) {
                console.log("Evaluation errors");
                console.log(results.evalErrors);
            }
        } else {
            svg = renderSvg(JSON.parse(json), opts);
        }
    } catch (e) {
        toast.push("Something went wrong when rendering the ship. See the console for details.");
        console.log(e);
    }

    let svgEle: SVGSVGElement;
    let nameEle: SVGTextElement;
    let statsEle: SVGTextElement;
    onMount(() => {
        svgEle = (document.getElementById(uuid) as unknown) as SVGSVGElement;
        nameEle = (document.getElementById("_resizeNamePlate") as unknown) as SVGTextElement;
        statsEle = (document.getElementById("_resizeStats") as unknown) as SVGTextElement;
        if ( (svgEle !== undefined) && (svgEle !== null) ) {
            const origWidth = svgEle.viewBox.baseVal.width;
            if (origWidth !== undefined) {
                const npValue = newSize(origWidth, nameEle.getBBox());
                if (npValue !== undefined) {
                    nameEle.setAttribute("transform", "matrix("+npValue+", 0, 0, "+npValue+", 0,0)");
                    const currx = parseFloat(nameEle.getAttribute("x"));
                    const curry = parseFloat(nameEle.getAttribute("y"));
                    nameEle.setAttribute("x", (currx / npValue).toString());
                    nameEle.setAttribute("y", (curry / npValue).toString());
                }
                const statValue = newSize(origWidth, statsEle.getBBox());
                if (statValue !== undefined) {
                    statsEle.setAttribute("transform", "matrix("+statValue+", 0, 0, "+statValue+", 0,0)");
                    const currx = parseFloat(statsEle.getAttribute("x"));
                    const curry = parseFloat(statsEle.getAttribute("y"));
                    statsEle.setAttribute("x", (currx / statValue).toString());
                    statsEle.setAttribute("y", (curry / statValue).toString());
                }
            }
        }
    });

    const newSize = (origWidth: number, bb: DOMRect): number|undefined => {
        const cellsize = 50;
        const widthTransform = origWidth * 0.9 / bb.width;
        const heightTransform = ((cellsize * 1.5) * 0.9) / bb.height;
        const value = widthTransform < heightTransform ? widthTransform : heightTransform;
        if (value !== Infinity) { return value; }
        return undefined;
    }
</script>

{@html svg}