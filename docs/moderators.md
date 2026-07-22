# Moderator automation notes

## Fighters

- Wings deployed as **multiRole** from the SSD stay multiRole until you run **`setFighterType`** (Moderator tools or command log). Combat allocation, ordnance launch, and strikes are blocked until a real type is set.
- **`setFighterType`** clamps wing size and CEF per type/mods, rebuilds the map SVG, and syncs the parent hangar overlay when docked.
- Fighter profiles drive move, intercept, dogfight DRM, strikes, and PD target DRM. Ordnance launch in phase 3 uses **`launchFighterOrdnance`** (no separate Act UI in v1).

## Gunboats

- **`screenGunboats`** is allowed (escort like fighters). **`pursueGunboats`** is rejected — gunboats do not use fighter pursue.
- Phase 10 **ship** attacks from phase 7 allocations resolve as **`gunboatShipStrike`** with per-boat weapon profiles.
- **Protection** (heavy/screened) applies −1 DRM when firing at gunboats (PD and ship fire). **ECM** reduces missile/fighter lock range by 1 MU per level from nearby enemy gunboats (within 12 MU of the target ship).
- Missile gunboat launches spawn a **4-missile** salvo. Boat kills randomize which `boats[]` entry is removed when dice are available.
- FTL auto-destruction on distortion, full gatling PDS mode, and some ordnance edge cases remain manual.

## Commands (moderator-friendly)

| Command | Purpose |
|--------|---------|
| `setFighterType` | Set operational fighter type for a multiRole wing |
| `launchFighterOrdnance` | Phase 3 torpedo/missile/MKP from a configured wing |
| `gunboatShipStrike` | Phase 10 replay token for gunboat anti-ship fire |
