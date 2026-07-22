import { writable } from "svelte/store";
import type { FullThrustGamePosition } from "@/schemas/position";

export const initialState = writable({} as FullThrustGamePosition);
