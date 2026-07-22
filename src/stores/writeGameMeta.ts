import { writable } from "svelte/store";
import type { GameMeta } from "@/lib/game/types";
import { DEFAULT_META } from "@/lib/game/types";

export const gameMeta = writable<GameMeta>(DEFAULT_META());
