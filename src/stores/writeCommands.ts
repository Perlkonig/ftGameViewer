import { writable } from "svelte/store";
import type { FullThrustGameCommand } from "@/schemas/commands";

export const commands = writable([] as FullThrustGameCommand[]);
