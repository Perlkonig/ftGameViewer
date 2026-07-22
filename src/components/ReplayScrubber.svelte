<script lang="ts">
    import { headOffset } from "@/stores/writeHeadOffset";
    import { commands } from "@/stores/writeCommands";
    import { gameMeta } from "@/stores/writeGameMeta";
    import { metaForCommandReplay } from "@/lib/game/types";
    import {
        headOffsetForTurnStart,
        markerTrackFraction,
        nextTurnOffset,
        previousTurnOffset,
        turnReplayMarkers,
        turnStartOffsets,
    } from "@/lib/game/replayTimeline";

    export let maxOffset: number;
    export let visibleCount: number;
    export let replayTurn: number | undefined = undefined;

    $: markers = turnReplayMarkers(metaForCommandReplay($gameMeta), $commands);
    $: turnOffsets = turnStartOffsets($commands.length, markers);
    $: fillRatio =
        $commands.length > 0 ? visibleCount / $commands.length : 1;
    $: sliderValue = maxOffset - $headOffset;

    const scrub = (v: number) => {
        headOffset.set(Math.max(0, Math.min(maxOffset, Math.round(v))));
    };

    const onSliderInput = (e: Event) => {
        const v = Number((e.currentTarget as HTMLInputElement).value);
        scrub(maxOffset - v);
    };

    const jumpToTurn = (turn: number) => {
        scrub(headOffsetForTurnStart(turn, $commands.length, markers));
    };

    const onTrackClick = (e: MouseEvent) => {
        const track = e.currentTarget as HTMLElement;
        const rect = track.getBoundingClientRect();
        if (rect.width <= 0 || maxOffset <= 0) return;
        const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const visibleCommands = Math.round(fraction * $commands.length);
        scrub($commands.length - visibleCommands);
    };

    const prevTurn = () => {
        const next = previousTurnOffset($headOffset, turnOffsets);
        if (next !== undefined) scrub(next);
    };

    const nextTurn = () => {
        const next = nextTurnOffset($headOffset, turnOffsets);
        if (next !== undefined) scrub(next);
    };

    $: prevTurnDisabled =
        previousTurnOffset($headOffset, turnOffsets) === undefined;
    $: nextTurnDisabled = nextTurnOffset($headOffset, turnOffsets) === undefined;
</script>

<div class="replay-scrubber">
    <label class="label is-small" for="replay-slider">
        Replay
        {#if replayTurn !== undefined}
            — viewing turn <strong>{replayTurn}</strong>
        {/if}
        <span class="has-text-grey"> ({visibleCount} / {$commands.length} commands)</span>
    </label>

    <div class="replay-scrubber__track-wrap">
        <div
            class="replay-scrubber__track"
            role="presentation"
            on:click={onTrackClick}
        >
            <div
                class="replay-scrubber__fill"
                class:replay-scrubber__fill--full={fillRatio >= 1}
                style:width="{(fillRatio * 100).toFixed(2)}%"
            ></div>
            {#each markers as m (m.turn)}
                {@const left = markerTrackFraction(m.endCommandIndex, $commands.length) * 100}
                <button
                    type="button"
                    class="replay-scrubber__tick"
                    style:left="{left}%"
                    title="Jump to start of turn {m.turn}"
                    on:click|stopPropagation={() => jumpToTurn(m.turn)}
                >
                    <span class="replay-scrubber__tick-label">{m.turn}</span>
                </button>
            {/each}
        </div>
        <input
            id="replay-slider"
            class="replay-scrubber__range"
            type="range"
            min="0"
            max={maxOffset}
            value={sliderValue}
            on:input={onSliderInput}
            aria-valuemin={0}
            aria-valuemax={maxOffset}
            aria-valuenow={sliderValue}
            aria-label="Replay position"
        />
    </div>

    <div class="buttons are-small mt-1">
        <button class="button" on:click={() => scrub($headOffset + 1)} disabled={$headOffset >= maxOffset}>
            Step back
        </button>
        <button class="button" on:click={() => scrub($headOffset - 1)} disabled={$headOffset <= 0}>
            Step forward
        </button>
        <button class="button" on:click={prevTurn} disabled={prevTurnDisabled}>Prev turn</button>
        <button class="button" on:click={nextTurn} disabled={nextTurnDisabled}>Next turn</button>
        <button class="button" on:click={() => scrub(0)}>Latest</button>
    </div>
</div>

<style>
    .replay-scrubber__track-wrap {
        position: relative;
        height: 2rem;
    }

    .replay-scrubber__track {
        position: absolute;
        left: 0;
        right: 0;
        top: 50%;
        transform: translateY(-50%);
        height: 0.5rem;
        background: #e8e8e8;
        border: 1px solid #dbdbdb;
        border-radius: 4px;
        cursor: pointer;
        overflow: visible;
    }

    .replay-scrubber__fill {
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        background: #3273dc;
        opacity: 0.35;
        border-radius: 3px 0 0 3px;
        pointer-events: none;
    }

    .replay-scrubber__fill--full {
        border-radius: 3px;
    }

    .replay-scrubber__range {
        position: absolute;
        left: 0;
        right: 0;
        top: 50%;
        transform: translateY(-50%);
        width: 100%;
        margin: 0;
        height: 1.5rem;
        opacity: 0;
        cursor: pointer;
        z-index: 2;
    }

    .replay-scrubber__tick {
        position: absolute;
        top: -1.35rem;
        transform: translateX(-50%);
        padding: 0;
        margin: 0;
        border: none;
        background: transparent;
        cursor: pointer;
        z-index: 3;
        line-height: 1;
    }

    .replay-scrubber__tick::after {
        content: "";
        display: block;
        width: 2px;
        height: 0.65rem;
        background: #7a7a7a;
        margin: 0.15rem auto 0;
    }

    .replay-scrubber__tick-label {
        font-size: 0.65rem;
        font-weight: 600;
        color: #4a4a4a;
    }

    .replay-scrubber__tick:hover .replay-scrubber__tick-label {
        color: #3273dc;
    }
</style>
