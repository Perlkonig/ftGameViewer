import { writable } from "svelte/store";

export interface IBeacon {
    x: number;
    y: number;
}

export const beacon = writable(undefined as IBeacon);
