# Developer guide

## Stack

Svelte 5 + Vite, TypeScript, Bulma (CDN), SVG map. Ship validate/render: `ftlibship`.

## Game file (JSON)

Schema: [`src/schemas/game.json`](../src/schemas/game.json).

```
{ version, name, createdAt, turn, phase, initiative?, dicePolicy, diceSeed?,
  fleetLimits?, map, players[], initialState, commands[] }
```

`map` and `players` are defined at game setup and copied into `initialState`. Positions are **derived** by folding `commands` onto `initialState` (see `foldCommands` in `src/lib/game/applyCommand.ts`). Meta commands (`advancePhase`, `setInitiative`, `setMeta`, `logDice`) update fold meta; board commands mutate `position`.

## Adding a command

1. Extend `src/schemas/commands.json`.
2. Run `npm run schemas`.
3. Handle it in `src/lib/game/applyCommand.ts`.
4. Add phase legality in `src/lib/game/phase.ts` if needed.
5. Add unit tests under `src/lib/game/*.test.ts`.
6. Add Act-tab UI as appropriate.

## Engine modules

| Path | Role |
|------|------|
| `src/lib/game/applyCommand.ts` | Command reducer |
| `src/lib/game/movement.ts` | Cinematic movement / arcs |
| `src/lib/game/combat.ts` | Beams, PDS, armour, advanced screens |
| `src/lib/game/thresholds.ts` | Hull-row thresholds |
| `src/lib/game/ordnanceAttack.ts` | Salvo / heavy missile / fighter strike |
| `src/lib/game/boarding.ts` | Phase 12 boarding combat (per-unit DCP/Marine resolver) |
| `src/lib/game/boardingState.ts` | Persistent `ship.boarders.units` state + `RenderOpts.invaders` mapping |
| `src/lib/game/coreSystems.ts` | Core state / reactor |
| `src/lib/game/phase.ts` | Turn sequence helpers |
| `src/lib/game/fluidMapBounds.ts` | Fluid map board bounds (placement vs dynamic sizing, buffer padding) |
| `src/lib/game/dice.ts` | PRNG + sequence parsing |
| `src/lib/game/package.ts` | Import/export helpers |

## Tests

```bash
npm test
```

Vitest runs node-side unit tests for pure engine code. Prefer testing reducers and math over component snapshots.

## Scripts

- `npm run dev` — dev server
- `npm run build` — production build to `/ftGameViewer/` base
- `npm run schemas` — regenerate `.d.ts` from JSON schemas
- `npm run docs` — build static HTML guides to `public/docs` (and `dist/docs` on production build)
- `npm run check` — `svelte-check`
