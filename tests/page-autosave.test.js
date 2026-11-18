const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Pages/helpers/pageAi', () => ({ composePage: jest.fn(), isAiConfigured: jest.fn(() => false) }));
jest.mock('../Config/contentAccess', () => ({
    projectAccess: jest.fn(async () => ({ visible: true, canEdit: true })),
    isCompanyMember: jest.fn(async () => true),
    isCompanyAdmin: jest.fn(async () => false),
    visibleProjectIds: jest.fn(async () => []),
}));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({
    handleSingleNotification: jest.fn(async () => []),
    handleNotificationtFun: jest.fn(async () => ({ status: true })),
}));

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { schema } = require('../utils/mongo-handler/schema');
const notices = require('../Modules/notification/prepare-notification-data/controllerV2');
const socketEmitter = require('../event/socketEventEmitter');
const { forgetHealedDocNotices } = require('../Modules/notification/docNotices');
const pages = require('../Modules/Pages/controller');
const history = require('../Modules/Pages/versions');
const pageSettle = require('../Modules/Pages/helpers/pageSettle');

const C = '6f00000000000000000000c1';
const PROJECT = '6f0000000000000000000a01';
const PAGE = '6f0000000000000000000e01';
const AUTHOR = '6f0000000000000000000001';
const ANN = '6f0000000000000000000002';
const BOB = '6f0000000000000000000003';
const SECOND = 1000;
const T0 = new Date('2026-10-01T09:00:00Z');

const mention = (id, label) => `<span class="mention" data-mention="user" data-id="${id}">${label}</span>`;
const para = (id, text) => ({ id, type: 'paragraph', data: { text } });
const draft = (...blocks) => ({
    contentBlocks: { time: 1, blocks, version: '2.30.7' },
    contentHtml: blocks.map((block) => `<p>${block.data.text}</p>`).join(''),
});

const response = () => {
    const res = { body: undefined };
    res.status = jest.fn(() => res);
    res.send = jest.fn((body) => { res.body = body; return res; });
    res.json = res.send;
    return res;
};
const drain = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const call = async (handler, uid, body = {}, params = {}) => {
    const res = response();
    await handler({ uid, aud: C, headers: { companyid: C }, params: { id: PAGE, ...params }, query: {}, body }, res);
    await drain();
    return res.body;
};
const save = (uid, blocks, extra = {}) => call(pages.updatePage, uid, { ...draft(...blocks), ...extra });
const autosave = (uid, blocks, extra = {}) => save(uid, blocks, { autosave: true, ...extra });
const quiet = async (ms) => {
    await jest.advanceTimersByTimeAsync(ms);
    await drain();
};

const storedPage = () => mockDb.store[SCHEMA_TYPE.PAGES].find((row) => String(row._id) === PAGE);
const kept = () => mockDb.store[SCHEMA_TYPE.PAGE_VERSIONS] || [];
const pageEvents = () => socketEmitter.emit.mock.calls.filter(([, payload]) => payload && payload.module === 'pages').map(([, payload]) => payload);
const told = () => notices.handleSingleNotification.mock.calls.flatMap(([body]) => body.assigneeUsers);

const seedPage = (extra = {}) => mockDb.seed(SCHEMA_TYPE.PAGES, {
    _id: PAGE,
    title: 'Launch plan',
    ProjectID: new mongoose.Types.ObjectId(PROJECT),
    visibility: 'project',
    createdBy: AUTHOR,
    updatedBy: AUTHOR,
    editedBy: AUTHOR,
    createdAt: T0,
    editedAt: T0,
    deletedStatusKey: 0,
    content: { html: '<p>One</p>', blocks: { time: 1, blocks: [para('a', 'One')], version: '2.30.7' } },
    rawText: 'One',
    mentionsTold: [],
    ...extra,
});

beforeEach(() => {
    jest.useFakeTimers({ now: T0, doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'queueMicrotask', 'hrtime', 'performance'] });
    mockDb = fakeMongo.create();
    forgetHealedDocNotices();
    pageSettle.forgetAll();
    jest.clearAllMocks();
    [AUTHOR, ANN, BOB].forEach((userId) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, status: 2, isDelete: false }));
    seedPage();
});
afterEach(() => jest.useRealTimers());

