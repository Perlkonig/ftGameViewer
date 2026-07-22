import { get, writable } from "svelte/store";

export const selectedObject = writable<string | undefined>(undefined);

/** Set the selected map object and always notify subscribers. */
export function selectObject(key: string): void {
    if (get(selectedObject) === key) {
        selectedObject.set(undefined);
    }
    selectedObject.set(key);
}
