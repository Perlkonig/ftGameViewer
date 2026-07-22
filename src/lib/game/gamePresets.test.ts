import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyPackage } from "./package";
import {
    isPresetLoadKey,
    listGamePresets,
    loadGamePreset,
    localLoadKey,
    presetFileFromKey,
    presetLoadKey,
} from "./gamePresets";

describe("gamePresets", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("builds stable load keys", () => {
        expect(presetLoadKey("Intro.ftgame.json")).toBe("preset:Intro.ftgame.json");
        expect(localLoadKey("Alpha")).toBe("local:Alpha");
        expect(isPresetLoadKey("preset:foo.ftgame.json")).toBe(true);
        expect(isPresetLoadKey("local:foo")).toBe(false);
        expect(presetFileFromKey("preset:foo.ftgame.json")).toBe("foo.ftgame.json");
    });

    it("lists presets from manifest", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string) => {
                if (url === "/presets/manifest.json") {
                    return {
                        ok: true,
                        json: async () => [{ file: "Intro.ftgame.json", name: "Intro Scenario" }],
                    };
                }
                throw new Error(`unexpected fetch: ${url}`);
            })
        );

        const presets = await listGamePresets();
        expect(presets).toEqual([
            {
                key: "preset:Intro.ftgame.json",
                displayName: "Intro Scenario",
                file: "Intro.ftgame.json",
                kind: "preset",
            },
        ]);
    });

    it("loads a preset package", async () => {
        const pkg = createEmptyPackage("Intro Scenario");
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string) => {
                if (url === "/presets/Intro.ftgame.json") {
                    return { ok: true, json: async () => pkg };
                }
                throw new Error(`unexpected fetch: ${url}`);
            })
        );

        const loaded = await loadGamePreset("Intro.ftgame.json");
        expect(loaded.name).toBe("Intro Scenario");
    });
});
