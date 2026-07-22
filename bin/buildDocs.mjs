/**
 * Convert docs/*.md to static HTML for distribution (public/docs in dev, dist/docs on build).
 */
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { marked } from "marked";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = join(root, "docs");
const outDir = process.argv[2] ? join(process.cwd(), process.argv[2]) : join(root, "public", "docs");

/** @type {{ file: string; slug: string; navLabel: string }[]} */
const PAGES = [
    { file: "players.md", slug: "players", navLabel: "Player" },
    { file: "moderators.md", slug: "moderators", navLabel: "Moderator" },
    { file: "developers.md", slug: "developers", navLabel: "Developer" },
    { file: "dice.md", slug: "dice", navLabel: "Dice" },
];

const EXTRA_NAV = [{ slug: "counter-sheet", navLabel: "Counters" }];

marked.setOptions({ gfm: true, headerIds: true, mangle: false });

const navLinks = (currentSlug) =>
    [...PAGES, ...EXTRA_NAV]
        .map(
            (p) =>
                `<a class="navbar-item${p.slug === currentSlug ? " is-active" : ""}" href="${p.slug}.html">${p.navLabel}</a>`
        )
        .join("\n            ");

const pageShell = ({ title, slug, bodyHtml }) => `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title} — Full Thrust Game Viewer</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bulma@0.9.4/css/bulma.min.css">
    <style>
        .doc-body { max-width: 48rem; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
        .doc-body pre { overflow-x: auto; padding: 0.75rem; background: #f5f5f5; border-radius: 4px; }
        .doc-body code { background: #f5f5f5; padding: 0.1em 0.25em; border-radius: 3px; }
        .doc-body pre code { background: transparent; padding: 0; }
    </style>
</head>
<body>
    <nav class="navbar" aria-label="Documentation">
        <div class="navbar-brand">
            <a class="navbar-item" href="index.html"><strong>Documentation</strong></a>
        </div>
        <div class="navbar-menu is-active">
            <div class="navbar-start">
            ${navLinks(slug)}
            </div>
            <div class="navbar-end">
                <a class="navbar-item" href="../index.html">Back to app</a>
            </div>
        </div>
    </nav>
    <article class="content doc-body">
        ${bodyHtml}
    </article>
</body>
</html>
`;

const indexShell = () => `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Documentation — Full Thrust Game Viewer</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bulma@0.9.4/css/bulma.min.css">
    <style>
        .doc-index { max-width: 36rem; margin: 2rem auto; padding: 0 1rem; }
    </style>
</head>
<body>
    <nav class="navbar" aria-label="Documentation">
        <div class="navbar-brand">
            <a class="navbar-item is-active" href="index.html"><strong>Documentation</strong></a>
        </div>
        <div class="navbar-end">
            <a class="navbar-item" href="../index.html">Back to app</a>
        </div>
    </nav>
    <div class="doc-index content">
        <h1>Full Thrust Game Viewer</h1>
        <p>Guides for playing, moderating, developing, and dice trust.</p>
        <ul>
            ${[...PAGES, ...EXTRA_NAV].map((p) => `<li><a href="${p.slug}.html">${p.navLabel}</a></li>`).join("\n            ")}
        </ul>
    </div>
</body>
</html>
`;

mkdirSync(outDir, { recursive: true });

for (const page of PAGES) {
    const md = readFileSync(join(docsDir, page.file), "utf8");
    const bodyHtml = marked.parse(md);
    const titleMatch = md.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1] : page.navLabel;
    writeFileSync(join(outDir, `${page.slug}.html`), pageShell({ title, slug: page.slug, bodyHtml }));
    console.log(`Wrote ${page.slug}.html`);
}

writeFileSync(join(outDir, "index.html"), indexShell());
console.log(`Wrote index.html → ${outDir}`);
