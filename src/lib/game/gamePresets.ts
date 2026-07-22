import { parseLoadable, type GamePackage } from "./package";

export interface GamePresetManifestEntry {
    file: string;
    name: string;
}

export interface GamePresetEntry {
    key: string;
    displayName: string;
    file: string;
    kind: "preset";
}

const PRESET_PREFIX = "preset:";
const LOCAL_PREFIX = "local:";
const presetsBase = `${import.meta.env.BASE_URL}presets/`;
const MANIFEST_URL = `${presetsBase}manifest.json`;

export function presetLoadKey(file: string): string {
    return `${PRESET_PREFIX}${file}`;
}

export function localLoadKey(key: string): string {
    return `${LOCAL_PREFIX}${key}`;
}

export function isPresetLoadKey(key: string): boolean {
    return key.startsWith(PRESET_PREFIX);
}

export function presetFileFromKey(key: string): string {
    if (!isPresetLoadKey(key)) throw new Error("Not a preset load key");
    return key.slice(PRESET_PREFIX.length);
}

export function localKeyFromLoadKey(key: string): string {
    if (key.startsWith(LOCAL_PREFIX)) return key.slice(LOCAL_PREFIX.length);
    return key;
}

export async function listGamePresets(): Promise<GamePresetEntry[]> {
    try {
        const res = await fetch(MANIFEST_URL);
        if (!res.ok) return [];
        const manifest = (await res.json()) as GamePresetManifestEntry[];
        if (!Array.isArray(manifest)) return [];
        return manifest
            .filter((e) => typeof e.file === "string" && e.file.endsWith(".ftgame.json"))
            .map(({ file, name }) => ({
                key: presetLoadKey(file),
                displayName: typeof name === "string" && name.trim() ? name.trim() : file,
                file,
                kind: "preset" as const,
            }));
    } catch {
        return [];
    }
}

export async function loadGamePreset(file: string): Promise<GamePackage> {
    const res = await fetch(`${presetsBase}${encodeURIComponent(file)}`);
    if (!res.ok) throw new Error(`Preset not found: ${file}`);
    return parseLoadable(await res.json());
}
