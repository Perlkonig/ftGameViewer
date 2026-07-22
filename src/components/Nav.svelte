<script lang="ts">
    import { userSettings } from "@/stores/writeUserSettings";
    import Modal from "./Modal.svelte";
    import { DOC_PAGES, docsIndexUrl, docsPageUrl } from "@/lib/docs";

    let modalAbout = false;
    let modalFeedback = false;
    let modalSettings = false;

    let burgerActive = false;
</script>

<nav class="navbar" aria-label="main navigation">
    <div class="navbar-brand">
        <a href={"#"} role="button" class="navbar-burger{burgerActive ? " is-active" : ""}" aria-label="menu" aria-expanded="false" data-target="navbarBasicExample" on:click={() => burgerActive = ! burgerActive}>
            <span aria-hidden="true"></span>
            <span aria-hidden="true"></span>
            <span aria-hidden="true"></span>
        </a>
    </div>
    <div id="navbarBasicExample" class="navbar-menu{burgerActive ? " is-active" : ""}">
        <div class="navbar-start">
            <a class="navbar-item" href={docsIndexUrl}>
                Documentation
            </a>

            <a class="navbar-item" on:click="{() => modalAbout = true}">
                About
            </a>

            <a class="navbar-item" on:click="{() => modalFeedback = true}">
                Feedback
            </a>

            <a class="navbar-item" href="https://github.com/Perlkonig/ftGameViewer/blob/main/CHANGELOG.md" target="_blank">Changelog</a>
        </div>
        <div class="navbar-end">
            <a class="navbar-item" on:click={() => modalSettings = true}>
                <span>Settings</span>
                <span class="icon">
                    <i class="fa-solid fa-gear"></i>
                </span>
            </a>
        </div>
    </div>
</nav>

{#if modalAbout}
    <Modal
        title="About"
        buttons={[
            {
                label: "Close",
                action: () => {modalAbout = false}
            }
        ]}
    >
        <div class="content">
            <p>
                This app facilitates playing human-moderated games of Full Thrust over the internet. It enforces many of the Continuum rules, but one of its design principles is to only warn players of nonstandard moves and let the moderator make final decisions and adjustments. The hope being that it will work just fine for most games but will still allow house rules.
            </p>
            <p>
                See the documentation for detailed instructions. The TLDR version is as follows:
            </p>
            <ul>
                <li>The buttons at the top let you load running games.</li>
                <li>The map shows the current game state.</li>
                <li>The functions at the bottom let you modify that game state.</li>
                <li>When you're done, you can then export the game or just your changes and transmit them to the other players.</li>
            </ul>
            <p>
                Guides:
                {#each DOC_PAGES as page, i}
                    <a href={docsPageUrl(page.slug)}>{page.label}</a>{#if i < DOC_PAGES.length - 1}<span aria-hidden="true"> · </span>{/if}
                {/each}
            </p>
            <p>
                This site is built on the <a href="https://svelte.dev/">Svelte framework</a>, using the <a href="https://bulma.io">Bulma CSS library</a> and good ol' <a href="https://en.wikipedia.org/wiki/Scalable_Vector_Graphics">scalable vector graphics (SVG)</a>.
            </p>
        </div>
    </Modal>
{/if}

{#if modalFeedback}
    <Modal
        title="Feedback"
        buttons={[
            {
                label: "Close",
                action: () => {modalFeedback = false}
            }
        ]}
    >
        <div class="content">
            <p>
                This project is open source. You can view and contribute to the code <a href="https://github.com/Perlkonig/ftGameViewer">on GitHub</a>. Pull requests are warmly welcomed, as are issue reports.
            </p>
            <p>
                I hang out at the <a href="https://discord.gg/fXC3grNN9C">Full Thrust Gamers Discord server</a>, and <a href="https://www.perlkonig.com">my personal website</a> gives other ways of reaching me.
            </p>
            <p>
                I believe in the "value for value" model. If you find this tool valuable, consider a donation proportional to that value: <a href="https://paypal.me/abstractplay">paypal.me/abstractplay</a>. Thank you!
            </p>
        </div>
    </Modal>
{/if}

{#if modalSettings}
    <Modal
        title="Settings"
        buttons={[
            {
                label: "Close",
                action: () => {modalSettings = false}
            }
        ]}
    >
        <div class="field">
            <label class="label" for="opacity">Background opacity</label>
            <div class="control">
                <input name="opacity" type="range" min="0" max="1" step="0.1" bind:value={$userSettings.opacity}>
            </div>
            <p class="help">{$userSettings.opacity}</p>
        </div>
        <div class="field">
            <label class="label" for="role">Role</label>
            <div class="control">
                <div class="select">
                    <select
                        id="role"
                        value={$userSettings.role ?? "player"}
                        on:change={(e) => {
                            userSettings.update((s) => ({
                                ...s,
                                role: e.currentTarget.value as "player" | "moderator",
                            }));
                        }}
                    >
                        <option value="player">Player</option>
                        <option value="moderator">Moderator</option>
                    </select>
                </div>
            </div>
            <p class="help">You can also switch role with the Player / Moderator toggle above the game buttons.</p>
        </div>
    </Modal>
{/if}
