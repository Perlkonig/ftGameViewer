<script lang="ts">
    import PlaceShip from "./Select/PlaceShip.svelte";
    import MoveShip from "./Select/MoveShip.svelte";
    import LaunchOrdnance from "./Select/LaunchOrdnance.svelte";
    import LaunchFighters from "./Select/LaunchFighters.svelte";
    import MoveFighters from "./Select/MoveFighters.svelte";
    import MoveToken from "./Select/MoveToken.svelte";
    import FireWeapon from "./Select/FireWeapon.svelte";
    import DeclarePointDefense from "./Select/DeclarePointDefense.svelte";
    import ResolvePointDefense from "./Select/ResolvePointDefense.svelte";
    import PdsOrders from "./Select/PdsOrders.svelte";
    import FireWeaponAdHoc from "./Select/FireWeaponAdHoc.svelte";
    import DamageControl from "./Select/DamageControl.svelte";
    import OrdnanceStrike from "./Select/OrdnanceStrike.svelte";
    import Furball from "./Select/Furball.svelte";
    import DeclareFurball from "./Select/DeclareFurball.svelte";
    import ResolveFurballs from "./Select/ResolveFurballs.svelte";
    import InterceptOrdnance from "./Select/InterceptOrdnance.svelte";
    import DeclareOrdnanceTarget from "./Select/DeclareOrdnanceTarget.svelte";
    import DeclareFighterAttack from "./Select/DeclareFighterAttack.svelte";
    import BoardingAttackerOrdersDeclare from "./Select/BoardingAttackerOrdersDeclare.svelte";
    import BoardingDefenderOrdersDeclare from "./Select/BoardingDefenderOrdersDeclare.svelte";
    import { BOARDING_STEP_LABELS } from "@/lib/game/boardingOrders";
    import TransporterDeliveryDeclare from "./Select/TransporterDeliveryDeclare.svelte";
    import EmpAllocationDeclare from "./Select/EmpAllocationDeclare.svelte";
    import Cloak from "./Select/Cloak.svelte";
    import LayMine from "./Select/LayMine.svelte";
    import AdjustFighters from "./Select/AdjustFighters.svelte";
    import LaunchGunboats from "./Select/LaunchGunboats.svelte";
    import LaunchGunboatOrdnance from "./Select/LaunchGunboatOrdnance.svelte";
    import MoveGunboats from "./Select/MoveGunboats.svelte";
    import AdjustGunboats from "./Select/AdjustGunboats.svelte";
    import DeclareGunboatAttack from "./Select/DeclareGunboatAttack.svelte";
    import { currentState } from "@/stores/derivedState";
    import {
        actActionLabel,
        defaultActActionForPhase,
        isActActionTypicalInPhase,
        legalCommandsForPhase,
        phaseName,
        sortedActActions,
        type ActActionKey,
    } from "@/lib/game/phase";
    import type { GamePhase } from "@/lib/game/types";
    import { userSettings } from "@/stores/writeUserSettings";
    import { hasPendingTransporterDeliveries } from "@/lib/game/weaponFireState";
    import { hasBankedEmp } from "@/lib/game/empFire";

    let selected: ActActionKey | "" = "";
    let userCleared = false;
    let lastPhase: GamePhase | undefined;

    $: phase = ($currentState.meta?.phase ?? 1) as GamePhase;
    $: isMod = ($userSettings.role ?? "player") === "moderator";
    $: segment = ($currentState.meta?.segment ?? "orders") as "orders" | "resolve";
    $: boardingStep = ($currentState.meta?.boardingStep ?? "attacker") as "attacker" | "defender";
    $: phase7Ordnance = phase !== 7 || segment === "orders";
    $: phase7Fighter = phase !== 7 || segment === "resolve";
    $: phase8Orders = phase !== 8 || segment === "orders";
    $: phase8Resolve = phase === 8 && segment === "resolve" && isMod;
    $: phase9Orders = phase !== 9 || segment === "orders";
    $: phase9Resolve = phase === 9 && segment === "resolve" && isMod;
    $: phase12Attacker = phase !== 12 || segment !== "orders" || boardingStep === "attacker";
    $: phase12Defender = phase !== 12 || segment !== "orders" || boardingStep === "defender";
    $: phase14Orders = phase !== 14 || segment === "orders";

    const applyDefaultSelection = () => {
        userCleared = false;
        selected =
            defaultActActionForPhase(phase, {
                hasShips,
                segment:
                    phase === 7 || phase === 8 || phase === 9 ? segment : undefined,
                boardingStep: phase === 12 ? boardingStep : undefined,
            }) || "";
    };

    const handleDone = () => {
        applyDefaultSelection();
    };

    $: legal = legalCommandsForPhase(phase, { moderator: isMod });
    $: hasShips =
        ($currentState.state?.objects?.some((o) => o.objType === "ship") ?? false);
    $: pendingTransporter = $currentState.pendingTransporterDeliveries;
    $: showTransporterDelivery =
        phase === 11 && hasPendingTransporterDeliveries(pendingTransporter);
    $: showEmpAllocation = phase === 13 && hasBankedEmp($currentState.bankedEmpHits);
    $: actOptions = sortedActActions().filter(
        (a) =>
            (a.key !== "resolveFireAdHoc" || isMod) &&
            (a.key !== "ordnanceStrike" || isMod) &&
            (a.key !== "transporterDelivery" || showTransporterDelivery) &&
            (a.key !== "empAllocation" || showEmpAllocation)
    );

    $: if (phase !== lastPhase) {
        lastPhase = phase;
        applyDefaultSelection();
    }

    $: if (phase === 7 && !userCleared) {
        const want = segment === "orders" ? "declareOrdnanceTarget" : "declareFighterAttack";
        if (selected !== want) selected = want;
    }

    $: if (phase === 8 && !userCleared) {
        const want = segment === "orders" ? "dogfight" : "resolveFurballs";
        if (selected !== want) selected = want;
    }

    $: if (phase === 9 && !userCleared) {
        const want = segment === "orders" ? "pointDefense" : "resolvePointDefense";
        if (selected !== want) selected = want;
    }

    $: if (phase === 12 && !userCleared && segment === "orders") {
        const want = boardingStep === "defender" ? "boardingDefender" : "boardingAttacker";
        if (selected !== want) selected = want;
    }

    const actionLegal = (key: ActActionKey): boolean =>
        isActActionTypicalInPhase(key, phase, legal);

    const optionLabel = (key: ActActionKey, base: string): string => {
        if (actionLegal(key)) return `${base} ★`;
        return base;
    };