describe('a save from an editor that is behind', () => {
    it('is written when the doc is still the one the editor opened', async () => {
        const saved = await save(AUTHOR, [para('a', 'One, two')], { baseEditedAt: T0.toISOString() });

        expect(saved).toMatchObject({ status: true });
        expect(storedPage().rawText).toBe('One, two');
    });

    it('is refused, and changes nothing, when someone saved the doc in between', async () => {
        jest.setSystemTime(T0.getTime() + 60 * SECOND);
        await save(BOB, [para('a', 'One, from Bob')]);
        socketEmitter.emit.mockClear();
        const versions = kept().length;

        for (const send of [save, autosave]) {
            const refused = await send(AUTHOR, [para('a', 'One, from the author')], { baseEditedAt: T0.toISOString() });
            expect(refused).toMatchObject({ status: false, statusCode: 409, conflict: true });
            expect(refused.data).toEqual({ editedBy: BOB, editedAt: new Date(T0.getTime() + 60 * SECOND) });
        }

        expect(storedPage()).toMatchObject({ rawText: 'One, from Bob', editedBy: BOB });
        expect(kept()).toHaveLength(versions);
        expect(pageEvents()).toEqual([]);
    });

    it('is refused for a doc that had no edit time when the editor opened it and has one now', async () => {
        delete storedPage().editedAt;
        expect(await save(AUTHOR, [para('a', 'One, two')], { baseEditedAt: '' })).toMatchObject({ status: true });
        expect(await save(BOB, [para('a', 'One, from Bob')], { baseEditedAt: '' })).toMatchObject({ status: false, statusCode: 409, conflict: true });
    });

    it('is written as before by a caller that names no base, and a property change never needs one', async () => {
        jest.setSystemTime(T0.getTime() + 60 * SECOND);
        expect(await save(BOB, [para('a', 'One, from Bob')])).toMatchObject({ status: true });
        expect(await call(pages.updatePage, AUTHOR, { isWiki: true, baseEditedAt: T0.toISOString() })).toMatchObject({ status: true });
        expect(storedPage()).toMatchObject({ rawText: 'One, from Bob', isWiki: true });
    });
});

describe('a save that changes nothing', () => {
    it('writes nothing and announces nothing', async () => {
        for (const send of [save, autosave]) {
            expect(await send(BOB, [para('a', 'One')])).toMatchObject({ status: true });
        }

        expect(storedPage()).toMatchObject({ updatedBy: AUTHOR, editedBy: AUTHOR, editedAt: T0 });
        expect(pageEvents()).toEqual([]);
        await quiet(120 * SECOND);
        expect(pageEvents()).toEqual([]);
    });
});

describe('an autosave', () => {
    it('writes the doc and answers without its body', async () => {
        jest.setSystemTime(T0.getTime() + 5 * SECOND);
        const saved = await autosave(AUTHOR, [para('a', 'One, two')], { title: 'Launch plan v2' });

        expect(saved).toMatchObject({ status: true, data: { _id: PAGE, title: 'Launch plan v2', editedBy: AUTHOR, editedAt: new Date(T0.getTime() + 5 * SECOND) } });
        expect(Object.keys(saved.data)).not.toContain('content');
        expect(Object.keys(saved.data)).not.toContain('rawText');
        expect(storedPage()).toMatchObject({ rawText: 'One, two', title: 'Launch plan v2' });
    });

    it('announces the doc once, after a quiet minute, however many times it saved', async () => {
        await autosave(AUTHOR, [para('a', 'One, two')]);
        await quiet(20 * SECOND);
        await autosave(AUTHOR, [para('a', 'One, two, three')]);
        await quiet(59 * SECOND);
        expect(pageEvents()).toEqual([]);

        await quiet(2 * SECOND);
        expect(pageEvents()).toHaveLength(1);
        expect(pageEvents()[0]).toMatchObject({ type: 'update', module: 'pages', companyId: C, data: { rawText: 'One, two, three' } });

        await quiet(300 * SECOND);
        expect(pageEvents()).toHaveLength(1);
    });

    it('tells a person named in the doc after thirty quiet seconds, not on each pause', async () => {
        await autosave(AUTHOR, [para('a', `One ${mention(ANN, 'Ann')}`)]);
        await quiet(20 * SECOND);
        await autosave(AUTHOR, [para('a', `One ${mention(ANN, 'Ann')} please look at the`)]);
        await quiet(29 * SECOND);
        expect(told()).toEqual([]);

        await quiet(2 * SECOND);
        expect(told()).toEqual([ANN]);
        expect(notices.handleSingleNotification.mock.calls[0][0]).toMatchObject({ userId: AUTHOR, message: 'One Ann please look at the', changeData: { pageId: PAGE } });

        await quiet(300 * SECOND);
        expect(told()).toEqual([ANN]);
    });

    it('is settled at once by a save that is not an autosave, and nothing follows later', async () => {
        await autosave(AUTHOR, [para('a', `One ${mention(ANN, 'Ann')}`)]);
        const saved = await save(AUTHOR, [para('a', `One ${mention(ANN, 'Ann')} and ${mention(BOB, 'Bob')}`)]);

        expect(Object.keys(saved.data)).toContain('content');
        expect(pageEvents()).toHaveLength(1);
        expect(told().sort()).toEqual([ANN, BOB].sort());

        await quiet(300 * SECOND);
        expect(pageEvents()).toHaveLength(1);
        expect(told()).toHaveLength(2);
    });

    it('is settled at once when the editor says the person left, with nothing more to save', async () => {
        await autosave(AUTHOR, [para('a', `One ${mention(ANN, 'Ann')}`)]);

        expect(await call(pages.updatePage, AUTHOR, { settle: true })).toMatchObject({ status: true });
        expect(pageEvents()).toHaveLength(1);
        expect(told()).toEqual([ANN]);

        expect(await call(pages.updatePage, AUTHOR, { settle: true })).toMatchObject({ status: true });
        await quiet(300 * SECOND);
        expect(pageEvents()).toHaveLength(1);
        expect(told()).toEqual([ANN]);
    });

    it('announces nothing later for a doc that went to the trash in the meantime', async () => {
        await autosave(AUTHOR, [para('a', `One ${mention(ANN, 'Ann')}`)]);
        storedPage().deletedStatusKey = 1;

        await quiet(300 * SECOND);
        expect(pageEvents()).toEqual([]);
        expect(told()).toEqual([]);
    });
});

