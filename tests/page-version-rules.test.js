const rules = require('../Modules/Pages/helpers/pageVersionRules');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = new Date('2026-10-01T12:00:00Z');
const ago = (ms) => new Date(NOW.getTime() - ms);

const ALICE = '6f0000000000000000000a01';
const BOB = '6f0000000000000000000a02';

const para = (id, text) => ({ id, type: 'paragraph', data: { text } });
const page = (over = {}) => ({
    _id: '6f0000000000000000000e01',
    title: 'Plan',
    content: { blocks: { time: 1, blocks: [para('a', 'One')], version: '2.30.7' } },
    createdBy: ALICE,
    createdAt: ago(2 * HOUR),
    editedBy: ALICE,
    editedAt: ago(5 * MINUTE),
    visibility: 'project',
    ...over,
});

describe('the state a version holds', () => {
    it('is the title, the blocks and the plain text, with a hash that ignores the editor clock', () => {
        const first = rules.snapshotOf(page());
        const later = rules.snapshotOf(page({ content: { blocks: { time: 999, blocks: [para('a', 'One')] } } }));

        expect(first).toMatchObject({ title: 'Plan', blocks: [para('a', 'One')], rawText: 'One' });
        expect(first.size).toBeGreaterThan(0);
        expect(later.hash).toBe(first.hash);
    });

    it('changes its hash with the title or any block', () => {
        const base = rules.snapshotOf(page()).hash;
        expect(rules.snapshotOf(page({ title: 'Plan B' })).hash).not.toBe(base);
        expect(rules.snapshotOf(page({ content: { blocks: [para('a', 'Two')] } })).hash).not.toBe(base);
    });

    it('reads a doc that only ever stored html', () => {
        expect(rules.snapshotOf(page({ content: { html: '<p>Old body</p>' } }))).toMatchObject({ rawText: 'Old body', blocks: [{ type: 'paragraph' }] });
    });
});

describe('when the outgoing state is kept', () => {
    const latest = (over = {}) => ({ savedBy: ALICE, savedAt: ago(8 * MINUTE), hash: 'other', ...over });

    it('is kept when someone else wrote it', () => {
        expect(rules.reasonToKeep({ page: page(), editorId: BOB, latest: latest(), now: NOW })).toBe('author');
    });

    it('is not kept when its own writer saves again within ten minutes of the last version', () => {
        expect(rules.reasonToKeep({ page: page(), editorId: ALICE, latest: latest(), now: NOW })).toBe('');
    });

    it('is kept once the last version is more than ten minutes old', () => {
        expect(rules.VERSION_INTERVAL_MS).toBe(10 * MINUTE);
        expect(rules.reasonToKeep({ page: page(), editorId: ALICE, latest: latest({ savedAt: ago(11 * MINUTE) }), now: NOW })).toBe('interval');
    });

    it('measures from the creation of a doc that has no version yet', () => {
        expect(rules.reasonToKeep({ page: page({ createdAt: ago(4 * MINUTE) }), editorId: ALICE, latest: null, now: NOW })).toBe('');
        expect(rules.reasonToKeep({ page: page(), editorId: ALICE, latest: null, now: NOW })).toBe('interval');
    });

    it('is not kept when the doc is blank', () => {
        expect(rules.reasonToKeep({ page: page({ content: { blocks: [] } }), editorId: BOB, latest: null, now: NOW })).toBe('');
    });

    it('is not kept twice', () => {
        const same = latest({ hash: rules.snapshotOf(page()).hash, savedAt: ago(DAY) });
        expect(rules.reasonToKeep({ page: page(), editorId: BOB, latest: same, now: NOW })).toBe('');
    });

    it('reads who last saved a doc written before history came back', () => {
        const old = page({ editedBy: undefined, editedAt: undefined, updatedBy: BOB, updatedAt: ago(HOUR) });
        expect(rules.writerOf(old)).toBe(BOB);
        expect(rules.writtenAt(old)).toEqual(ago(HOUR));
        expect(rules.reasonToKeep({ page: old, editorId: ALICE, latest: null, now: NOW })).toBe('author');
    });
});

