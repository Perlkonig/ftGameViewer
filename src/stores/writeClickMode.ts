import { writable } from "svelte/store";

export type ClickMode = undefined | "beacon";

export const clickMode = writable(undefined as ClickMode);
