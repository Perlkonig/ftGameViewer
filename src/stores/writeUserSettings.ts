import { writable } from "svelte/store";

export type UserRole = "player" | "moderator";

export interface IUserSettings {
    opacity?: number;
    role?: UserRole;
}

let initialSettings: IUserSettings = { role: "player", opacity: 1 };
if (localStorage.getItem("settings") !== null) {
    try {
        const raw = localStorage.getItem("settings");
        if (raw !== null) {
            initialSettings = { ...initialSettings, ...(JSON.parse(raw) as IUserSettings) };
        }
    } catch {
        // keep defaults
    }
}

export const userSettings = writable(initialSettings);

userSettings.subscribe((v) => {
    localStorage.setItem("settings", JSON.stringify(v));
});
