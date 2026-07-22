import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const presetsDir = path.join(__dirname, "../public/presets");

if (!fs.existsSync(presetsDir)) {
    fs.mkdirSync(presetsDir, { recursive: true });
}

const files = fs
    .readdirSync(presetsDir)
    .filter((f) => f.endsWith(".ftgame.json"))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

const manifest = files.map((file) => {
    const raw = JSON.parse(fs.readFileSync(path.join(presetsDir, file), "utf8"));
    const name =
        typeof raw.name === "string" && raw.name.trim()
            ? raw.name.trim()
            : file.replace(/\.ftgame\.json$/i, "").replace(/_/g, " ");
    return { file, name };
});

manifest.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

fs.writeFileSync(
    path.join(presetsDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
);

console.log(`Wrote ${manifest.length} preset(s) to public/presets/manifest.json`);

const fleetSrc = require.resolve("ftlibship/preset-fleets.json");
const fleetDest = path.join(presetsDir, "fleets.json");
fs.copyFileSync(fleetSrc, fleetDest);
console.log("Copied ftlibship preset fleets to public/presets/fleets.json");
