'use strict';

const crypto = require('crypto');
const { contentToEditorData, blocksToRawText } = require('./pageContent');
const { normalizeBlockMentions } = require('./pageMentions');

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/* A version is the state a save is about to replace, kept under the time it was written and the person who wrote
 * it. It is kept when someone else wrote that state, or when the last version was kept longer ago than the interval;
 * saves in between change the doc only. The removed history kept the outgoing body under the incoming save's time and
 * author, which put every entry one save behind its label. */
const VERSION_INTERVAL_MS = 10 * MINUTE;

/* Unnamed versions thin with age: every one from the last day, then the newest of each day for thirty days, then
 * the newest of each week. Named versions are never thinned, so they are capped by count instead. */
const KEEP_ALL_MS = DAY;
const KEEP_DAILY_MS = 30 * DAY;
const MAX_UNNAMED_VERSIONS = 100;
const MAX_NAMED_VERSIONS = 30;
const MAX_VERSION_BYTES = 32 * 1024 * 1024;
const MAX_NAME_LENGTH = 80;

const REASONS = Object.freeze(['author', 'interval', 'restore', 'manual']);
const LEGACY = 'legacy';

const plain = (row) => (row && typeof row.toObject === 'function' ? row.toObject() : { ...(row || {}) });

const asDate = (value) => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

/* A row the removed history wrote carries neither a reason nor a visibility mark. Those rows stop at the commit
 * that introduced private docs, so each one dates from a time its doc was readable by the whole project. */
const isLegacy = (version) => !version || (!version.reason && !version.visibility);

const timeOf = (version) => asDate(version && (version.savedAt || version.createdAt));
const keptAt = (version) => asDate(version && (version.createdAt || version.savedAt));

/* A doc written before history came back has no editedBy: its last save stands in. */
const writerOf = (page) => String((page && (page.editedBy || page.updatedBy || page.createdBy)) || '');
const writtenAt = (page) => asDate(page && (page.editedAt || page.updatedAt || page.createdAt));

const blocksOf = (content) => {
    const { blocks } = contentToEditorData(content || {});
    return normalizeBlockMentions(Array.isArray(blocks) ? blocks : []);
};

const hashOf = (title, blocks) => crypto.createHash('sha256').update(`${title}\n${JSON.stringify(blocks)}`).digest('hex');

const snapshotOf = (page) => {
    const title = String((page && page.title) || '');
    const blocks = blocksOf(page && page.content);
    return {
        title,
        blocks,
        rawText: blocksToRawText(blocks),
        hash: hashOf(title, blocks),
        size: Buffer.byteLength(JSON.stringify(blocks), 'utf8') + Buffer.byteLength(title, 'utf8'),
    };
};

const markOf = (page) => (String((page && page.visibility) || '') === 'private' ? 'private' : 'project');
const markOfVersion = (version) => (isLegacy(version) || version.visibility === 'project' ? 'project' : 'private');

/* The last version already holds this state for everyone who can read the doc now: one kept while the doc was
 * private does not stand in once the doc is shared. */
const heldBy = (latest, state, mark) => Boolean(latest) && latest.hash === state.hash
    && (markOfVersion(latest) === 'project' || mark === 'private');

/* A blank doc is not worth a version, and neither is a state the last version already holds. */
const worthKeeping = (state, latest, mark) => state.blocks.length > 0 && !heldBy(latest, state, mark);

/* Why the doc's current state is kept before `editorId` replaces it, or '' when it is not. */
const reasonToKeep = ({ page, editorId, latest, now = new Date(), state = snapshotOf(page) }) => {
    if (!worthKeeping(state, latest, markOf(page))) return '';
    if (writerOf(page) !== String(editorId || '')) return 'author';
    const since = latest ? keptAt(latest) : asDate(page.createdAt);
    return !since || now.getTime() - since.getTime() > VERSION_INTERVAL_MS ? 'interval' : '';
};

const dayOf = (date) => Math.floor(date.getTime() / DAY);
/* Day 0 of the epoch was a Thursday; the shift starts each week on Monday. */
const weekOf = (date) => Math.floor((dayOf(date) + 3) / 7);

const bucketOf = (at, now) => {
    const age = now.getTime() - at.getTime();
    if (age <= KEEP_ALL_MS) return '';
    return age <= KEEP_DAILY_MS ? `d${dayOf(at)}` : `w${weekOf(at)}`;
};

const versionsToDrop = (rows, now = new Date()) => {
    const ours = (rows || []).filter((row) => row && !isLegacy(row));
    const newestFirst = (a, b) => (timeOf(b) || 0) - (timeOf(a) || 0);
    const kept = [];
    const dropped = [];
    const taken = new Set();
    ours.filter((row) => !row.name).sort(newestFirst).forEach((row) => {
        const bucket = bucketOf(timeOf(row) || now, now);
        if (bucket && taken.has(bucket)) {
            dropped.push(row);
            return;
        }
        if (bucket) taken.add(bucket);
        kept.push(row);
    });
    dropped.push(...kept.splice(MAX_UNNAMED_VERSIONS));
    const sizeOf = (row) => Number(row.size) || 0;
    let bytes = [...kept, ...ours.filter((row) => row.name)].reduce((sum, row) => sum + sizeOf(row), 0);
    while (bytes > MAX_VERSION_BYTES && kept.length) {
        const oldest = kept.pop();
        bytes -= sizeOf(oldest);
        dropped.push(oldest);
    }
    return dropped.map((row) => row._id);
};

/* History never shows what the viewer could not read in the doc itself: a version kept while the doc was private
 * stays its author's alone after the doc is shared, and a mark that is not 'project' reads as private. */
const versionVisibleTo = (version, page, uid) => {
    if (!version || !page) return false;
    if (markOfVersion(version) === 'project') return true;
    return Boolean(uid) && String(page.createdBy || '') === String(uid);
};

const readName = (value) => {
    if (value === undefined || value === null) return { name: '' };
    if (typeof value !== 'string') return { reason: 'A version name must be text.' };
    const name = value.replace(/\s+/g, ' ').trim();
    if (name.length > MAX_NAME_LENGTH) return { reason: `A version name can be up to ${MAX_NAME_LENGTH} characters.` };
    return { name };
};

const versionRow = (version) => {
    const row = plain(version);
    const legacy = isLegacy(row);
    return {
        _id: String(row._id),
        pageId: String(row.pageId || ''),
        title: String(row.title || ''),
        name: String(row.name || ''),
        reason: legacy ? LEGACY : String(row.reason),
        savedBy: String(row.savedBy || ''),
        savedAt: timeOf(row),
        visibility: markOfVersion(row),
    };
};

const versionBody = (version) => {
    const row = plain(version);
    const blocks = blocksOf(row.content);
    return { ...versionRow(row), blocks, rawText: blocksToRawText(blocks) };
};

module.exports = {
    VERSION_INTERVAL_MS,
    KEEP_ALL_MS,
    KEEP_DAILY_MS,
    MAX_UNNAMED_VERSIONS,
    MAX_NAMED_VERSIONS,
    MAX_VERSION_BYTES,
    MAX_NAME_LENGTH,
    REASONS,
    isLegacy,
    timeOf,
    writerOf,
    writtenAt,
    blocksOf,
    snapshotOf,
    markOf,
    heldBy,
    worthKeeping,
    reasonToKeep,
    versionsToDrop,
    versionVisibleTo,
    readName,
    versionRow,
    versionBody,
};
