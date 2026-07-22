<script lang="ts">
    import { commands } from "@/stores/writeCommands";
    import { currentState } from "@/stores/derivedState";
    import { initialState } from "@/stores/writeInitialState";
    import { gameMeta } from "@/stores/writeGameMeta";
    import { proposalCommands, popProposalCommands } from "@/stores/writeProposalCommands";
    import { headOffset } from "@/stores/writeHeadOffset";
    import { initFluidMapBuffer } from "@/stores/writeBuffer";
    import { userSettings } from "@/stores/writeUserSettings";
    import NewGame from "@/components/NewGame.svelte";
    import Modal from "@/components/Modal.svelte";
    import {
        packageFromParts,
        metaFromPackage,
        parseLoadable,
        parseCommandBundle,
        createCommandBundle,
        downloadJson,
        copyJsonToClipboard,
        readFileAsJson,
        sanitizeFilename,
        type GamePackage,
    } from "@/lib/game/package";
    import {
        listLocalSaves,
        loadLocalSave,
        localSaveExists,
        deleteLocalSave,
        saveLocalGame,
        type LocalSaveEntry,
    } from "@/lib/game/localSaves";
    import {
        isPresetLoadKey,
        listGamePresets,
        loadGamePreset,
        localLoadKey,
        localKeyFromLoadKey,
        presetFileFromKey,
        type GamePresetEntry,
    } from "@/lib/game/gamePresets";
    import { toast } from "@zerodevx/svelte-toast";

    let fileInput: HTMLInputElement;
    let bundleInput: HTMLInputElement;
    let showNewGame = false;
    let pasteOpen = false;
    let pasteText = "";
    let showSaveDialog = false;
    let showLoadDialog = false;
    let saveName = "";
    let selectedSaveKey = "";
    let localSaves: LocalSaveEntry[] = [];
    let presetSaves: GamePresetEntry[] = [];
    let loadingPresets = false;

    $: role = $userSettings.role ?? "player";
    $: isModerator = role === "moderator";

    const setRole = (next: "player" | "moderator") => {
        userSettings.update((s) => ({ ...s, role: next }));
    };

    const currentPackage = () => {
        const meta = $currentState.meta ?? $gameMeta;
        return packageFromParts(meta, $initialState, $commands);
    };

    const openSaveDialog = () => {
        saveName = ($currentState.meta?.name ?? $gameMeta.name) || "Untitled Game";
        showSaveDialog = true;
    };

    const closeSaveDialog = () => {
        showSaveDialog = false;
    };

    $: saveNameTrimmed = saveName.trim();
    $: saveWillOverwrite = saveNameTrimmed.length > 0 && localSaveExists(saveNameTrimmed);

    const confirmSaveLocal = () => {
        try {
            const name = saveNameTrimmed;
            if (!name) {
                toast.push("Enter a save name");
                return;
            }
            const pkg = currentPackage();
            saveLocalGame(name, pkg);
            gameMeta.update((m) => ({ ...m, name }));
            closeSaveDialog();
            toast.push(saveWillOverwrite ? `Overwrote "${name}"` : `Saved "${name}" locally`);
        } catch (e) {
            toast.push(e instanceof Error ? e.message : "Could not save");
        }
    };

    const openLoadDialog = async () => {
        localSaves = listLocalSaves();
        loadingPresets = true;
        presetSaves = await listGamePresets();
        loadingPresets = false;
        selectedSaveKey =
            presetSaves[0]?.key ?? (localSaves[0] ? localLoadKey(localSaves[0].key) : "");
        showLoadDialog = true;
    };

    const closeLoadDialog = () => {
        showLoadDialog = false;
    };

    const confirmLoadLocal = async () => {
        if (!selectedSaveKey) {
            toast.push("Select a game to load");
            return;
        }
        try {
            const pkg = isPresetLoadKey(selectedSaveKey)
                ? await loadGamePreset(presetFileFromKey(selectedSaveKey))
                : loadLocalSave(localKeyFromLoadKey(selectedSaveKey));
            applyPackage(pkg);
            closeLoadDialog();
            toast.push(
                isPresetLoadKey(selectedSaveKey) ? "Loaded preset scenario" : "Loaded from local storage"
            );
        } catch (e) {
            toast.push(e instanceof Error ? e.message : "Could not load save");
        }
    };

    const deleteLocalSaveEntry = (save: LocalSaveEntry) => {
        if (!confirm(`Delete saved game "${save.displayName}"?`)) return;
        try {
            deleteLocalSave(save.key);
            localSaves = listLocalSaves();
            const deletedKey = localLoadKey(save.key);
            if (selectedSaveKey === deletedKey) {
                selectedSaveKey =
                    presetSaves[0]?.key ??
                    (localSaves[0] ? localLoadKey(localSaves[0].key) : "");
            }
            toast.push(`Deleted "${save.displayName}"`);
        } catch (e) {
            toast.push(e instanceof Error ? e.message : "Could not delete save");
        }
    };

    const formatSavedAt = (iso?: string): string => {
        if (!iso) return "";
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return "";
        return d.toLocaleString();
    };

    const applyPackage = (pkg: GamePackage) => {
        gameMeta.set(metaFromPackage(pkg));
        initialState.set(pkg.initialState);
        commands.set(pkg.commands);
        headOffset.set(0);
        proposalCommands.set([]);
        initFluidMapBuffer(pkg.map);
        showNewGame = false;
    };

    const onNewGameCreated = (e: CustomEvent<GamePackage>) => {
        applyPackage(e.detail);
        toast.push("New game created");
    };

    const exportPackage = () => {
        const pkg = currentPackage();
        downloadJson(`${sanitizeFilename(pkg.name)}.ftgame.json`, pkg);
        toast.push("Game downloaded");
    };

    const copyPackage = async () => {
        try {
            await copyJsonToClipboard(currentPackage());
            toast.push("Game copied to clipboard");
        } catch {
            toast.push("Clipboard copy failed");
        }
    };

    const onImportFile = async (e: Event) => {
        const input = e.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;
        try {
            const raw = await readFileAsJson(file);
            applyPackage(parseLoadable(raw));
            toast.push(`Loaded ${file.name}`);
        } catch (err) {
            toast.push(err instanceof Error ? err.message : "Import failed");
        }
        input.value = "";
    };

    const pastePackage = () => {
        try {
            applyPackage(parseLoadable(JSON.parse(pasteText)));
            pasteOpen = false;
            pasteText = "";
            toast.push("Game loaded from paste");
        } catch (err) {
            toast.push(err instanceof Error ? err.message : "Paste failed");
        }
    };

    const exportBundle = () => {
        if ($proposalCommands.length === 0) {
            toast.push("No proposal commands to export");
            return;
        }
        const bundle = createCommandBundle($proposalCommands, {
            gameName: $gameMeta.name,
            notes: "Player proposals",
        });
        downloadJson(
            `${sanitizeFilename($gameMeta.name)}_orders.json`,
            bundle
        );
        toast.push("Proposals downloaded");
    };

    const copyBundle = async () => {
        if ($proposalCommands.length === 0) {
            toast.push("No proposal commands to export");
            return;
        }
        try {
            await copyJsonToClipboard(
                createCommandBundle($proposalCommands, {
                    gameName: $gameMeta.name,
                })
            );
            toast.push("Proposals copied to clipboard");
        } catch {
            toast.push("Clipboard copy failed");
        }
    };

    const onImportBundle = async (e: Event) => {
        const input = e.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;
        try {
            const bundle = parseCommandBundle(await readFileAsJson(file));
            proposalCommands.update((c) => [...c, ...bundle.commands]);
            toast.push(`Merged ${bundle.commands.length} into proposals`);
        } catch (err) {
            toast.push(err instanceof Error ? err.message : "Proposals import failed");
        }
        input.value = "";
    };

    const clearProposals = () => {
        proposalCommands.set([]);
        toast.push("Cleared proposals");
    };

    const removeLastProposal = () => {
        const removed = popProposalCommands(1);
        if (removed === 0) {
            toast.push("No proposals to remove");
            return;
        }
        toast.push("Removed last proposal");
    };

    const applyProposalsToMaster = () => {
        if (!isModerator) {
            toast.push("Moderator role required");
            return;
        }
        if ($proposalCommands.length === 0) {
            toast.push("No proposals");
            return;
        }
        commands.update((c) => [...c, ...$proposalCommands]);
        proposalCommands.set([]);
        toast.push("Proposals applied to master log");
    };
