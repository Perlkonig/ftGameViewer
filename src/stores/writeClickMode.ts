import { writable } from "svelte/store";

export type ClickMode = undefined | "beacon" | "select";

export const clickMode = writable(undefined as ClickMode);
