const fs = require("fs");
const path = require("path");
const axios = require("axios");
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

// What a release means for whoever runs their own install. release-please
// only emits the fixed sections in release-please-config.json, so the note is
// read from two places a commit author can already write it into: a section
// whose title says so ("BREAKING CHANGES", "Self-hosting", "Upgrade notes"),
// or a bullet scoped that way ("**self-host:** ...", "**migration:** ...",
// "**env:** ..."). Either one marks the release as needing attention on upgrade.
const SELF_HOST_SECTION = /breaking|self-?host|upgrade|migration|deploy/i;
const SELF_HOST_SCOPE = /^(?:<strong>)?(self-?host|selfhost|migration|migrate|env|upgrade|deploy|infra|breaking)\b/i;
const UPGRADE_HINT = /migration|migrate|restart|\.env\b|env var|environment variable|breaking|re-?index|npm install|reinstall/i;

const stripTags = (html) => String(html || "").replace(/<[^>]+>/g, "");

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
            const html = inlineMarkdownToHtml(bulletMatch[1]);
            section.items.push({ html, selfHost: SELF_HOST_SECTION.test(section.title) || SELF_HOST_SCOPE.test(html) });
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
// Pull the self-hoster's notes out of a parsed release and decide whether the
// upgrade needs a hand (a migration, a restart, an env change) or is a plain
// pull-and-restart.
const withSelfHost = (release) => {
    const notes = [];
    release.sections.forEach((section) => {
        section.items.forEach((item) => { if (item.selfHost) notes.push(item.html); });
    });
    const text = notes.map(stripTags).join(" ");
    return {
        ...release,
        selfHost: {
            notes,
            upgradeNeeded: notes.length > 0 && UPGRADE_HINT.test(text),
            breaking: release.sections.some((section) => /breaking/i.test(section.title)),
        },
    };
};

const deriveRepoUrl = (releases) => {
    const withUrl = releases.find((item) => item.compareUrl);
    return withUrl ? withUrl.compareUrl.split("/compare/")[0] : "";
};

// CHANGELOG.md only records a date, so the exact publish moment comes from
// the GitHub Releases API. Cached per changelog revision (a new release
// rewrites the file, so each release costs one fetch); a failed fetch backs
// off for ten minutes and the page degrades to date-only display.
const GITHUB_RETRY_MS = 10 * 60 * 1000;
let githubTimes = { key: null, byVersion: null, retryAtMs: 0 };

const fetchReleaseTimes = async (repoUrl, cacheKey) => {
    if (githubTimes.byVersion && githubTimes.key === cacheKey) return githubTimes.byVersion;
    if (Date.now() < githubTimes.retryAtMs) return githubTimes.byVersion || {};
    const repoMatch = String(repoUrl || "").match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!repoMatch) return {};
    try {
        const response = await axios.get(`https://api.github.com/repos/${repoMatch[1]}/${repoMatch[2]}/releases`, {
            params: { per_page: 100 },
            timeout: 8000,
            headers: {
                Accept: "application/vnd.github+json",
                "User-Agent": "AlianHub-Changelog",
                ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
            },
        });
        const byVersion = {};
        (Array.isArray(response.data) ? response.data : []).forEach((release) => {
            if (release.tag_name && release.published_at) {
                byVersion[String(release.tag_name).replace(/^v/, "")] = release.published_at;
            }
        });
        githubTimes = { key: cacheKey, byVersion, retryAtMs: 0 };
        return byVersion;
    } catch (fetchError) {
        logger.error(`Changelog release times fetch failed: ${fetchError.message}`);
        githubTimes = { ...githubTimes, retryAtMs: Date.now() + GITHUB_RETRY_MS };
        return githubTimes.byVersion || {};
    }
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
            const releases = parseChangelog(markdown).map(withSelfHost);
            cache = {
                mtimeMs: stats.mtimeMs,
                payload: {
                    currentVersion: appVersion,
                    latestVersion: releases.length ? releases[0].version : appVersion,
                    repoUrl: deriveRepoUrl(releases),
                    releases,
                },
            };
        }

        const releaseTimes = await fetchReleaseTimes(cache.payload.repoUrl, stats.mtimeMs);
        const releases = cache.payload.releases.map((release) => ({
            ...release,
            publishedAt: releaseTimes[release.version] || "",
        }));

        return res.send({ status: true, statusText: "Changelog fetched.", data: { ...cache.payload, releases } });
    } catch (error) {
        logger.error(`ERROR in get changelog: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};