</script>

<div class="box">
    <div class="level is-mobile mb-2">
        <div class="level-left">
            <div class="level-item">
                <strong>{$gameMeta.name}</strong>
            </div>
        </div>
        <div class="level-right">
            <div class="level-item">
                <div class="role-toggle" title="Moderator unlocks phase advance, master log edits, and adjustment tools">
                    <span class="role-toggle__label" class:is-active={!isModerator}>Player</span>
                    <label class="role-toggle__switch">
                        <input
                            type="checkbox"
                            checked={isModerator}
                            on:change={(e) =>
                                setRole(e.currentTarget.checked ? "moderator" : "player")}
                        />
                        <span class="role-toggle__track" aria-hidden="true"></span>
                    </label>
                    <span class="role-toggle__label" class:is-active={isModerator}>Moderator</span>
                </div>
            </div>
        </div>
    </div>

    <div class="buttons are-small">
        <button class="button is-link" on:click={() => (showNewGame = !showNewGame)}>
            {showNewGame ? "Hide new game" : "New game"}
        </button>
        <button class="button" on:click={() => fileInput.click()}>Import Game</button>
        <button class="button" on:click={exportPackage}>Export Game</button>
        <button class="button is-light" on:click={copyPackage}>Copy Game</button>
        <button class="button is-light" on:click={() => (pasteOpen = !pasteOpen)}>Paste Game</button>
        <button class="button" on:click={openSaveDialog}>Save Local</button>
        <button class="button" on:click={openLoadDialog}>Load</button>
    </div>

    <div class="buttons are-small">
        <button class="button is-primary" on:click={exportBundle}>Export Proposals</button>
        <button class="button is-light" on:click={copyBundle}>Copy Proposals</button>
        <button class="button" on:click={() => bundleInput.click()}>Import Proposals</button>
        <button class="button is-warning" on:click={clearProposals}>
            Clear Proposals ({$proposalCommands.length})
        </button>
        <button
            class="button is-warning is-light"
            disabled={$proposalCommands.length === 0}
            on:click={removeLastProposal}
        >
            Remove Last Proposal
        </button>
        {#if isModerator}
            <button class="button is-success" on:click={applyProposalsToMaster}>
                Apply Proposals to Master
            </button>
        {/if}
    </div>

    {#if showNewGame}
        <NewGame on:created={onNewGameCreated} on:cancel={() => (showNewGame = false)} />
    {/if}

    <input
        bind:this={fileInput}
        type="file"
        accept="application/json,.json"
        class="is-hidden"
        on:change={onImportFile}
    />
    <input
        bind:this={bundleInput}
        type="file"
        accept="application/json,.json"
        class="is-hidden"
        on:change={onImportBundle}
    />

    {#if pasteOpen}
        <div class="field mt-3">
            <textarea class="textarea" rows="6" bind:value={pasteText} placeholder="Paste game JSON"></textarea>
            <button class="button is-link mt-2" on:click={pastePackage}>Load Paste</button>
        </div>
    {/if}
</div>

{#if showSaveDialog}
    <Modal
        title="Save game locally"
        buttons={[
            { label: "Cancel", action: closeSaveDialog },
            { label: "Save", action: confirmSaveLocal, class: "is-info" },
        ]}
    >
        <div class="field">
            <label class="label" for="saveName">Save name</label>
            <input id="saveName" class="input" bind:value={saveName} placeholder="Game name" />
            {#if saveWillOverwrite}
                <p class="help has-text-warning">
                    A save named “{saveNameTrimmed}” already exists. Saving will overwrite it.
                </p>
            {:else if saveNameTrimmed}
                <p class="help">This will be saved as “{saveNameTrimmed}”.</p>
            {:else}
                <p class="help">Enter a name for this saved game.</p>
            {/if}
        </div>
    </Modal>
{/if}

{#if showLoadDialog}
    <Modal
        title="Load game"
        buttons={[
            { label: "Cancel", action: closeLoadDialog },
            {
                label: "Load",
                action: confirmLoadLocal,
                class: "is-info",
            },
        ]}
    >
        {#if loadingPresets}
            <p class="help">Loading presets…</p>
        {/if}
        {#if presetSaves.length === 0 && localSaves.length === 0 && !loadingPresets}
            <p class="help">No preset scenarios or saved games found.</p>
        {:else}
            <p class="help mb-3">Choose a preset scenario or a game saved in this browser.</p>
            <div class="save-list">
                {#if presetSaves.length > 0}
                    <p class="save-list__heading">Preset scenarios</p>
                    {#each presetSaves as save (save.key)}
                        <label class="save-list__item">
                            <input
                                type="radio"
                                name="loadGame"
                                value={save.key}
                                bind:group={selectedSaveKey}
                            />
                            <span class="save-list__body">
                                <strong>{save.displayName}</strong>
                                <span class="tag is-info is-light is-small ml-1">preset</span>
                            </span>
                        </label>
                    {/each}
                {/if}
                {#if localSaves.length > 0}
                    <p class="save-list__heading" class:mt-3={presetSaves.length > 0}>Your saves</p>
                    {#each localSaves as save (save.key)}
                        <div
                            class="save-list__item"
                            class:save-list__item--selected={selectedSaveKey ===
                                localLoadKey(save.key)}
                        >
                            <label class="save-list__label">
                                <input
                                    type="radio"
                                    name="loadGame"
                                    value={localLoadKey(save.key)}
                                    bind:group={selectedSaveKey}
                                />
                                <span class="save-list__body">
                                    <strong>{save.displayName}</strong>
                                    {#if save.isLegacy}
                                        <span class="tag is-light is-small ml-1">legacy</span>
                                    {:else}
                                        <span class="tag is-light is-small ml-1">local</span>
                                    {/if}
                                    {#if save.savedAt}
                                        <span class="is-size-7 has-text-grey">
                                            — saved {formatSavedAt(save.savedAt)}
                                        </span>
                                    {/if}
                                </span>
                            </label>
                            <button
                                type="button"
                                class="button is-small is-ghost save-list__delete"
                                title="Delete save"
                                aria-label="Delete {save.displayName}"
                                on:click={() => deleteLocalSaveEntry(save)}
                            >
                                <span class="icon has-text-danger">
                                    <i class="fa-solid fa-trash"></i>
                                </span>
                            </button>
                        </div>
                    {/each}
                {/if}
            </div>
        {/if}
    </Modal>
{/if}

<style>
    .role-toggle {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.875rem;
    }

    .role-toggle__label {
        color: #7a7a7a;
        user-select: none;
    }

    .role-toggle__label.is-active {
        color: #363636;
        font-weight: 600;
    }

    .role-toggle__switch {
        position: relative;
        display: inline-block;
        width: 2.75rem;
        height: 1.5rem;
        flex-shrink: 0;
        cursor: pointer;
    }

    .role-toggle__switch input {
        position: absolute;
        opacity: 0;
        width: 0;
        height: 0;
    }

    .role-toggle__track {
        position: absolute;
        inset: 0;
        border-radius: 999px;
        background: #dbdbdb;
        transition: background 0.15s ease;
    }

    .role-toggle__track::before {
        content: "";
        position: absolute;
        left: 0.2rem;
        top: 0.2rem;
        width: 1.1rem;
        height: 1.1rem;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 1px 2px rgba(10, 10, 10, 0.2);
        transition: transform 0.15s ease;
    }

    .role-toggle__switch input:checked + .role-toggle__track {
        background: #ffdd57;
    }

    .role-toggle__switch input:checked + .role-toggle__track::before {
        transform: translateX(1.25rem);
    }

    .role-toggle__switch input:focus-visible + .role-toggle__track {
        outline: 2px solid #3273dc;
        outline-offset: 2px;
    }

    .save-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        max-height: 16rem;
        overflow-y: auto;
    }

    .save-list__heading {
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #7a7a7a;
        margin-bottom: 0.25rem;
    }

    .save-list__heading.mt-3 {
        margin-top: 0.75rem;
    }

    .save-list__item {
        display: flex;
        align-items: flex-start;
        gap: 0.25rem;
        padding: 0.5rem 0.65rem;
        border: 1px solid #dbdbdb;
        border-radius: 4px;
    }

    .save-list__item--selected {
        border-color: #3273dc;
        background: #f0f5ff;
    }

    .save-list__label {
        display: flex;
        align-items: flex-start;
        gap: 0.5rem;
        flex: 1;
        min-width: 0;
        cursor: pointer;
    }

    .save-list__delete {
        flex-shrink: 0;
        border: none;
        background: transparent;
        padding: 0.15rem 0.35rem;
    }

    .save-list__delete:hover {
        background: #feecf0;
    }

    .save-list__body {
        flex: 1;
        min-width: 0;
    }
</style>
