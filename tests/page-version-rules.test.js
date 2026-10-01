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
    const latest = (over = {}) => ({ savedBy: ALICE, savedAt: ago(HOUR), createdAt: ago(8 * MINUTE), hash: 'other', ...over });

    it('is kept when someone else wrote it', () => {
        expect(rules.reasonToKeep({ page: page(), editorId: BOB, latest: latest(), now: NOW })).toBe('author');
    });

    it('is not kept when its own writer saves again within ten minutes of the last version', () => {
        expect(rules.reasonToKeep({ page: page(), editorId: ALICE, latest: latest(), now: NOW })).toBe('');
    });

    it('is kept once the last version was kept more than ten minutes ago', () => {
        expect(rules.VERSION_INTERVAL_MS).toBe(10 * MINUTE);
        expect(rules.reasonToKeep({ page: page(), editorId: ALICE, latest: latest({ createdAt: ago(11 * MINUTE) }), now: NOW })).toBe('interval');
    });

    it('measures from the creation of a doc that has no version yet', () => {
        expect(rules.reasonToKeep({ page: page({ createdAt: ago(4 * MINUTE) }), editorId: ALICE, latest: null, now: NOW })).toBe('');
        expect(rules.reasonToKeep({ page: page(), editorId: ALICE, latest: null, now: NOW })).toBe('interval');
    });

    it('is not kept when the doc is blank', () => {
        expect(rules.reasonToKeep({ page: page({ content: { blocks: [] } }), editorId: BOB, latest: null, now: NOW })).toBe('');
    });

    it('is not kept twice', () => {
        const same = latest({ hash: rules.snapshotOf(page()).hash, createdAt: ago(DAY) });
        expect(rules.reasonToKeep({ page: page(), editorId: BOB, latest: same, now: NOW })).toBe('');
    });

    it('reads who last saved a doc written before history came back', () => {
        const old = page({ editedBy: undefined, editedAt: undefined, updatedBy: BOB, updatedAt: ago(HOUR) });
        expect(rules.writerOf(old)).toBe(BOB);
        expect(rules.writtenAt(old)).toEqual(ago(HOUR));
        expect(rules.reasonToKeep({ page: old, editorId: ALICE, latest: null, now: NOW })).toBe('author');
    });
});

describe('how much of the outgoing text a save loses', () => {
    const blocks = (...texts) => texts.map((text, index) => para(`b${index}`, text));

    it('counts nothing for text that is only added', () => {
        expect(rules.lossOf(blocks('First draft'), blocks('First draft, with more'))).toEqual({ lost: 0, total: 11 });
        expect(rules.lossOf(blocks('One'), [...blocks('One'), para('new', 'Two')])).toEqual({ lost: 0, total: 3 });
    });

    it('counts the characters that are removed or written over inside a block', () => {
        expect(rules.lossOf(blocks('First draft'), blocks('Second draft'))).toEqual({ lost: 5, total: 11 });
        expect(rules.lossOf(blocks('The quick brown fox'), blocks('The brown fox'))).toEqual({ lost: 6, total: 19 });
    });

    it('counts a block that is gone whole, and a picture that is gone as more than a small edit', () => {
        expect(rules.lossOf(blocks('Keep me', 'Remove me'), blocks('Keep me'))).toEqual({ lost: 9, total: 16 });
        const picture = { id: 'pic', type: 'image', data: { key: 'docs/a.png' } };
        expect(rules.lossOf([para('a', 'Text'), picture], [para('a', 'Text')]).lost).toBe(rules.SMALL_EDIT_CHARS);
    });

    it('compares the whole text when the blocks carry no ids', () => {
        const bare = (...texts) => texts.map((text) => ({ type: 'paragraph', data: { text } }));
        expect(rules.lossOf(bare('First draft'), bare('Second draft'))).toEqual({ lost: 5, total: 11 });
    });

    it('calls an edit small when it loses fewer than twenty characters and less than a quarter of the text', () => {
        expect(rules.SMALL_EDIT_CHARS).toBe(20);
        expect(rules.isSmallEdit({ lost: 0, total: 0 })).toBe(true);
        expect(rules.isSmallEdit({ lost: 19, total: 400 })).toBe(true);
        expect(rules.isSmallEdit({ lost: 20, total: 400 })).toBe(false);
        expect(rules.isSmallEdit({ lost: 5, total: 11 })).toBe(false);
        expect(rules.isSmallEdit({ lost: 2, total: 9 })).toBe(true);
    });
});

describe('when a save loses text', () => {
    const LONG = 'The launch moves to the second week of March because the supplier contract is not signed yet.';
    const state = (...texts) => rules.snapshotOf({ title: 'Plan', content: { blocks: texts.map((text, index) => para(`b${index}`, text)) } });
    const doc = (texts, over = {}) => page({ content: { blocks: texts.map((text, index) => para(`b${index}`, text)) }, createdAt: ago(4 * MINUTE), editedAt: ago(MINUTE), ...over });
    const justKept = { savedBy: ALICE, savedAt: ago(3 * MINUTE), createdAt: ago(2 * MINUTE), hash: 'other', reason: 'interval', visibility: 'project' };

    it('keeps the first text of a new doc when its writer replaces it minutes later', () => {
        expect(rules.reasonToKeep({ page: doc(['First draft']), editorId: ALICE, latest: null, now: NOW, incoming: state('Second draft') })).toBe('rewrite');
    });

    it('keeps the text before a rewrite however recently a version was kept', () => {
        const incoming = state('The launch moves to April.');
        expect(rules.reasonToKeep({ page: doc([LONG]), editorId: ALICE, latest: justKept, now: NOW, incoming })).toBe('rewrite');
    });

    it('keeps what a save removes most of, whoever wrote it', () => {
        const incoming = state('Kept line');
        expect(rules.reasonToKeep({ page: doc(['Kept line', LONG]), editorId: ALICE, latest: justKept, now: NOW, incoming })).toBe('rewrite');
        expect(rules.reasonToKeep({ page: doc(['Kept line', LONG]), editorId: BOB, latest: justKept, now: NOW, incoming })).toBe('author');
    });

    it('still coalesces a run of small edits inside ten minutes', () => {
        const typo = state(LONG.replace('supplier', 'vendor'));
        const longer = state(`${LONG} Legal reviews it on Monday.`);
        expect(rules.reasonToKeep({ page: doc([LONG]), editorId: ALICE, latest: justKept, now: NOW, incoming: typo })).toBe('');
        expect(rules.reasonToKeep({ page: doc([LONG]), editorId: ALICE, latest: null, now: NOW, incoming: longer })).toBe('');
    });

    it('does not keep a state the last version already holds', () => {
        const page0 = doc(['First draft']);
        const held = { ...justKept, hash: rules.snapshotOf(page0).hash };
        expect(rules.reasonToKeep({ page: page0, editorId: ALICE, latest: held, now: NOW, incoming: state('Second draft') })).toBe('');
    });

    it('does not keep a blank doc', () => {
        expect(rules.reasonToKeep({ page: doc([]), editorId: ALICE, latest: null, now: NOW, incoming: state('First draft') })).toBe('');
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
