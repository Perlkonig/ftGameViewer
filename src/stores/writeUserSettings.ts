import { writable } from "svelte/store";

export interface IUserSettings {
    opacity?: number;
}

let initialSettings: IUserSettings = {};
if (localStorage.getItem("settings") !== null) {
    initialSettings = JSON.parse(localStorage.getItem("settings")) as IUserSettings;
}

export const userSettings = writable(initialSettings);

userSettings.subscribe(v => {
    localStorage.setItem("settings", JSON.stringify(v));
});
