/* Task 046 A3: a whiteboard also holds sticky notes and plain text beside its task cards. Both carry text that is
   kept as typed, a place and a size; a note also has a tone, one of a fixed list of names. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { schema } = require('../utils/mongo-handler/schema');
const rules = require('../Modules/Whiteboards/boardRules');
const store = require('../Modules/Whiteboards/boardStore');

const {
    BoardRefused, MAX_ELEMENTS, MAX_NOTES, MAX_TEXT_LENGTH, MAX_SCENE_BYTES, MIN_WIDTH, MAX_WIDTH, MIN_HEIGHT, MAX_HEIGHT, NOTE_TONES,
    parsePatch, applyPatch,
} = rules;

const C = '6f0000000000000000000c01';
const ANA = '6f0000000000000000000001';
const BEN = '6f0000000000000000000002';
const PROJECT = '6f0000000000000000000a01';
const LIST = '6f0000000000000000000b01';
const T1 = '6f0000000000000000000d01';
const T2 = '6f0000000000000000000d02';
const MARKUP = '<img src=x onerror=alert(1)>\n<b>bold</b> & "quotes"';

const card = (id, taskId, x = 10, y = 20) => ({ id, type: 'task', taskId, x, y });
const note = (id, text = 'Ask finance', extra = {}) => ({ id, type: 'note', text, tone: 'amber', x: 30, y: 40, w: 180, h: 120, ...extra });
const label = (id, text = 'Q4 plan', extra = {}) => ({ id, type: 'text', text, x: 50, y: 60, w: 220, h: 40, ...extra });
const key = { companyId: C, projectId: PROJECT, sprintId: LIST };
const save = (uid, patch, options = {}) => store.saveBoard({ ...key, uid, patch: parsePatch(patch), ...options });
const boards = () => mockDb.store[SCHEMA_TYPE.WHITEBOARDS] || [];
const refusal = (fn) => {
    try { fn(); } catch (error) { if (error instanceof BoardRefused) return error.field; throw error; }
    return null;
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    [T1, T2].forEach((_id) => mockDb.seed(SCHEMA_TYPE.TASKS, { _id, ProjectID: PROJECT, sprintId: LIST, TaskName: `Task ${_id.slice(-1)}`, deletedStatusKey: 0 }));
});

describe('what a note and a text may carry', () => {
    it('takes a note with its text as typed, a tone, a place and a size', () => {
        const [parsed] = parsePatch({ baseRevision: 0, upsert: [note('n1', '  two\n lines  ', { x: 30.4, y: 40.6, w: 180.2, h: 119.7, z: 3 })] }).upsert;
        expect(parsed).toEqual({ id: 'n1', type: 'note', text: '  two\n lines  ', tone: 'amber', x: 30, y: 41, w: 180, h: 120, z: 3 });
    });

    it('takes a text with no tone', () => {
        const [parsed] = parsePatch({ baseRevision: 0, upsert: [label('x1')] }).upsert;
        expect(parsed).toEqual({ id: 'x1', type: 'text', text: 'Q4 plan', x: 50, y: 60, w: 220, h: 40, z: 0 });
    });

    it('keeps markup, quotes and line breaks exactly as typed, and takes an empty note', () => {
        expect(parsePatch({ baseRevision: 0, upsert: [note('n1', MARKUP)] }).upsert[0].text).toBe(MARKUP);
        expect(parsePatch({ baseRevision: 0, upsert: [note('n1', '')] }).upsert[0].text).toBe('');
        expect(parsePatch({ baseRevision: 0, upsert: [note('n1', 'x'.repeat(MAX_TEXT_LENGTH))] }).upsert[0].text).toHaveLength(MAX_TEXT_LENGTH);
    });

    it('offers a fixed list of tones', () => {
        expect(NOTE_TONES).toEqual(['amber', 'green', 'red', 'violet', 'brand', 'grey']);
        NOTE_TONES.forEach((tone) => expect(parsePatch({ baseRevision: 0, upsert: [note('n1', 'a', { tone })] }).upsert[0].tone).toBe(tone));
    });

    it.each([
        ['upsert.text', note('n1', 'x'.repeat(MAX_TEXT_LENGTH + 1))],
        ['upsert.text', note('n1', 7)],
        ['upsert.text', note('n1', ['a'])],
        ['upsert.text', { id: 'n1', type: 'note', tone: 'amber', x: 1, y: 1, w: 180, h: 120 }],
        ['upsert.tone', note('n1', 'a', { tone: '#ff0000' })],
        ['upsert.tone', note('n1', 'a', { tone: 'var(--danger)' })],
        ['upsert.tone', note('n1', 'a', { tone: 'Amber' })],
        ['upsert.tone', { id: 'n1', type: 'note', text: 'a', x: 1, y: 1, w: 180, h: 120 }],
        ['upsert.tone', label('x1', 'a', { tone: 'amber' })],
        ['upsert.w', note('n1', 'a', { w: MIN_WIDTH - 1 })],
        ['upsert.w', note('n1', 'a', { w: MAX_WIDTH + 1 })],
        ['upsert.w', note('n1', 'a', { w: '180' })],
        ['upsert.h', note('n1', 'a', { h: MIN_HEIGHT - 1 })],
        ['upsert.h', label('x1', 'a', { h: MAX_HEIGHT + 1 })],
        ['upsert.h', { id: 'x1', type: 'text', text: 'a', x: 1, y: 1, w: 220 }],
        ['upsert.x', note('n1', 'a', { x: -5 })],
        ['upsert.taskId', note('n1', 'a', { taskId: T1 })],
        ['upsert.color', note('n1', 'a', { color: 'red' })],
        ['upsert.style', note('n1', 'a', { style: 'background:url(x)' })],
        ['upsert.html', label('x1', 'a', { html: '<b>a</b>' })],
        ['upsert.src', label('x1', 'a', { src: 'data:image/png;base64,AAAA' })],
        ['upsert.w', { ...card('a', T1), w: 180 }],
        ['upsert.text', { ...card('a', T1), text: 'a' }],
        ['upsert.type', note('n1', 'a', { type: 'shape' })],
    ])('refuses a bad %s', (field, element) => {
        expect(refusal(() => parsePatch({ baseRevision: 0, upsert: [element] }))).toBe(field);
    });

    it('answers each of those with 400', () => {
        let caught;
        try { parsePatch({ baseRevision: 0, upsert: [note('n1', 'a', { tone: 'teal' })] }); } catch (error) { caught = error; }
        expect(caught.statusCode).toBe(400);
    });

    it('says its limits', () => {
        expect({ MAX_ELEMENTS, MAX_NOTES, MAX_TEXT_LENGTH, MAX_SCENE_BYTES, MIN_WIDTH, MAX_WIDTH, MIN_HEIGHT, MAX_HEIGHT }).toEqual({
            MAX_ELEMENTS: 2000, MAX_NOTES: 500, MAX_TEXT_LENGTH: 2000, MAX_SCENE_BYTES: 512 * 1024, MIN_WIDTH: 40, MAX_WIDTH: 1200, MIN_HEIGHT: 24, MAX_HEIGHT: 1200,
        });
    });

    it('counts notes and text in one save apart from the task cards', () => {
        const many = (n, make) => Array.from({ length: n }, (_, i) => make(`e${i}`));
        expect(refusal(() => parsePatch({ baseRevision: 0, upsert: many(MAX_NOTES + 1, (id) => note(id, '')) }))).toBe('upsert');
        expect(parsePatch({ baseRevision: 0, upsert: many(MAX_NOTES, (id) => label(id, '')) }).upsert).toHaveLength(MAX_NOTES);
    });
});

describe('applying a save that holds notes', () => {
    const scene = [
        { id: 'a', type: 'task', taskId: T1, x: 1, y: 1, z: 0 },
        { id: 'n1', type: 'note', text: 'old', tone: 'amber', x: 30, y: 40, w: 180, h: 120, z: 1 },
    ];
    const patched = (patch) => applyPatch(scene, parsePatch({ baseRevision: 1, ...patch }));

    it('adds a note, and edits, moves, resizes and recolours one as a whole', () => {
        expect(patched({ upsert: [label('x1')] })).toEqual([...scene, { id: 'x1', type: 'text', text: 'Q4 plan', x: 50, y: 60, w: 220, h: 40, z: 0 }]);
        const [, edited] = patched({ upsert: [note('n1', 'new text', { tone: 'green', x: 300, y: 400, w: 240, h: 160, z: 4 })] });
        expect(edited).toEqual({ id: 'n1', type: 'note', text: 'new text', tone: 'green', x: 300, y: 400, w: 240, h: 160, z: 4 });
    });

    it('takes a note off by its id and leaves the task cards alone', () => {
        expect(patched({ remove: ['n1'] })).toEqual([scene[0]]);
    });

    it('keeps the kind of an element: an id cannot turn from a card into a note or back', () => {
        expect(refusal(() => patched({ upsert: [note('a', 'now a note')] }))).toBe('upsert.type');
        expect(refusal(() => patched({ upsert: [card('n1', T2)] }))).toBe('upsert.type');
        expect(refusal(() => patched({ upsert: [label('n1', 'now plain text')] }))).toBe('upsert.type');
    });

    it('holds notes and text to their own cap, whatever room the task cards have left', () => {
        const full = Array.from({ length: MAX_NOTES }, (_, n) => ({ id: `n${n}`, type: n % 2 ? 'note' : 'text', text: '', ...(n % 2 ? { tone: 'grey' } : {}), x: 0, y: 0, w: 100, h: 40, z: 0 }));
        expect(refusal(() => applyPatch(full, parsePatch({ baseRevision: 1, upsert: [note('one-more')] })))).toBe('upsert');
        expect(applyPatch(full, parsePatch({ baseRevision: 1, upsert: [card('a', T1)] }))).toHaveLength(MAX_NOTES + 1);
        expect(applyPatch(full, parsePatch({ baseRevision: 1, upsert: [note('one-more')], remove: ['n0'] }))).toHaveLength(MAX_NOTES);
    });

    it('refuses a save that would make the whole board larger than it may be kept', () => {
        const wordy = (n) => ({ id: `n${n}`, type: 'note', text: 'é'.repeat(MAX_TEXT_LENGTH), tone: 'amber', x: 0, y: 0, w: 100, h: 40, z: 0 });
        const heavy = Array.from({ length: Math.floor(MAX_SCENE_BYTES / (MAX_TEXT_LENGTH * 2 + 100)) }, (_, n) => wordy(n));
        expect(Buffer.byteLength(JSON.stringify(heavy))).toBeLessThanOrEqual(MAX_SCENE_BYTES);
        let caught;
        try { applyPatch(heavy, parsePatch({ baseRevision: 1, upsert: [wordy('x'), wordy('y'), wordy('z')] })); } catch (error) { caught = error; }
        expect(caught).toBeInstanceOf(BoardRefused);
        expect({ field: caught.field, statusCode: caught.statusCode }).toEqual({ field: 'upsert', statusCode: 413 });
    });
});

describe('notes on a saved board', () => {
    const at = (minutes) => new Date(Date.UTC(2026, 9, 1, 10, minutes));

    it('are stored as sent beside the cards, and need no task', async () => {
        const { board } = await save(ANA, { baseRevision: 0, upsert: [note('n1', MARKUP), label('x1'), card('a', T1)] });
        expect(board.revision).toBe(1);
        expect(boards()[0].elements).toEqual([
            { id: 'n1', type: 'note', text: MARKUP, tone: 'amber', x: 30, y: 40, w: 180, h: 120, z: 0 },
            { id: 'x1', type: 'text', text: 'Q4 plan', x: 50, y: 60, w: 220, h: 40, z: 0 },
            { id: 'a', type: 'task', taskId: T1, x: 10, y: 20, z: 0 },
        ]);
    });

    it('make a board on their own, with no card on it', async () => {
        const { board } = await save(ANA, { baseRevision: 0, upsert: [note('n1')] });
        expect(board.elements.map((element) => element.id)).toEqual(['n1']);
    });

    it('stay when a card beside them is dropped because its task left the list or the writer may not open it', async () => {
        await save(ANA, { baseRevision: 0, upsert: [note('n1'), card('a', T1), card('b', T2)] });
        mockDb.store[SCHEMA_TYPE.TASKS].find((task) => task._id === T2).deletedStatusKey = 1;
        const { board } = await save(BEN, { baseRevision: 1, upsert: [label('x1')] }, { admits: () => false });
        expect(board.elements.map((element) => element.id)).toEqual(['n1', 'a', 'x1']);
    });

    it('are edited and deleted through the same save, each on the revision it was made on', async () => {
        await save(ANA, { baseRevision: 0, upsert: [note('n1', 'first'), note('n2', 'second')] });
        const edited = await save(BEN, { baseRevision: 1, upsert: [note('n1', 'first, edited')], remove: ['n2'] });
        expect(edited.board.elements).toEqual([{ id: 'n1', type: 'note', text: 'first, edited', tone: 'amber', x: 30, y: 40, w: 180, h: 120, z: 0 }]);
        const stale = await save(ANA, { baseRevision: 1, upsert: [note('n1', 'first, mine')] });
        expect(stale).toMatchObject({ conflict: true, board: { revision: 2 } });
        expect(boards()[0].elements[0].text).toBe('first, edited');
    });

    it('are in the earlier states and come back on a restore, with their text', async () => {
        await save(ANA, { baseRevision: 0, upsert: [note('n1', 'before'), card('a', T1)] }, { now: at(0) });
        await save(BEN, { baseRevision: 1, upsert: [note('n1', 'after')], remove: ['a'] }, { now: at(1) });
        expect(await store.listHistory(C, PROJECT, LIST)).toEqual([{ revision: 1, savedBy: ANA, savedAt: at(0), cards: 2, reason: 'author' }]);

        mockDb.store[SCHEMA_TYPE.TASKS].find((task) => task._id === T1).deletedStatusKey = 1;
        const restored = await store.restoreBoard({ ...key, uid: ANA, revision: 1, now: at(2) });
        expect(restored.board.elements).toEqual([{ id: 'n1', type: 'note', text: 'before', tone: 'amber', x: 30, y: 40, w: 180, h: 120, z: 0 }]);
    });

    it('are kept whole by the strict schema', async () => {
        await save(ANA, { baseRevision: 0, upsert: [note('n1', MARKUP), label('x1')] });
        await save(BEN, { baseRevision: 1, upsert: [note('n1', 'changed')] });
        const [doc] = boards();
        const Model = mongoose.models.WhiteboardNoteShape || mongoose.model('WhiteboardNoteShape', new mongoose.Schema(schema.whiteboards, { strict: true }));
        const kept = new Model(doc).toObject();
        expect(kept.elements).toEqual(doc.elements);
        expect(kept.history[0].elements[0].text).toBe(MARKUP);
    });
});
