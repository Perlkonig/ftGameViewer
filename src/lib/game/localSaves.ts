import { parseLoadable, type GamePackage } from "./package";

const SAVES_KEY = "ftGameViewer_namedSaves";
const LEGACY_WORKING_KEY = "working";

export interface LocalSaveEntry {
    /** Storage key (same as display name for named saves). */
    key: string;
    displayName: string;
    savedAt?: string;
    /** Loaded from the legacy single-slot `working` key. */
    isLegacy?: boolean;
}

interface StoredSave {
    package: GamePackage;
    savedAt: string;
}

type SavesRecord = Record<string, StoredSave>;

function readRecord(): SavesRecord {
    const raw = localStorage.getItem(SAVES_KEY);
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw) as SavesRecord;
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

function writeRecord(record: SavesRecord): void {
    localStorage.setItem(SAVES_KEY, JSON.stringify(record));
}

export function normalizeSaveName(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Save name is required");
    return trimmed;
}

export function localSaveExists(name: string): boolean {
    const key = normalizeSaveName(name);
    if (readRecord()[key]) return true;
    const legacy = readLegacyWorking();
    return legacy !== null && legacy.displayName === key;
}

export function listLocalSaves(): LocalSaveEntry[] {
    const record = readRecord();
    const entries: LocalSaveEntry[] = Object.entries(record).map(([key, value]) => ({
        key,
        displayName: value.package.name || key,
        savedAt: value.savedAt,
    }));

    const legacy = readLegacyWorking();
    if (legacy && !entries.some((e) => e.displayName === legacy.displayName)) {
        entries.push(legacy);
    }

    return entries.sort((a, b) =>
        a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" })
    );
}

function readLegacyWorking(): LocalSaveEntry | null {
    const raw = localStorage.getItem(LEGACY_WORKING_KEY);
    if (!raw) return null;
    try {
        const pkg = parseLoadable(JSON.parse(raw));
        const displayName = pkg.name?.trim() || "Working";
        return {
            key: LEGACY_WORKING_KEY,
            displayName,
            isLegacy: true,
        };
    } catch {
        return null;
    }
}

export function loadLocalSave(key: string): GamePackage {
    if (key === LEGACY_WORKING_KEY) {
        const raw = localStorage.getItem(LEGACY_WORKING_KEY);
        if (!raw) throw new Error("Legacy save not found");
        return parseLoadable(JSON.parse(raw));
    }
    const entry = readRecord()[key];
    if (!entry) throw new Error(`Save not found: ${key}`);
    return entry.package;
}

export function saveLocalGame(name: string, pkg: GamePackage): void {
    const key = normalizeSaveName(name);
    const record = readRecord();
    const toSave: GamePackage = { ...pkg, name: key };
    record[key] = {
        package: toSave,
        savedAt: new Date().toISOString(),
    };
    writeRecord(record);

    // Keep legacy slot in sync for older bookmarks / habits.
    localStorage.setItem(LEGACY_WORKING_KEY, JSON.stringify(toSave));
}

export function deleteLocalSave(key: string): void {
    if (key === LEGACY_WORKING_KEY) {
        localStorage.removeItem(LEGACY_WORKING_KEY);
        return;
    }

    const record = readRecord();
    if (!record[key]) {
        throw new Error(`Save not found: ${key}`);
    }
    delete record[key];
    writeRecord(record);

    const legacyRaw = localStorage.getItem(LEGACY_WORKING_KEY);
    if (legacyRaw) {
        try {
            const legacy = parseLoadable(JSON.parse(legacyRaw));
            const legacyName = legacy.name?.trim() || "Working";
            if (legacyName === key) {
                localStorage.removeItem(LEGACY_WORKING_KEY);
            }
        } catch {
            // ignore malformed legacy slot
        }
    }
}
