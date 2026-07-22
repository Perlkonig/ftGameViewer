<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { currentState } from "@/stores/derivedState";
    import { appendGameCommands } from "@/lib/game/appendCommand";
    import { validateDeclareShipFireBatch } from "@/lib/game/commandValidation";
    import { encodeFireDeclarationNotes, resolveFireDeclaration } from "@/lib/game/resolveCombat";
    import { defaultPdsDiceForWeapon } from "@/lib/weaponAnnotations";
    import { operationalPdsEntries, type ShipGameState } from "@/lib/game/shipSystems";
    import { pendingFireForShip, filterNewFireDeclarations } from "@/lib/game/segmentApply";
    import { policyRollSource } from "@/lib/game/dice";
    import { gameMeta } from "@/stores/writeGameMeta";
    import { distance } from "@/lib/game/movement";
    import type { FullThrustGameCommand } from "@/schemas/commands";
    import type { FullThrustGameObjects, Position } from "@/schemas/position";
    import { toast } from "@zerodevx/svelte-toast";
    import { userSettings } from "@/stores/writeUserSettings";
    import ActError from "./ActError.svelte";
    import { focusMapOnObjectId, focusMapOnShipId } from "@/lib/actMapInteraction";

    const dispatch = createEventDispatcher();

    let firerId = "";
    let pdsTargets: Record<string, string> = {};
    let prevFirerId = "";

    $: if (firerId !== prevFirerId) {
        prevFirerId = firerId;
        const ship = ships.find((s) => s.id === firerId);
        const pds = ship ? operationalPdsEntries(ship as ShipGameState) : [];
        pdsTargets = Object.fromEntries(pds.map((p) => [p.id, ""]));
        if (firerId) focusMapOnShipId(firerId, ships);
    }

    $: players = $currentState.state?.players ?? [];
    $: allObjects = $currentState.state?.objects ?? [];
    $: ships =
        allObjects.filter((o) => o.objType === "ship" && o.position) as FullThrustGameObjects[];

    $: firer = ships.find((s) => s.id === firerId);
    $: pdsSystems = firer
        ? operationalPdsEntries(firer as ShipGameState)
        : [];

    $: enemyTargets = allObjects.filter((o) => {
        if (!o.position) return false;
        const owner = "owner" in o && typeof o.owner === "string" ? o.owner : undefined;
        if (!owner || !firer?.owner || owner === firer.owner) return false;
        return o.objType === "fighters" || o.objType === "ordnance" || o.objType === "ship";
    });

    $: foldStub = {
        meta: $currentState.meta ?? {
            phase: 9,
            turn: 1,
            version: "",
            name: "",
            createdAt: "",
            dicePolicy: "hybrid",
        },
        position: $currentState.state ?? { map: { mode: "fixed", width: 72, height: 48 } },
        pendingFireDeclarations: $currentState.pendingFireDeclarations,
    };

    $: isMod = ($userSettings.role ?? "player") === "moderator";
    $: pendingPds = firerId
        ? pendingFireForShip(foldStub, firerId).filter((decl) => {
              const notes = (decl as { notes?: string }).notes;
              try {
                  const parsed = notes ? JSON.parse(notes) : {};
                  return (parsed.profile ?? "beam") === "pds";
              } catch {
                  return false;
              }
          })
        : [];

    $: actIssues = firerId
        ? validateDeclareShipFireBatch(
              foldStub,
              firerId,
              filterNewFireDeclarations(foldStub, firerId, buildDraftDecls()),
              {}
          )
        : [];

    const resolvePendingPds = () => {
        if (!firerId || pendingPds.length === 0) {
            toast.push("No pending PDS orders for this ship");
            return;
        }
        const meta = $currentState.meta ?? $gameMeta;
        const source = policyRollSource(meta.dicePolicy, { seed: meta.diceSeed });
        const cmds: FullThrustGameCommand[] = [];
        const mark = source.mark();
        for (const decl of pendingPds) {
            const targetId = (decl as { target?: string }).target;
            const target = allObjects.find((o) => o.id === targetId);
            cmds.push(...resolveFireDeclaration(decl, source, target));
        }
        const consumed = source.consumedSince(mark);
        cmds.push({
            name: "resolveShipFire",
            ship: firerId,
            rolls: consumed,
        } as FullThrustGameCommand);
        appendGameCommands(cmds, true);
        toast.push(`Resolved ${pendingPds.length} PDS order(s) for ${firerId}`);
    };

    const targetLabel = (id: string): string => {
        const obj = allObjects.find((o) => o.id === id);
        if (!obj) return id;
        const owner = "owner" in obj && typeof obj.owner === "string" ? obj.owner : "";
        return `${obj.objType} ${obj.id}${owner ? ` (${owner})` : ""}`;
    };

    const onPdsTargetChange = (targetId: string) => {
        if (!targetId) return;
        focusMapOnObjectId(targetId, allObjects as FullThrustGameObjects[]);
    };

    const buildDraftDecls = (): FullThrustGameCommand[] => {
        if (!firer) return [];
        const decls: FullThrustGameCommand[] = [];
        for (const pds of pdsSystems) {
            const targetId = pdsTargets[pds.id];
            if (!targetId) continue;
            const target = allObjects.find((o) => o.id === targetId);
            const range =
                firer.position &&
                target?.position &&
                typeof target.position === "object" &&
                "x" in target.position
                    ? distance(firer.position as Position, target.position as Position)
                    : 0;
            decls.push({
                name: "declareShipFire",
                ship: firerId,
                weapon: pds.id,
                target: targetId,
                notes: encodeFireDeclarationNotes({
                    profile: "pds",
                    pdsDice: defaultPdsDiceForWeapon(pds),
                    range,
                    weaponName: pds.name,
                }),
            } as FullThrustGameCommand);
        }
        return decls;
    };

    const submit = () => {
        if (!firer) {
            toast.push("Select a ship");
            return;
        }
        if (pdsSystems.length === 0) {
            toast.push("This ship has no operational PDS");
            return;
        }
        const decls = filterNewFireDeclarations(foldStub, firerId, buildDraftDecls());
        if (decls.length === 0) {
            toast.push("Select a target for at least one PDS not already declared");
            return;
        }
        const issues = validateDeclareShipFireBatch(foldStub, firerId, decls, {});
        const dest = appendGameCommands(
            decls,
            ($userSettings.role ?? "player") === "moderator"
        );
        const warn = issues.filter((i) => i.severity === "warning");
        if (warn.length) {
            toast.push(warn.map((w) => w.message).join(" "));
        }
        toast.push(
            dest === "master"
                ? `Logged ${decls.length} PDS order(s)`
                : `Added ${decls.length} PDS order(s) to proposals`
        );
        dispatch("done");
    };
