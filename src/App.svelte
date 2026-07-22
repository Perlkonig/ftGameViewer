<script lang="ts">
    import { SvelteToast } from '@zerodevx/svelte-toast'
    import Map from './components/Map.svelte';
    import MousePos from './components/MousePos.svelte';
    import Nav from './components/Nav.svelte';
    import Commands from './components/Commands.svelte';
    import Sidebar from './components/Sidebar.svelte';
    import LoadSave from './components/LoadSave.svelte';
    import Explore from './components/Explore.svelte';
    import PhaseBar from './components/PhaseBar.svelte';
    import ModeratorTools from './components/ModeratorTools.svelte';
    import { clearActMapInteraction } from '@/lib/actMapInteraction';

    const optionsToast = {};
    type Tab = "explore" | "act" | "mod";
    let activeTab: Tab = "explore";

    const selectTab = (tab: Tab) => {
        const leavingAct = activeTab === "act" && tab !== "act";
        activeTab = tab;
        if (leavingAct) {
            clearActMapInteraction();
        }
    };
</script>

<main class="container p-6">
    <Nav />
    <h1 class="title">Full Thrust Game Viewer</h1>
    <p class="version subtitle">Version: {__APP_VERSION__}</p>

    <div class="container">
        <LoadSave />
        <PhaseBar />
    </div>

    <div class="container">
        <MousePos />
        <div class="columns">
            <div class="column">
                <Map />
            </div>
            <div class="column is-one-fifth">
                <Sidebar />
            </div>
        </div>
    </div>

    <div class="container">
        <div class="tabs">
            <ul>
                <li
                    class="{activeTab === "explore" ? "is-active" : ""}"
                    on:click={() => selectTab("explore")}
                >
                    <a>Explore</a>
                </li>
                <li
                    class="{activeTab === "act" ? "is-active" : ""}"
                    on:click={() => selectTab("act")}
                >
                    <a>Act</a>
                </li>
                <li
                    class="{activeTab === "mod" ? "is-active" : ""}"
                    on:click={() => selectTab("mod")}
                >
                    <a>Moderator</a>
                </li>
            </ul>
        </div>
    {#if activeTab === "explore"}
        <Explore />
    {:else if activeTab === "mod"}
        <ModeratorTools />
    {:else if activeTab === "act"}
        <Commands />
    {/if}
    </div>
</main>

<footer class="footer">
    <div class="content has-text-centered">
      <p>
        <a href="https://github.com/Perlkonig/ftGameViewer">Fork me on GitHub!</a>
      </p>
      <p>
        I believe in the "value for value" model. If you find this tool valuable, consider a donation proportional to that value: <a href="https://paypal.me/abstractplay">paypal.me/abstractplay</a>. Thank you!
      </p>
    </div>
</footer>

<SvelteToast options={optionsToast} />
