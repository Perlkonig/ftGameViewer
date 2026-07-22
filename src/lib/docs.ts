/** Static documentation pages (built from docs/*.md on dev/build). */

export const DOC_PAGES = [
    { slug: "players", label: "Player" },
    { slug: "moderators", label: "Moderator" },
    { slug: "developers", label: "Developer" },
    { slug: "dice", label: "Dice" },
] as const;

const base = import.meta.env.BASE_URL;

export const docsIndexUrl = `${base}docs/index.html`;

export const docsPageUrl = (slug: string): string => `${base}docs/${slug}.html`;
