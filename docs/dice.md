# Dice and trust model

This client is **decentralized**: there is no shared server that can enforce fair rolls. Anyone can edit a JSON game file. Trust comes from the **human moderator** and from writing dice into the append-only command log so others can audit and replay.

## Policies (`dicePolicy`)

| Policy | Behavior |
|--------|----------|
| `client` | Local seeded PRNG generates rolls. Fine for solo what-if; only authoritative if the moderator accepts those rolls into the master log. |
| `moderatorSequence` | Rolls must come from a pasted number sequence (e.g. from an external roller). The client will not invent combat dice. |
| `hybrid` (default) | Use a pasted sequence when present; otherwise fall back to client PRNG. |

Optional `diceSeed` makes client PRNG reproducible for a given game.

## Entering external rolls

Paste strings such as:

- `4,6,6,2,5`
- `4 6 6 2 5`
- `46625`

Each value must be a d6 (1–6). Consumed rolls should be recorded with a `logDice` command (`purpose`, `rolls`, `source`).

## What is authoritative?

- **Master game** held by the moderator, after they apply commands and dice.
- Player-local rolls and what-if branches are **proposals** until imported into that master log.

## Why not commit–reveal or blockchain?

Those can improve fairness for simultaneous secret rolls, but they add protocol complexity and still need social agreement. Full Thrust already assumes a moderator for adjudication; recording moderator (or agreed external) dice in the log matches that model.
