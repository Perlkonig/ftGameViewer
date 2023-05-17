import { writable } from "svelte/store";

export interface IBuffer {
    top: number;
    bottom: number;
    left: number;
    right: number;
}

export const mapBuffers = writable({top: 5, bottom: 5, left: 5, right: 5} as IBuffer);
