<script lang="ts">
    import { userSettings } from "@/stores/writeUserSettings";
    import Modal from "./Modal.svelte";

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
                This site facilitates playing games of Full Thrust over the internet. It does not enforce any rules! It provides all the functions necessary to manipulate a Full Thrust game with some optional helpers to speed things along.
            </p>
            <p>
                See the README file for detailed instructions. The TLDR version is as follows:
            </p>
            <ul>
                <li>The buttons at the top let you load running games.</li>
                <li>The map shows the current game state.</li>
                <li>The functions at the bottom let you modify that game state.</li>
                <li>When you're done, you can then export the game or just your changes and transmit them to the other players.</li>
            </ul>
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
    </Modal>
{/if}
