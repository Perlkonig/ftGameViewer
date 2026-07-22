# Player guide

## Role

Use the **Player / Moderator** toggle above the game buttons (or Settings). In player mode you draft commands into a proposal list and export them; you do not advance the master turn sequence unless you are also acting as moderator on a local copy.

## Loading a game

1. **Import Game** (file) or paste JSON via **Paste Game**, or use **New game** if you are the moderator setting up a fresh scenario.
2. Confirm the map, players, fleet limits, and current turn/phase in the sidebar.
3. Use **Save Local** to keep a working copy in the browser.

## Map types

**Fixed table** — The map has fixed edges. You can place and move ships **off the edge** of the displayed table; the map does not expand.

**Fluid map** — During placement (turn 1, phase 1) the board is the configured starting size (default 72×48 MU). After the moderator advances to **phase 2**, the map grows and shrinks to keep all visible tokens on screen, plus a margin (**buffer**). Use the **Buffer (MU)** slider in the status bar (next to coordinates) anytime to add or remove extra margin (0–48 MU). The slider is cosmetic only and is not saved in proposals.

## Placement

1. Open the **Act** tab and complete map/players if the game is empty (usually the moderator does this).
2. **Place a ship**: paste ship JSON from [ftShipBuilder](https://www.perlkonig.com/ftShipBuilder), choose a counter, owner, click the map, set facing/speed. If the moderator enabled vector movement for this game, you may opt in once at placement (starting course); that cannot be changed later.
3. Export **proposals** containing your `placeShip` commands and send them to the moderator.

### Ship counters

When placing a ship, pick a **preset** map counter (base + variant) or supply a custom SVG. Preset counters are named **`BBB-VV`**: three-digit base, two-digit variant (for example `001-01`, `083-10`). The base usually matches ship mass; some masses have multiple variants.

See the **[ship counter contact sheet](counter-sheet.html)** for a visual catalogue of every available preset.

Respect fleet limits shown in the sidebar; the client displays them but the moderator enforces them.

## During a turn

Follow the phase indicator. Typical Act-tab helpers:

| Phase | Helpers |
|-------|---------|
| Orders (1) | Move ship — optional **Sweep for mines** (mine sweeper) and **Lay mine from layer** checkboxes per minelayer magazine |
| Ship Movement (5) | Lay mine along pending path; moderator **Resolve movement** applies all ships then mine dice |
| Launch (3) | **Launch ordnance** (missiles, salvo, AMT, PBL — click map) and **Launch fighters** (docked wings within 1 MU). Rocket pods: pick target, then resolve segment rolls 2d6 to place hits. |
| Fighter movement (4) | Move fighters, secondary move, adjust/recover to hangar |
| Allocate attacks (6) | Declare attack (log only) |
| Dogfights (7) | Dogfight resolver |
| Point defense (8) | Fire / PDS against fighters or ordnance |
| Missile & fighter attacks (9) | Salvo / heavy missile / fighter strike |
| Ship fire (11) | Declare fire per ship (orders → resolve) |
| Boarding (12) | Boarding orders per contested ship (orders → resolve) |
| Thresholds (13) | Automatic on phase entry — pending checks from hull damage; moderator resolves dice |
| Damage control (14) | Declare repair orders: allocate 0–3 DCP per damaged system/drive/core knockout; optional regen armour (1d6 per damaged box on resolve). Orders → resolve like ship fire. |
| Reactor (15) | No player action — moderator polls dump/abandon/hold and resolves unstable-reactor rolls (and optional breach damage) on phase entry |

- Use **Explore** for SSDs and firing arcs; **Measure** for range finding and templates.
- Export your proposals when ready. Do not assume local dice are official.

## Replay

Use the timeline scrubber to step through commands already on the loaded game and understand what happened last turn.

## Not yet assisted (deferred)

FTL entry/exit and map terrain features remain manual / moderator `_custom` for now. Gunboat squadrons, racks, boat bays, launch/recover, movement, attacks, and ordnance-launch gunboats are supported in the Act tab. Reflex Field remains manual.