</script>

<p class="help">
    Assign each point-defense system a target (fighters, ordnance, or enemy ships — not your own).
</p>

{#if players.length > 1}
    <div class="field">
        <label class="label" for="pdsOwner">Your ships</label>
        <p class="help is-size-7">Select your ship below.</p>
    </div>
{/if}

<div class="field">
    <label class="label" for="pdsFirer">Firing ship</label>
    <div class="select">
        <select id="pdsFirer" bind:value={firerId}>
            <option value="">--</option>
            {#each ships as s}
                <option value={s.id}>{s.id}{s.owner ? ` (${s.owner})` : ""}</option>
            {/each}
        </select>
    </div>
</div>

{#if firer && pdsSystems.length === 0}
    <p class="help has-text-warning">No operational PDS on this ship.</p>
{/if}

{#if firer && pdsSystems.length > 0}
    {#each pdsSystems as pds}
        <div class="field">
            <label class="label" for="pds-{pds.id}">{pds.name ?? "pds"} ({pds.id})</label>
            <div class="select is-fullwidth">
                <select
                    id="pds-{pds.id}"
                    bind:value={pdsTargets[pds.id]}
                    on:change={() => onPdsTargetChange(pdsTargets[pds.id])}
                >
                    <option value="">— no target —</option>
                    {#each enemyTargets as t}
                        <option value={t.id}>{targetLabel(t.id)}</option>
                    {/each}
                </select>
            </div>
        </div>
    {/each}

    <button class="button is-primary" on:click={submit}>Submit PDS orders</button>
    {#if isMod && pendingPds.length > 0}
        <button type="button" class="button is-info ml-2" on:click={resolvePendingPds}>
            Resolve {pendingPds.length} pending PDS
        </button>
    {/if}
    <ActError issues={actIssues} />
{/if}
