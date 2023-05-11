import { writable } from "svelte/store";

export interface IMousePos {
    x: number;
    y: number;
    id?: string;
}

export const mousePos = writable({} as IMousePos);
