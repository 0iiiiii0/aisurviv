#!/usr/bin/env node
/**
 * Generates client/public/news.json from the newest five changelog entries.
 *
 * The What's New! panel on the lobby renders these entries automatically;
 * run this after every change (the client build script runs it for you).
 * Only "important" changelogs (V*_CHANGELOG.md) are considered.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const changelogsDir = path.join(root, "docs", "changelogs");
const outFile = path.join(root, "client", "public", "news.json");
const COUNT = 5;

if (!fs.existsSync(changelogsDir)) {
    console.error(`Changelog directory not found: ${changelogsDir}`);
    process.exit(1);
}

const files = fs
    .readdirSync(changelogsDir)
    .filter((name) => /^V\d+_CHANGELOG\.md$/i.test(name))
    .sort((a, b) => {
        const va = Number.parseInt(a.match(/\d+/)?.[0] ?? "0", 10);
        const vb = Number.parseInt(b.match(/\d+/)?.[0] ?? "0", 10);
        return vb - va;
    });

const items = files.slice(0, COUNT).map((file) => {
    const fullPath = path.join(changelogsDir, file);
    const content = fs.readFileSync(fullPath, "utf8");
    const lines = content.split(/\r?\n/);

    let title = file.replace(/_CHANGELOG\.md$/i, "");
    const summaryLines = [];
    let inHeading = false;
    let inSection = false;

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!inHeading) {
            if (line.startsWith("# ")) {
                inHeading = true;
                title = line.replace(/^#\s+/, "").trim() || title;
            }
            continue;
        }
        if (line.startsWith("## ")) {
            if (inSection) break;
            inSection = true;
            continue;
        }
        if (line.startsWith("#") || !line) continue;
        summaryLines.push(line.replace(/^[-*]\s*/, ""));
        if (summaryLines.length >= 3) break;
    }

    const stat = fs.statSync(fullPath);
    return {
        version: file.replace(/_CHANGELOG\.md$/i, ""),
        title,
        summary: summaryLines.join(" ").slice(0, 160),
        date: stat.mtime.toISOString().slice(0, 10),
    };
});

const payload = {
    generatedAt: new Date().toISOString(),
    items,
};

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`Generated ${outFile} with ${items.length} news item(s).`);
