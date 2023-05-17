<script lang="ts">
    import { SvelteToast } from '@zerodevx/svelte-toast'
    import Map from './components/Map.svelte';
    import MousePos from './components/MousePos.svelte';
    import Nav from './components/Nav.svelte';
    import Commands from './components/Commands.svelte';
    import Sidebar from './components/Sidebar.svelte';

    const optionsToast = {};
</script>

<main class="container p-6">
    <Nav />
    <h1 class="title">Full Thrust Game Viewer</h1>
    <!-- svelte-ignore missing-declaration -->
    <p class="version subtitle">Version: {__APP_VERSION__}</p>

    <!-- Top functions -->
    <div class="container">
        <MousePos />
    </div>

    <!-- Map -->
    <div class="container">
        <div class="columns">
            <div class="column">
                <Map />
            </div>
            <div class="column is-one-fifth">
                <Sidebar />
            </div>
        </div>
    </div>

    <!-- Bottom functions -->
    <div class="container">
        <Commands />
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

<style>
</style>