</script>

<p class="help mb-2">
    Current phase: {phase} — {phaseName(phase)}. Actions marked ★ are typical for this phase.
</p>

<div class="field">
    <div class="control">
        <div class="select">
            <select
                name="cmdSelect"
                bind:value={selected}
                on:change={(e) => {
                    userCleared = (e.currentTarget as HTMLSelectElement).value === "";
                }}
            >
                <option value="">-- select an action --</option>
                {#each actOptions as action (action.key)}
                    <option value={action.key}>
                        {optionLabel(action.key, actActionLabel(action))}
                    </option>
                {/each}
            </select>
        </div>
    </div>
    {#if selected}
        <p class="help">
            {#if actionLegal(selected)}
                Typically legal in this phase.
            {:else}
                Not typical for {phaseName(phase)} — moderator may still apply.
            {/if}
        </p>
    {/if}
</div>

<div class="container">
{#if selected === "placeShip"}
    <PlaceShip on:done={handleDone} />
{:else if selected === "moveShip"}
    <MoveShip on:done={handleDone} />
{:else if selected === "launchGunboats"}
    <LaunchGunboats on:done={handleDone} />
{:else if selected === "launchGunboatOrdnance"}
    <LaunchGunboatOrdnance on:done={handleDone} />
{:else if selected === "launchFighters"}
    <LaunchFighters on:done={handleDone} />
{:else if selected === "launchOrdnance"}
    <LaunchOrdnance on:done={handleDone} />
{:else if selected === "moveGunboats"}
    <MoveGunboats on:done={handleDone} />
{:else if selected === "moveFighters"}
    <MoveFighters on:done={handleDone} />
{:else if selected === "moveOrdnance"}
    <MoveToken mode="ordnance" on:done={handleDone} />
{:else if selected === "adjustGunboats"}
    <AdjustGunboats on:done={handleDone} />
{:else if selected === "adjustFighters"}
    <AdjustFighters on:done={handleDone} />
{:else if selected === "layMine"}
    <LayMine on:done={handleDone} />
{:else if selected === "declareOrdnanceTarget" && phase7Ordnance}
    <DeclareOrdnanceTarget on:done={handleDone} />
{:else if selected === "declareGunboatAttack" && phase7Fighter}
    <DeclareGunboatAttack on:done={handleDone} />
{:else if selected === "declareFighterAttack" && phase7Fighter}
    <DeclareFighterAttack on:done={handleDone} />
{:else if selected === "declareOrdnanceTarget" || selected === "declareFighterAttack"}
    <p class="help">
        {#if phase === 7 && segment === "orders"}
            Fighter attack allocation opens after the missile allocation step (Next step).
        {:else if phase === 7}
            Missile allocation is complete — use Declare fighter attack.
        {/if}
    </p>
{:else if selected === "dogfight" && phase8Orders}
    <DeclareFurball on:done={handleDone} />
{:else if selected === "resolveFurballs" && phase8Resolve}
    <ResolveFurballs on:done={handleDone} />
{:else if selected === "dogfight" || selected === "resolveFurballs"}
    <p class="help">
        {#if phase === 8 && segment === "orders"}
            Furball resolution is in the next step — declare engagements here first.
        {:else if phase === 8}
            Only the moderator resolves furballs in the resolve segment.
        {/if}
    </p>
{:else if selected === "dogfight"}
    <Furball on:done={handleDone} />
{:else if selected === "interceptOrdnance"}
    <InterceptOrdnance on:done={handleDone} />
{:else if selected === "pointDefense" && phase9Orders}
    <DeclarePointDefense on:done={handleDone} />
{:else if selected === "resolvePointDefense" && phase9Resolve}
    <ResolvePointDefense on:done={handleDone} />
{:else if selected === "pointDefense" || selected === "resolvePointDefense"}
    <p class="help">
        {#if phase === 9 && segment === "orders"}
            Point defense resolution is in the next step — declare allocations here first.
        {:else if phase === 9}
            Only the moderator resolves point defense in the resolve segment.
        {:else}
            Use legacy PDS orders below.
        {/if}
    </p>
    {#if selected === "pointDefense"}
        <PdsOrders on:done={handleDone} />
    {/if}
{:else if selected === "fireWeapon"}
    <FireWeapon on:done={handleDone} />
    {#if showTransporterDelivery}
        <p class="help is-size-7 mt-2">
            Transporter hits pending — declare delivery before advancing.
        </p>
    {/if}
{:else if selected === "transporterDelivery"}
    <TransporterDeliveryDeclare on:done={handleDone} />
{:else if selected === "empAllocation"}
    <EmpAllocationDeclare on:done={handleDone} />
{:else if selected === "resolveFireAdHoc"}
    <FireWeaponAdHoc on:done={handleDone} />
{:else if selected === "ordnanceStrike"}
    <OrdnanceStrike on:done={handleDone} />
{:else if selected === "boardingAttacker" && phase12Attacker}
    <BoardingAttackerOrdersDeclare on:done={handleDone} />
{:else if selected === "boardingDefender" && phase12Defender}
    <BoardingDefenderOrdersDeclare on:done={handleDone} />
{:else if selected === "boardingAttacker" || selected === "boardingDefender"}
    <p class="help">
        {#if phase === 12 && segment === "orders" && boardingStep === "attacker"}
            {BOARDING_STEP_LABELS.defenderAllocation} opens after {BOARDING_STEP_LABELS.attackerAllocation} (Next step).
        {:else if phase === 12 && segment === "orders"}
            Attacker kill/raze allocations are declared in {BOARDING_STEP_LABELS.attackerAllocation} first.
        {:else if phase === 12}
            Boarding resolution applies {BOARDING_STEP_LABELS.dcpRepel}, {BOARDING_STEP_LABELS.resolveCombat}, and {BOARDING_STEP_LABELS.raze}.
        {/if}
    </p>
{:else if selected === "damageControl" && phase14Orders}
    <DamageControl on:done={handleDone} />
{:else if selected === "damageControl"}
    <p class="help">
        Repair orders are declared in the <strong>orders</strong> segment. Moderator: use Next step
        to return from resolve.
    </p>
{:else if selected === "cloak"}
    <Cloak on:done={handleDone} />
{/if}
</div>

<style></style>
