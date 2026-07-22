<script lang="ts">
    import type { RenderOpts } from "ftlibship";
    import { renderSvg, validate, resizeSsdTitles } from "ftlibship";
    import { onDestroy, tick } from "svelte";
    import { toast } from "@zerodevx/svelte-toast";
    import { nanoid } from "nanoid";

    const uuid = nanoid();
    export let json: string;
    export let opts: RenderOpts = {};

    let hostEl: HTMLDivElement | undefined;
    let svg: string | undefined;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;

    const observeHost = (node: HTMLDivElement) => {
        const ro = new ResizeObserver(() => {
            if (svg) resizeTitleBar();
        });
        ro.observe(node);
        return {
            destroy() {
                ro.disconnect();
            },
        };
    };

    $: renderOpts = { ...opts, minimal: true, id: uuid };

    $: {
        svg = undefined;
        try {
            const results = validate(json);
            if (!results.valid) {
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
                const ship = JSON.parse(json);
                svg = renderSvg(ship, renderOpts);
            }
        } catch (e) {
            toast.push("Something went wrong when rendering the ship. See the console for details.");
            console.log(e);
        }
    }

    $: if (svg && hostEl) {
        void scheduleTitleBarResize();
    }

    onDestroy(() => {
        if (resizeTimer !== undefined) clearTimeout(resizeTimer);
    });

    async function scheduleTitleBarResize() {
        await tick();
        if (typeof document !== "undefined" && document.fonts?.ready) {
            await document.fonts.ready;
        }
        resizeTitleBar();
        requestAnimationFrame(() => {
            resizeTitleBar();
            requestAnimationFrame(resizeTitleBar);
        });
        if (resizeTimer !== undefined) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(resizeTitleBar, 100);
        setTimeout(resizeTitleBar, 500);
    }

    function getSvgRoot(): SVGSVGElement | null {
        if (!hostEl) return null;
        const byId = hostEl.querySelector(`svg#${CSS.escape(uuid)}`);
        if (byId instanceof SVGSVGElement) return byId;
        const first = hostEl.querySelector("svg");
        return first instanceof SVGSVGElement ? first : null;
    }

    function resizeTitleBar() {
        const svgEle = getSvgRoot();
        if (!svgEle) return;
        resizeSsdTitles(svgEle);
    }
</script>

<div class="ssd-host" bind:this={hostEl} use:observeHost>
    {@html svg}
</div>

<style>
    .ssd-host {
        display: block;
        width: 100%;
    }

    .ssd-host :global(svg) {
        display: block;
        width: 100%;
        height: auto;
    }

    .ssd-host :global(svg * text) {
        cursor: default;
    }
</style>
