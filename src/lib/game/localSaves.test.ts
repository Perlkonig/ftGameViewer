import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyPackage } from "./package";
import {
    listLocalSaves,
    loadLocalSave,
    localSaveExists,
    deleteLocalSave,
    saveLocalGame,
} from "./localSaves";

describe("localSaves", () => {
    const storage = new Map<string, string>();

    beforeEach(() => {
        storage.clear();
        vi.stubGlobal("localStorage", {
            getItem: (k: string) => storage.get(k) ?? null,
            setItem: (k: string, v: string) => {
                storage.set(k, v);
            },
            removeItem: (k: string) => {
                storage.delete(k);
            },
        });
    });

    it("saves and lists named games", () => {
        const pkg = createEmptyPackage("Alpha");
        saveLocalGame("Alpha", pkg);
        expect(localSaveExists("Alpha")).toBe(true);
        expect(listLocalSaves().map((s) => s.displayName)).toEqual(["Alpha"]);
        const loaded = loadLocalSave("Alpha");
        expect(loaded.name).toBe("Alpha");
    });

    it("overwrites an existing save name", () => {
        saveLocalGame("Bravo", createEmptyPackage("Bravo"));
        saveLocalGame("Bravo", createEmptyPackage("Bravo v2"));
        expect(listLocalSaves()).toHaveLength(1);
        expect(loadLocalSave("Bravo").name).toBe("Bravo");
    });

    it("lists legacy working save", () => {
        const legacy = createEmptyPackage("Legacy Game");
        storage.set("working", JSON.stringify(legacy));
        const entries = listLocalSaves();
        expect(entries).toHaveLength(1);
        expect(entries[0].isLegacy).toBe(true);
        expect(loadLocalSave("working").name).toBe("Legacy Game");
    });

    it("deletes a named save", () => {
        saveLocalGame("Charlie", createEmptyPackage("Charlie"));
        deleteLocalSave("Charlie");
        expect(localSaveExists("Charlie")).toBe(false);
        expect(listLocalSaves()).toHaveLength(0);
    });

    it("deletes legacy working save", () => {
        storage.set("working", JSON.stringify(createEmptyPackage("Legacy Game")));
        deleteLocalSave("working");
        expect(listLocalSaves()).toHaveLength(0);
    });

    it("clears legacy slot when deleting matching named save", () => {
        saveLocalGame("Delta", createEmptyPackage("Delta"));
        deleteLocalSave("Delta");
        expect(storage.has("working")).toBe(false);
    });
});