describe('who has been told that a doc names them', () => {
    it('is remembered on the doc, in a declared field', async () => {
        await save(AUTHOR, [para('a', `One ${mention(ANN, 'Ann')}`)]);

        expect(Object.keys(schema.pages)).toContain('mentionsTold');
        expect(storedPage().mentionsTold).toEqual([ANN]);
    });

    it('is not told again when the mention is cut and pasted back', async () => {
        await save(AUTHOR, [para('a', `One ${mention(ANN, 'Ann')}`)]);
        await save(AUTHOR, [para('a', 'One')]);
        await save(AUTHOR, [para('a', 'One'), para('b', `${mention(ANN, 'Ann')} moved here`)]);

        expect(told()).toEqual([ANN]);
    });

    it('counts everyone a doc already named before this was remembered as told', async () => {
        storedPage().content = { html: '', blocks: { time: 1, blocks: [para('a', `One ${mention(ANN, 'Ann')}`)], version: '2.30.7' } };
        delete storedPage().mentionsTold;

        await autosave(AUTHOR, [para('a', `One ${mention(ANN, 'Ann')} and ${mention(BOB, 'Bob')}`)]);
        expect(storedPage().mentionsTold).toEqual([ANN]);
        await quiet(31 * SECOND);

        expect(told()).toEqual([BOB]);
        expect(storedPage().mentionsTold.sort()).toEqual([ANN, BOB].sort());
    });

    it('does not tell the person who wrote their own name, and remembers it', async () => {
        await save(AUTHOR, [para('a', `One ${mention(AUTHOR, 'Me')}`)]);

        expect(told()).toEqual([]);
        expect(storedPage().mentionsTold).toEqual([AUTHOR]);
    });

    it('tells no one of a mention a restored version brings back, then or later', async () => {
        const version = mockDb.seed(SCHEMA_TYPE.PAGE_VERSIONS, {
            pageId: new mongoose.Types.ObjectId(PAGE), title: 'Launch plan', content: { blocks: [para('a', `Earlier ${mention(ANN, 'Ann')}`)] },
            savedBy: AUTHOR, savedAt: T0, createdAt: T0, reason: 'interval', visibility: 'project', hash: 'earlier', size: 10,
        });

        expect(await call(history.restoreVersion, AUTHOR, {}, { versionId: String(version._id) })).toMatchObject({ status: true });
        await save(AUTHOR, [para('a', `Earlier ${mention(ANN, 'Ann')}, edited`)]);
        await quiet(300 * SECOND);

        expect(told()).toEqual([]);
        expect(storedPage().mentionsTold).toEqual([ANN]);
    });
});
