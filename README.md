# Full Thrust Game Viewer

A decentralized, browser-only client for human-moderated games of [Full Thrust](https://shop.groundzerogames.co.uk/rules.html). There is no backend: the game is a JSON **game package** (initial state + command log) that players and the moderator exchange as files.

The client helps with core-rule minutiae (cinematic movement, beam fire, fighters/ordnance/PD, thresholds, damage control) while leaving house rules and adjudication to the human moderator. Ship construction and SSD rendering use [ftLibShip](https://github.com/Perlkonig/ftLibShip).

**NOTE:** Designed for mouse and keyboard on a large screen.

## Quick start

```bash
npm i
npm run dev
```

Production build: `npm run build` (output in `dist/`). Tests: `npm test`. Regenerate schema types: `npm run schemas`.

## How it works

1. The **moderator** creates a game package (map, players, fleet limits, dice policy) and sends the JSON file to players.
2. **Players** load the package, place ships / write orders, and export a **command bundle** for the moderator.
3. The moderator reviews, applies bundles to the master package, rolls or enters authoritative dice, advances phases, and redistributes the updated package.
4. Anyone can **replay** the command log with the timeline scrubber.

See documentation:

- [Player guide](docs/players.md)
- [Moderator guide](docs/moderators.md)
- [Developer guide](docs/developers.md)
- [Dice & trust model](docs/dice.md)

## Support

Value-for-value donations: [paypal.me/abstractplay](https://www.paypal.me/abstractplay).

## License

See [LICENSE](LICENSE). Counter SVGs are public domain (see `public/counters/LICENSE`).
