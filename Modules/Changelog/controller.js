const fs = require("fs");
const path = require("path");
const logger = require("../../Config/loggerConfig");
const { version: appVersion } = require("../../package.json");

// Serves the repo-root CHANGELOG.md (maintained by release-please) as
// structured JSON for the in-app "What's New" page. The parsed result is
// cached and invalidated by the file's mtime, so every new release that
// rewrites CHANGELOG.md is picked up automatically without a restart.

const CHANGELOG_PATH = path.join(__dirname, "..", "..", "CHANGELOG.md");

// e.g. "## [14.2.0](https://...) (2026-06-10)", "## [14.0.26] — note", "## 14.0.26 (2026-06-10)"
const RELEASE_HEADING = /^##\s+(?:\[v?([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\[v?([^\]]+)\]|v?(\d+\.\d+[^\s]*))\s*(.*)$/;
const SECTION_HEADING = /^###\s+(.+)$/;
const BULLET_ITEM = /^\s*[*-]\s+(.+)$/;
const ISO_DATE = /\((\d{4}-\d{2}-\d{2})\)/;

let cache = { mtimeMs: 0, payload: null };

const escapeHtml = (text) => String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Renders the small markdown subset release-please emits (links, bold,
// inline code) into safe HTML: text is escaped first and only absolute
// http(s) URLs become anchors.
const inlineMarkdownToHtml = (text) => {
    let html = escapeHtml(text.trim());
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    return html;
};

const parseChangelog = (markdown) => {
    const releases = [];
    let release = null;
    let section = null;
    let noteOpen = false; // previous line continued a notes paragraph

    for (const line of markdown.split(/\r?\n/)) {
        const releaseMatch = line.match(RELEASE_HEADING);
        if (releaseMatch) {
            const rest = (releaseMatch[5] || "").trim();
            const dateMatch = rest.match(ISO_DATE);
            release = {
                version: (releaseMatch[1] || releaseMatch[3] || releaseMatch[4] || "").trim(),
                compareUrl: releaseMatch[2] || "",
                date: dateMatch ? dateMatch[1] : "",
                label: rest.replace(ISO_DATE, "").replace(/^[\s—–-]+|[\s—–-]+$/g, ""),
                notes: [],
                sections: [],
            };
            section = null;
            noteOpen = false;
            releases.push(release);
            continue;
        }
        if (!release) continue; // preamble above the first release

        const sectionMatch = line.match(SECTION_HEADING);
        if (sectionMatch) {
            section = { title: sectionMatch[1].trim(), items: [] };
            release.sections.push(section);
            noteOpen = false;
            continue;
        }

        if (/^-{3,}\s*$/.test(line)) continue;

        const bulletMatch = line.match(BULLET_ITEM);
        if (bulletMatch) {
            if (!section) {
                section = { title: "", items: [] };
                release.sections.push(section);
            }
            section.items.push({ html: inlineMarkdownToHtml(bulletMatch[1]) });
            noteOpen = false;
            continue;
        }

        if (!line.trim()) {
            noteOpen = false;
            continue;
        }

        if (section && section.items.length) {
            // wrapped continuation of the previous bullet
            const item = section.items[section.items.length - 1];
            item.html += ` ${inlineMarkdownToHtml(line)}`;
        } else if (noteOpen && release.notes.length) {
            // wrapped continuation of a notes paragraph
            release.notes[release.notes.length - 1] += ` ${inlineMarkdownToHtml(line)}`;
        } else {
            // free-form paragraph inside a release (e.g. the baseline note)
            release.notes.push(inlineMarkdownToHtml(line));
            noteOpen = true;
        }
    }
    return releases;
};

// "https://github.com/<org>/<repo>/compare/..." -> "https://github.com/<org>/<repo>"
const deriveRepoUrl = (releases) => {
    const withUrl = releases.find((item) => item.compareUrl);
    return withUrl ? withUrl.compareUrl.split("/compare/")[0] : "";
};

/**
 * GET /api/v2/changelog
 * Returns every release documented in CHANGELOG.md (newest first, as
 * authored) along with the running app version.
 */
exports.getChangelog = async (req, res) => {
    try {
        let stats;
        try {
            stats = await fs.promises.stat(CHANGELOG_PATH);
        } catch (statError) {
            logger.error(`CHANGELOG.md not found at ${CHANGELOG_PATH}: ${statError.message}`);
            return res.send({
                status: true,
                statusText: "Changelog file not found.",
                data: { currentVersion: appVersion, repoUrl: "", releases: [] },
            });
        }

        if (!cache.payload || cache.mtimeMs !== stats.mtimeMs) {
            const markdown = await fs.promises.readFile(CHANGELOG_PATH, "utf8");
            const releases = parseChangelog(markdown);
            cache = {
                mtimeMs: stats.mtimeMs,
                payload: { currentVersion: appVersion, repoUrl: deriveRepoUrl(releases), releases },
            };
        }

        return res.send({ status: true, statusText: "Changelog fetched.", data: cache.payload });
    } catch (error) {
        logger.error(`ERROR in get changelog: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};