describe('thinning', () => {
    let seq = 0;
    const row = (age, over = {}) => ({ _id: `v${seq += 1}`, reason: 'interval', savedAt: ago(age), size: 1000, ...over });
    const dropped = (rows) => rules.versionsToDrop(rows, NOW).map(String).sort();

    it('keeps every version of the last day', () => {
        const rows = [row(MINUTE), row(HOUR), row(5 * HOUR), row(23 * HOUR)];
        expect(dropped(rows)).toEqual([]);
    });

    it('keeps the newest of each day for thirty days', () => {
        const morning = row(3 * DAY + 2 * HOUR);
        const noon = row(3 * DAY);
        const dayBefore = row(4 * DAY);
        expect(dropped([noon, morning, dayBefore])).toEqual([String(morning._id)]);
    });

    it('keeps the newest of each week after that', () => {
        const saturday = row(40 * DAY);
        const friday = row(41 * DAY);
        const weekBefore = row(48 * DAY);
        expect(new Date(saturday.savedAt).getUTCDay()).toBe(6);
        expect(dropped([saturday, friday, weekBefore])).toEqual([String(friday._id)]);
    });

    it('never drops a named version or a row from the old history', () => {
        const named = [row(3 * DAY, { name: 'Signed off' }), row(3 * DAY + HOUR, { name: 'Draft' })];
        const legacy = [{ _id: 'old1', createdAt: ago(300 * DAY) }, { _id: 'old2', createdAt: ago(300 * DAY + HOUR) }];
        expect(dropped([...named, ...legacy])).toEqual([]);
    });

    it('caps the unnamed versions, oldest first', () => {
        const rows = Array.from({ length: rules.MAX_UNNAMED_VERSIONS + 3 }, (_, i) => row(i * MINUTE));
        const oldest = rows.slice(-3).map((r) => String(r._id)).sort();
        expect(dropped(rows)).toEqual(oldest);
    });

    it('caps the stored size by dropping the oldest unnamed versions', () => {
        const big = Math.floor(rules.MAX_VERSION_BYTES / 3) + 1;
        const rows = [row(MINUTE, { size: big }), row(2 * MINUTE, { size: big, name: 'Keep' }), row(3 * MINUTE, { size: big }), row(4 * MINUTE, { size: big })];
        expect(dropped(rows)).toEqual([String(rows[2]._id), String(rows[3]._id)].sort());
    });
});

describe('who sees a version', () => {
    const doc = page({ visibility: 'project' });

    it('shows a version from the doc’s shared time to every reader', () => {
        expect(rules.versionVisibleTo({ visibility: 'project' }, doc, BOB)).toBe(true);
    });

    it('shows a version from the doc’s private time to its author alone', () => {
        expect(rules.versionVisibleTo({ visibility: 'private' }, doc, BOB)).toBe(false);
        expect(rules.versionVisibleTo({ visibility: 'private' }, doc, ALICE)).toBe(true);
    });

    it('treats an unknown mark as private', () => {
        expect(rules.versionVisibleTo({ visibility: 'team', reason: 'interval' }, doc, BOB)).toBe(false);
        expect(rules.versionVisibleTo({ reason: 'interval' }, doc, BOB)).toBe(false);
    });

    it('shows a row from the old history, written before a doc could be private', () => {
        expect(rules.versionVisibleTo({ savedBy: ALICE }, doc, BOB)).toBe(true);
    });
});

describe('a version name', () => {
    it('is trimmed and may be cleared', () => {
        expect(rules.readName('  Signed off  ')).toEqual({ name: 'Signed off' });
        expect(rules.readName('')).toEqual({ name: '' });
        expect(rules.readName(undefined)).toEqual({ name: '' });
    });

    it('is text of a bounded length', () => {
        expect(rules.readName({ $gt: '' }).reason).toBeTruthy();
        expect(rules.readName('x'.repeat(rules.MAX_NAME_LENGTH + 1)).reason).toBeTruthy();
    });
});
