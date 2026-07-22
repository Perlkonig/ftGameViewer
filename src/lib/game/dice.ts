/**
 * Dice service: seeded PRNG, moderator sequence consumption, and parsing.
 * Authoritative combat dice should be written into the command log by the moderator.
 */

export type DiceSource = "client" | "moderatorSequence" | "external";

export interface DiceRollResult {
    rolls: number[];
    source: DiceSource;
}

/** Mulberry32 seeded PRNG → integers in [1, 6]. */
export class SeededDice {
    private state: number;

    constructor(seed: string | number = Date.now()) {
        this.state = typeof seed === "number" ? seed : hashString(seed);
    }

    next(): number {
        this.state |= 0;
        this.state = (this.state + 0x6d2b79f5) | 0;
        let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        return 1 + Math.floor(u * 6);
    }

    roll(n: number): number[] {
        if (n < 1) throw new Error("Must roll at least one die");
        return Array.from({ length: n }, () => this.next());
    }
}

export class DiceSequence {
    private queue: number[];
    readonly source: DiceSource;

    constructor(rolls: number[], source: DiceSource = "moderatorSequence") {
        this.queue = [...rolls];
        this.source = source;
    }

    remaining(): number {
        return this.queue.length;
    }

    take(n: number): number[] {
        if (n > this.queue.length) {
            throw new Error(`Need ${n} dice but only ${this.queue.length} remain in sequence`);
        }
        return this.queue.splice(0, n);
    }
}

/** Parse strings like "4,6,6,2,5" or "4 6 6 2 5" or "46625" into d6 values. */
export function parseDiceString(input: string): number[] {
    const trimmed = input.trim();
    if (!trimmed) throw new Error("Empty dice string");

    let parts: string[];
    if (/[,\s]/.test(trimmed)) {
        parts = trimmed.split(/[,\s]+/).filter(Boolean);
    } else if (/^[1-6]+$/.test(trimmed)) {
        parts = trimmed.split("");
    } else {
        throw new Error(`Cannot parse dice string: "${input}"`);
    }

    const rolls = parts.map((p) => {
        const n = Number(p);
        if (!Number.isInteger(n) || n < 1 || n > 6) {
            throw new Error(`Invalid d6 value: "${p}"`);
        }
        return n;
    });
    if (rolls.length === 0) throw new Error("No dice found in string");
    return rolls;
}

export class InsufficientDiceError extends Error {
    constructor(message = "Insufficient dice for penetrating reroll") {
        super(message);
        this.name = "InsufficientDiceError";
    }
}

/** Supplies d6 values on demand during combat resolution (including penetrating rerolls). */
export interface RollSource {
    next(): number;
    /** All dice taken so far, in order. */
    consumed(): number[];
    /** Bookmark for per-attack consumed slices. */
    mark(): number;
    consumedSince(mark: number): number[];
}

export function arrayRollSource(rolls: number[]): RollSource {
    let idx = 0;
    const consumed: number[] = [];
    return {
        next() {
            if (idx >= rolls.length) {
                throw new InsufficientDiceError();
            }
            const value = rolls[idx++];
            consumed.push(value);
            return value;
        },
        consumed: () => [...consumed],
        mark: () => consumed.length,
        consumedSince: (mark: number) => consumed.slice(mark),
    };
}

/** Use preset rolls first, then fall back to another source (e.g. reactor rolls then breach dice). */
export function chainedRollSource(preset: number[], rest: RollSource): RollSource {
    let presetIdx = 0;
    const consumed: number[] = [];
    return {
        next() {
            let value: number;
            if (presetIdx < preset.length) {
                value = preset[presetIdx++]!;
            } else {
                value = rest.next();
            }
            consumed.push(value);
            return value;
        },
        consumed: () => [...consumed],
        mark: () => consumed.length,
        consumedSince: (mark: number) => consumed.slice(mark),
    };
}

export function generatorRollSource(nextFn: () => number): RollSource {
    const consumed: number[] = [];
    return {
        next() {
            const value = nextFn();
            consumed.push(value);
            return value;
        },
        consumed() {
            return [...consumed];
        },
        mark() {
            return consumed.length;
        },
        consumedSince(mark: number) {
            return consumed.slice(mark);
        },
    };
}

function hashString(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

export type DicePolicy = "client" | "moderatorSequence" | "hybrid";

/** Fixed-count d6 from a pasted string or game dice policy when input is empty. */
export function fixedDiceRolls(
    input: string,
    count: number,
    policy: DicePolicy,
    opts: { seed?: string; sequence?: number[] } = {}
): DiceRollResult {
    if (count < 0) throw new Error("Dice count cannot be negative");
    if (count === 0) return { rolls: [], source: "client" };
    if (input.trim()) {
        const rolls = parseDiceString(input);
        if (rolls.length < count) {
            throw new Error(`Need ${count} dice; got ${rolls.length}`);
        }
        return { rolls, source: "moderatorSequence" };
    }
    return createDiceFromPolicy(policy, opts).roll(count);
}

export function createDiceFromPolicy(
    policy: "client" | "moderatorSequence" | "hybrid",
    opts: { seed?: string; sequence?: number[] } = {}
): { roll: (n: number) => DiceRollResult } {
    if (policy === "moderatorSequence" || (policy === "hybrid" && opts.sequence && opts.sequence.length > 0)) {
        const seq = new DiceSequence(opts.sequence ?? [], "moderatorSequence");
        return {
            roll: (n) => ({ rolls: seq.take(n), source: seq.source }),
        };
    }
    const rng = new SeededDice(opts.seed ?? Date.now());
    return {
        roll: (n) => ({ rolls: rng.roll(n), source: "client" }),
    };
}

export function policyRollSource(
    policy: "client" | "moderatorSequence" | "hybrid",
    opts: { seed?: string; sequence?: number[] } = {}
): RollSource {
    const dice = createDiceFromPolicy(policy, opts);
    return generatorRollSource(() => dice.roll(1).rolls[0]);
}
