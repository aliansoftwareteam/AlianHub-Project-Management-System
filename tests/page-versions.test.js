const mockDb = require('./fixtures/fakeMongo').create();
const mockFailing = { versionWrites: false };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    ...jest.requireActual('../utils/mongo-handler/mongoQueries'),
    MongoDbCrudOpration: (companyId, query, method) => (mockFailing.versionWrites && query.type === 'pageVersions' && method === 'save'
        ? Promise.reject(new Error('version store is down'))
        : mockDb.crud(companyId, query, method)),
}));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleSingleNotification: jest.fn(async () => []) }));
jest.mock('../Modules/notification/docNotices', () => ({ ensureDocNoticeSection: jest.fn(async () => undefined) }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Pages/helpers/pageAi', () => ({ composePage: jest.fn(), isAiConfigured: () => false }));
jest.mock('../Modules/Pages/helpers/pageMentionNotices', () => ({ notifyNewMentions: jest.fn(async () => undefined) }));
jest.mock('../Config/contentAccess', () => ({
    projectAccess: jest.fn(async (companyId, uid, projectId) => {
        const inCompany = String(companyId) === mockIds.company;
        const visible = inCompany && (mockReaders[String(projectId)] || []).includes(String(uid));
        return { visible, canEdit: visible && (mockEditors[String(projectId)] || []).includes(String(uid)) };
    }),
    isCompanyMember: jest.fn(async (companyId, uid) => String(companyId) === mockIds.company && mockMembers.includes(String(uid))),
    isCompanyAdmin: jest.fn(async (companyId, uid) => String(companyId) === mockIds.company && String(uid) === mockIds.admin),
    visibleProjectIds: jest.fn(async () => []),
}));

const mockIds = {
    company: '6f0000000000000000000c01',
    otherCompany: '6f0000000000000000000c02',
    project: '6f0000000000000000000701',
    page: '6f0000000000000000000e01',
    otherPage: '6f0000000000000000000e02',
    author: '6f0000000000000000000a01',
    editor: '6f0000000000000000000a02',
    reader: '6f0000000000000000000a03',
    outsider: '6f0000000000000000000a04',
    admin: '6f0000000000000000000a05',
    mentioned: '6f0000000000000000000a06',
};
const mockReaders = {};
const mockEditors = {};
const mockMembers = [];

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { schema } = require('../utils/mongo-handler/schema');
const socketEmitter = require('../event/socketEventEmitter');
const { notifyNewMentions } = require('../Modules/Pages/helpers/pageMentionNotices');
const pages = require('../Modules/Pages/controller');
const history = require('../Modules/Pages/versions');
const comments = require('../Modules/Pages/comments');
const routes = require('../Modules/Pages/routes');
const rules = require('../Modules/Pages/helpers/pageVersionRules');

const C = mockIds.company;
const { author: AUTHOR, editor: EDITOR, reader: READER, outsider: OUTSIDER, admin: ADMIN } = mockIds;
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const T0 = new Date('2026-10-01T09:00:00Z').getTime();
const oid = (id) => new mongoose.Types.ObjectId(id);
const at = (minutes) => jest.setSystemTime(T0 + minutes * MINUTE);

const res = () => {
    const r = { body: null };
    r.status = () => r;
    r.json = (body) => { r.body = body; return r; };
    r.send = r.json;
    return r;
};
const call = async (handler, uid, { params = {}, body = {}, companyId = C } = {}) => {
    const r = res();
    await handler({ headers: { companyid: companyId }, aud: companyId, uid, params: { id: mockIds.page, ...params }, body, query: {} }, r);
    return r.body;
};

const para = (id, text) => ({ id, type: 'paragraph', data: { text } });
const draft = (...blocks) => ({
    contentBlocks: { time: Date.now(), blocks, version: '2.30.7' },
    contentHtml: blocks.map((block) => `<p>${block.data.text}</p>`).join(''),
});
const save = (uid, blocks, extra = {}) => call(pages.updatePage, uid, { body: { ...draft(...blocks), ...extra } });
const kept = () => mockDb.store[SCHEMA_TYPE.PAGE_VERSIONS] || [];
const textOf = (version) => version.content.blocks.map((block) => block.data.text).join('|');
const storedPage = (id = mockIds.page) => mockDb.store[SCHEMA_TYPE.PAGES].find((row) => String(row._id) === id);
const pageEvents = () => socketEmitter.emit.mock.calls.filter(([, payload]) => payload && payload.module === 'pages').map(([type, payload]) => ({ type, ...payload }));

const seedPage = (_id = mockIds.page, extra = {}) => mockDb.seed(SCHEMA_TYPE.PAGES, {
    _id,
    title: 'Launch plan',
    ProjectID: oid(mockIds.project),
    createdBy: AUTHOR,
    updatedBy: AUTHOR,
    editedBy: AUTHOR,
    createdAt: new Date(T0),
    editedAt: new Date(T0),
    visibility: 'project',
    deletedStatusKey: 0,
    content: { html: '<p>One</p>', blocks: { time: 1, blocks: [para('a', 'One')], version: '2.30.7' } },
    rawText: 'One',
    ...extra,
});
const seedVersion = (extra = {}) => mockDb.seed(SCHEMA_TYPE.PAGE_VERSIONS, {
    _id: new mongoose.Types.ObjectId().toString(),
    pageId: oid(mockIds.page),
    title: 'Launch plan',
    content: { blocks: [para('a', 'Earlier')] },
    rawText: 'Earlier',
    savedBy: AUTHOR,
    savedAt: new Date(T0 - 60 * MINUTE),
    createdAt: new Date(T0 - 60 * MINUTE),
    reason: 'interval',
    visibility: 'project',
    hash: 'seeded',
    size: 100,
    ...extra,
});

const list = (uid, options) => call(history.listVersions, uid, options);
const open = (uid, versionId, options = {}) => call(history.getVersion, uid, { ...options, params: { ...(options.params || {}), versionId: String(versionId) } });
const restore = (uid, versionId) => call(history.restoreVersion, uid, { params: { versionId: String(versionId) } });
const rename = (uid, versionId, name) => call(history.renameVersion, uid, { params: { versionId: String(versionId) }, body: { name } });
const saveVersion = (uid, name) => call(history.saveVersion, uid, { body: name === undefined ? {} : { name } });

beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'] });
});
afterAll(() => jest.useRealTimers());

beforeEach(() => {
    Object.keys(mockDb.store).forEach((key) => { mockDb.store[key].length = 0; });
    jest.clearAllMocks();
    mockFailing.versionWrites = false;
    mockReaders[mockIds.project] = [AUTHOR, EDITOR, READER, ADMIN];
    mockEditors[mockIds.project] = [AUTHOR, EDITOR, ADMIN];
    mockMembers.length = 0;
    mockMembers.push(AUTHOR, EDITOR, READER, OUTSIDER, ADMIN);
    at(0);
    seedPage();
});

describe('the routes', () => {
    it('sit under the guarded pages prefix', () => {
        const registered = [];
        const app = Object.fromEntries(['get', 'post', 'put', 'delete'].map((method) => [method, (path) => registered.push(`${method.toUpperCase()} ${path}`)]));
        routes.init(app);

        const wanted = [
            'GET /api/v2/pages/:id/versions',
            'POST /api/v2/pages/:id/versions',
            'GET /api/v2/pages/:id/versions/:versionId',
            'PUT /api/v2/pages/:id/versions/:versionId',
            'POST /api/v2/pages/:id/versions/:versionId/restore',
        ];
        wanted.forEach((route) => expect(registered).toContain(route));
        expect(registered.every((route) => route.split(' ')[1].startsWith('/api/v2/pages'))).toBe(true);
    });
});

describe('the fields a version and a doc store', () => {
    it('are all declared, so the strict schema drops none', async () => {
        at(12);
        await save(AUTHOR, [para('a', 'Two')]);
        await saveVersion(AUTHOR, 'Named');

        expect(kept()).toHaveLength(2);
        const declared = [...Object.keys(schema.pageVersions), '_id', 'createdAt', 'updatedAt'];
        kept().forEach((row) => Object.keys(row).forEach((field) => expect(declared).toContain(field)));
        ['editedBy', 'editedAt'].forEach((field) => expect(Object.keys(schema.pages)).toContain(field));
        expect(storedPage()).toMatchObject({ editedBy: AUTHOR, editedAt: new Date(T0 + 12 * MINUTE) });
    });
});

describe('when a version is kept', () => {
    it('is not one per save: the same person adding to the doc inside ten minutes updates the doc only', async () => {
        at(3);
        expect(await save(AUTHOR, [para('a', 'One, two')])).toMatchObject({ status: true });
        at(6);
        await save(AUTHOR, [para('a', 'One, two, three')]);

        expect(kept()).toEqual([]);
        expect(storedPage().rawText).toBe('One, two, three');
    });

    it('keeps the state being replaced once ten minutes have passed since a version was kept, under the time it was written', async () => {
        at(3);
        await save(AUTHOR, [para('a', 'One, two')]);
        at(12);
        await save(AUTHOR, [para('a', 'One, two, three')]);

        expect(kept()).toHaveLength(1);
        expect(kept()[0]).toMatchObject({ title: 'Launch plan', rawText: 'One, two', savedBy: AUTHOR, reason: 'interval', visibility: 'project' });
        expect(kept()[0].savedAt).toEqual(new Date(T0 + 3 * MINUTE));
        expect(textOf(kept()[0])).toBe('One, two');
        expect(String(kept()[0].pageId)).toBe(mockIds.page);

        at(15);
        await save(AUTHOR, [para('a', 'One, two, three, four')]);
        expect(kept()).toHaveLength(1);

        at(23);
        await save(AUTHOR, [para('a', 'One, two, three, four, five')]);
        expect(kept().map((row) => [row.rawText, row.savedAt])).toEqual([['One, two', new Date(T0 + 3 * MINUTE)], ['One, two, three, four', new Date(T0 + 15 * MINUTE)]]);
    });

    it('keeps what one person wrote when another person edits', async () => {
        at(2);
        await save(EDITOR, [para('a', 'Edited')], { title: 'Launch plan v2' });

        expect(kept()).toHaveLength(1);
        expect(kept()[0]).toMatchObject({ title: 'Launch plan', rawText: 'One', savedBy: AUTHOR, reason: 'author' });
        expect(kept()[0].savedAt).toEqual(new Date(T0));

        at(3);
        await save(EDITOR, [para('a', 'Edited again')]);
        expect(kept()).toHaveLength(1);

        at(4);
        await save(AUTHOR, [para('a', 'Back to me')]);
        expect(kept().map((row) => [row.title, row.rawText, row.savedBy, row.reason])).toEqual([
            ['Launch plan', 'One', AUTHOR, 'author'],
            ['Launch plan v2', 'Edited again', EDITOR, 'author'],
        ]);
    });

    it('does not count a save that changes nothing, or a change to the doc’s properties', async () => {
        at(30);
        await save(AUTHOR, [para('a', 'One')]);
        await call(pages.updatePage, EDITOR, { body: { isWiki: true } });

        expect(kept()).toEqual([]);
        expect(storedPage()).toMatchObject({ editedBy: AUTHOR, editedAt: new Date(T0), isWiki: true });
    });

    it('never fails the save when the version cannot be written', async () => {
        mockFailing.versionWrites = true;
        at(2);
        expect(await save(EDITOR, [para('a', 'Edited')])).toMatchObject({ status: true });
        expect(storedPage().rawText).toBe('Edited');
    });

    it('thins the old unnamed versions as a new one is kept', async () => {
        const fiveDaysAgo = T0 - 5 * DAY;
        const old = [0, 60, 120].map((minutes) => seedVersion({ savedAt: new Date(fiveDaysAgo + minutes * MINUTE), createdAt: new Date(fiveDaysAgo + minutes * MINUTE) }));
        const named = seedVersion({ name: 'Signed off', savedAt: new Date(fiveDaysAgo), createdAt: new Date(fiveDaysAgo) });
        const legacy = mockDb.seed(SCHEMA_TYPE.PAGE_VERSIONS, { pageId: oid(mockIds.page), title: 'Launch plan', content: { html: '<p>Old</p>' }, savedBy: AUTHOR, createdAt: new Date(fiveDaysAgo) });
        const elsewhere = seedVersion({ pageId: oid(mockIds.otherPage), savedAt: new Date(fiveDaysAgo), createdAt: new Date(fiveDaysAgo) });

        at(2);
        await save(EDITOR, [para('a', 'Edited')]);

        const ids = kept().map((row) => String(row._id));
        expect(ids).not.toContain(String(old[0]._id));
        expect(ids).not.toContain(String(old[1]._id));
        [old[2], named, legacy, elsewhere].forEach((row) => expect(ids).toContain(String(row._id)));
        expect(kept()).toHaveLength(5);
    });
});

describe('when a save loses text', () => {
    const LONG = 'The launch moves to the second week of March because the supplier contract is not signed yet.';
    const firstDraft = () => {
        storedPage().content = { html: '<p>First draft</p>', blocks: { blocks: [para('a', 'First draft')] } };
        storedPage().rawText = 'First draft';
    };

    it('keeps the first text of a doc when its writer replaces it five minutes later', async () => {
        firstDraft();
        at(5);
        await save(AUTHOR, [para('a', 'Second draft')]);

        expect(kept()).toHaveLength(1);
        expect(kept()[0]).toMatchObject({ rawText: 'First draft', savedBy: AUTHOR, reason: 'rewrite', visibility: 'project' });
        expect(kept()[0].savedAt).toEqual(new Date(T0));
        expect(schema.pageVersions.reason).toBeDefined();
        expect(rules.REASONS).toContain('rewrite');

        const restored = await restore(AUTHOR, kept()[0]._id);
        expect(restored).toMatchObject({ status: true, data: { rawText: 'First draft' } });
    });

    it('keeps each text a rewrite replaces, however recently a version was kept', async () => {
        firstDraft();
        at(1);
        await save(AUTHOR, [para('a', LONG)]);
        at(2);
        await save(AUTHOR, [para('a', 'The launch moves to April.')]);

        expect(kept().map((row) => [row.rawText, row.reason])).toEqual([['First draft', 'rewrite'], [LONG, 'rewrite']]);
    });

    it('keeps what a save removes most of, a minute after the last version', async () => {
        storedPage().content = { html: `<p>Kept line</p><p>${LONG}</p>`, blocks: { blocks: [para('a', 'Kept line'), para('b', LONG)] } };
        seedVersion({ savedAt: new Date(T0), createdAt: new Date(T0) });
        at(1);
        await save(AUTHOR, [para('a', 'Kept line')]);

        expect(kept()).toHaveLength(2);
        expect(kept()[1]).toMatchObject({ rawText: `Kept line ${LONG}`, reason: 'rewrite' });
    });

    it('coalesces a run of small edits: typing on, and fixing a word', async () => {
        storedPage().content = { html: `<p>${LONG}</p>`, blocks: { blocks: [para('a', LONG)] } };
        const steps = [`${LONG} Legal`, `${LONG} Legal reviews it`, `${LONG} Legal reviews it on Monday.`, `${LONG.replace('supplier', 'vendor')} Legal reviews it on Monday.`];
        for (const [index, text] of steps.entries()) {
            at(1 + index);
            await save(AUTHOR, [para('a', text)]);
        }

        expect(kept()).toEqual([]);
        expect(storedPage().rawText).toBe(steps[3]);
    });

    it('stays inside the cap on unnamed versions', async () => {
        firstDraft();
        Array.from({ length: rules.MAX_UNNAMED_VERSIONS }, (_, index) => seedVersion({
            savedAt: new Date(T0 - (index + 1) * MINUTE), createdAt: new Date(T0 - (index + 1) * MINUTE), hash: `seeded-${index}`,
        }));
        at(5);
        await save(AUTHOR, [para('a', 'Second draft')]);

        expect(kept()).toHaveLength(rules.MAX_UNNAMED_VERSIONS);
        expect(kept().some((row) => row.rawText === 'First draft' && row.reason === 'rewrite')).toBe(true);
    });
});

describe('saving a version by hand', () => {
    it('keeps the doc as it is now, with the name, for whoever pressed it', async () => {
        at(1);
        const saved = await saveVersion(EDITOR, '  Before review  ');

        expect(saved).toMatchObject({ status: true, data: { name: 'Before review', reason: 'manual', savedBy: EDITOR } });
        expect(saved.data.content).toBeUndefined();
        expect(kept()).toHaveLength(1);
        expect(kept()[0]).toMatchObject({ rawText: 'One', name: 'Before review', reason: 'manual', savedBy: EDITOR, visibility: 'project' });
        expect(kept()[0].savedAt).toEqual(new Date(T0 + MINUTE));
    });

    it('announces nothing: a version is not a doc, and the knowledge index reads what docs announce', async () => {
        const saved = await saveVersion(EDITOR, 'Before review');
        await rename(EDITOR, saved.data._id, 'Renamed');

        expect(socketEmitter.emit).not.toHaveBeenCalled();
    });

    it('does not keep the same state twice, and names the one it already has', async () => {
        await saveVersion(AUTHOR);
        await saveVersion(AUTHOR);
        expect(kept()).toHaveLength(1);
        expect(kept()[0].name || '').toBe('');

        expect(await saveVersion(AUTHOR, 'Baseline')).toMatchObject({ status: true, data: { name: 'Baseline' } });
        expect(kept()).toHaveLength(1);
        expect(kept()[0].name).toBe('Baseline');
    });

    it('is refused to someone who can read the doc but not change it, and to a name that is not text', async () => {
        expect(await saveVersion(READER, 'Mine')).toMatchObject({ status: false, statusCode: 403 });
        expect(await saveVersion(OUTSIDER, 'Mine')).toMatchObject({ status: false, statusCode: 404 });
        expect(await saveVersion(EDITOR, { $gt: '' })).toMatchObject({ status: false, statusCode: 400 });
        expect(kept()).toEqual([]);
    });
});

describe('naming a version', () => {
    it('renames it for an editor and clears the name when left empty', async () => {
        const version = seedVersion();

        expect(await rename(EDITOR, version._id, ' Signed off ')).toMatchObject({ status: true, data: { name: 'Signed off' } });
        expect(kept()[0].name).toBe('Signed off');
        expect(await rename(EDITOR, version._id, '')).toMatchObject({ status: true });
        expect(kept()[0].name).toBe('');
    });

    it('is refused to a reader, and for a version of another doc', async () => {
        const version = seedVersion();
        const elsewhere = seedVersion({ pageId: oid(mockIds.otherPage) });

        expect(await rename(READER, version._id, 'Mine')).toMatchObject({ status: false, statusCode: 403 });
        expect(await rename(EDITOR, elsewhere._id, 'Mine')).toMatchObject({ status: false, statusCode: 404 });
        expect(kept().map((row) => row.name || '')).toEqual(['', '']);
    });

    it('stops at the cap on named versions', async () => {
        Array.from({ length: rules.MAX_NAMED_VERSIONS }, (_, i) => seedVersion({ name: `Named ${i}` }));
        const one = seedVersion();

        expect(await rename(EDITOR, one._id, 'One more')).toMatchObject({ status: false, statusCode: 400 });
        expect(await saveVersion(EDITOR, 'One more')).toMatchObject({ status: false, statusCode: 400 });
    });
});

describe('reading the history', () => {
    it('lists the versions newest first, without their content, to anyone who can read the doc', async () => {
        const older = seedVersion({ savedAt: new Date(T0 - 120 * MINUTE), createdAt: new Date(T0 - 120 * MINUTE), name: 'First draft' });
        const newer = seedVersion({ savedBy: EDITOR, reason: 'author' });
        seedVersion({ pageId: oid(mockIds.otherPage) });

        const listed = await list(READER);

        expect(listed.status).toBe(true);
        expect(listed.data.map((row) => String(row._id))).toEqual([String(newer._id), String(older._id)]);
        expect(listed.data[0]).toMatchObject({ title: 'Launch plan', savedBy: EDITOR, reason: 'author', name: '', visibility: 'project' });
        expect(new Date(listed.data[0].savedAt)).toEqual(new Date(T0 - 60 * MINUTE));
        expect(listed.data[1].name).toBe('First draft');
        listed.data.forEach((row) => {
            expect(row.content).toBeUndefined();
            expect(row.rawText).toBeUndefined();
        });
    });

    it('answers not found for a doc the caller cannot read, a doc in the trash and another company', async () => {
        const version = seedVersion();

        expect(await list(OUTSIDER)).toMatchObject({ status: false, statusCode: 404 });
        expect(await open(OUTSIDER, version._id)).toMatchObject({ status: false, statusCode: 404 });
        expect(await list(AUTHOR, { companyId: mockIds.otherCompany })).toMatchObject({ status: false, statusCode: 404 });

        storedPage().deletedStatusKey = 1;
        expect(await list(AUTHOR)).toMatchObject({ status: false, statusCode: 404 });
    });

    it('opens one version with its blocks, and none that belongs to another doc', async () => {
        const version = seedVersion();
        const elsewhere = seedVersion({ pageId: oid(mockIds.otherPage) });

        const opened = await open(READER, version._id);
        expect(opened).toMatchObject({ status: true, data: { title: 'Launch plan', rawText: 'Earlier', blocks: [para('a', 'Earlier')] } });
        expect(await open(READER, elsewhere._id)).toMatchObject({ status: false, statusCode: 404 });
        expect(await open(READER, 'not-an-id')).toMatchObject({ status: false, statusCode: 404 });
    });

    it('rebuilds every mention and image from its type and id, never from the stored markup', async () => {
        const version = seedVersion({
            content: {
                blocks: [
                    para('a', `Ask <span class="mention x" data-mention="user" data-id="${mockIds.mentioned.toUpperCase()}" onclick="steal()">@Priya</span>`),
                    para('b', '<span data-mention="user" data-id="nope" onmouseover="steal()">@Ghost</span>'),
                    { id: 'c', type: 'image', data: { key: 'Tasks/secret/other.png', url: '', caption: 'Chart' } },
                    { id: 'd', type: 'image', data: { key: `Pages/${mockIds.page}/chart.png`, url: '', caption: 'Chart' } },
                ],
            },
        });

        const { blocks } = (await open(READER, version._id)).data;

        expect(blocks[0].data.text).toBe(`Ask <span class="mention" data-mention="user" data-id="${mockIds.mentioned}">@Priya</span>`);
        expect(blocks[1].data.text).toBe('@Ghost');
        expect(blocks[2].data.key).toBe('');
        expect(blocks[3].data.key).toBe(`Pages/${mockIds.page}/chart.png`);
        expect(JSON.stringify(blocks)).not.toContain('steal');
    });

    it('keeps the rows of the old history readable', async () => {
        const legacy = mockDb.seed(SCHEMA_TYPE.PAGE_VERSIONS, {
            pageId: oid(mockIds.page), title: 'Old title', content: { html: '<h2>Old</h2><p>Body</p>' }, rawText: 'Old Body', savedBy: AUTHOR, createdAt: new Date(T0 - 90 * DAY),
        });

        const listed = await list(READER);
        expect(listed.data).toHaveLength(1);
        expect(listed.data[0]).toMatchObject({ title: 'Old title', savedBy: AUTHOR, reason: 'legacy' });
        expect(new Date(listed.data[0].savedAt)).toEqual(new Date(T0 - 90 * DAY));

        const opened = await open(READER, legacy._id);
        expect(opened.data.blocks.map((block) => block.type)).toEqual(['header', 'paragraph']);
    });
});

describe('a private doc', () => {
    it('shows its history to its author alone', async () => {
        storedPage().visibility = 'private';
        const version = seedVersion({ visibility: 'private' });

        expect((await list(AUTHOR)).data).toHaveLength(1);
        for (const uid of [EDITOR, READER, ADMIN]) {
            expect(await list(uid)).toMatchObject({ status: false, statusCode: 404 });
            expect(await open(uid, version._id)).toMatchObject({ status: false, statusCode: 404 });
            expect(await restore(uid, version._id)).toMatchObject({ status: false, statusCode: 404 });
        }
    });

    it('marks each version with the visibility the doc had', async () => {
        storedPage().visibility = 'private';
        at(12);
        await save(AUTHOR, [para('a', 'Secret plan')]);
        at(13);
        await call(pages.updatePage, AUTHOR, { body: { visibility: 'project' } });
        at(30);
        await save(AUTHOR, [para('a', 'Public plan')]);

        expect(kept().map((row) => [row.rawText, row.visibility])).toEqual([['One', 'private'], ['Secret plan', 'project']]);
    });
});

describe('a doc that was private and is now shared', () => {
    let secret;
    let shared;
    beforeEach(() => {
        secret = seedVersion({ visibility: 'private', rawText: 'Salaries', content: { blocks: [para('a', 'Salaries')] }, savedAt: new Date(T0 - 120 * MINUTE), createdAt: new Date(T0 - 120 * MINUTE) });
        shared = seedVersion({ visibility: 'project' });
    });

    it('shows the versions from its private time to the author only', async () => {
        for (const uid of [EDITOR, READER, ADMIN]) {
            const listed = await list(uid);
            expect(listed.data.map((row) => String(row._id))).toEqual([String(shared._id)]);
            expect(JSON.stringify(listed)).not.toContain('Salaries');
            expect(await open(uid, secret._id)).toMatchObject({ status: false, statusCode: 404 });
        }
        expect((await list(AUTHOR)).data.map((row) => String(row._id))).toEqual([String(shared._id), String(secret._id)]);
        expect(await open(AUTHOR, secret._id)).toMatchObject({ status: true, data: { rawText: 'Salaries' } });
    });

    it('lets nobody else restore or name one, and changes nothing', async () => {
        expect(await restore(EDITOR, secret._id)).toMatchObject({ status: false, statusCode: 404 });
        expect(await rename(EDITOR, secret._id, 'Leak')).toMatchObject({ status: false, statusCode: 404 });

        expect(storedPage().rawText).toBe('One');
        expect(kept()).toHaveLength(2);
        expect(pageEvents()).toEqual([]);
    });

    it('still hides them when the author has left the workspace', async () => {
        mockMembers.splice(mockMembers.indexOf(AUTHOR), 1);
        mockReaders[mockIds.project] = [EDITOR, READER, ADMIN];
        mockEditors[mockIds.project] = [EDITOR, ADMIN];

        expect(await list(AUTHOR)).toMatchObject({ status: false, statusCode: 404 });
        expect((await list(ADMIN)).data.map((row) => String(row._id))).toEqual([String(shared._id)]);
        expect(await open(ADMIN, secret._id)).toMatchObject({ status: false, statusCode: 404 });
    });
});

describe('restoring a version', () => {
    const twoBlocks = () => {
        storedPage().content = { html: '<p>Intro now</p><p>Risks</p>', blocks: { blocks: [para('intro', 'Intro now'), para('risks', 'Risks')] } };
        storedPage().rawText = 'Intro now Risks';
        storedPage().editedBy = EDITOR;
        return seedVersion({ title: 'Launch plan (draft)', rawText: 'Intro then', content: { blocks: [para('intro', 'Intro then')] } });
    };

    it('keeps the current state as a version first, then replaces the title and the content', async () => {
        const version = twoBlocks();
        at(5);

        const restored = await restore(AUTHOR, version._id);

        expect(restored).toMatchObject({ status: true, data: { title: 'Launch plan (draft)', rawText: 'Intro then' } });
        expect(storedPage()).toMatchObject({ title: 'Launch plan (draft)', rawText: 'Intro then', updatedBy: AUTHOR, editedBy: AUTHOR, editedAt: new Date(T0 + 5 * MINUTE) });
        expect(storedPage().content.blocks.blocks).toEqual([para('intro', 'Intro then')]);
        expect(storedPage().content.html).toBe('<p>Intro then</p>');

        expect(kept()).toHaveLength(2);
        const safety = kept().find((row) => row.reason === 'restore');
        expect(safety).toMatchObject({ title: 'Launch plan', rawText: 'Intro now Risks', savedBy: EDITOR, visibility: 'project' });
        expect(kept().some((row) => String(row._id) === String(version._id))).toBe(true);
    });

    it('adds no version when the last one already holds the state about to be replaced', async () => {
        const version = twoBlocks();
        at(2);
        expect((await saveVersion(EDITOR, 'v2')).status).toBe(true);
        const named = kept().find((row) => row.name === 'v2');
        expect(named).toMatchObject({ reason: 'manual', rawText: 'Intro now Risks' });
        at(5);

        const restored = await restore(EDITOR, version._id);

        expect(restored).toMatchObject({ status: true, data: { rawText: 'Intro then' } });
        expect(kept()).toHaveLength(2);
        expect(kept().some((row) => row.reason === 'restore')).toBe(false);
        expect(kept().find((row) => row.name === 'v2').rawText).toBe('Intro now Risks');
    });

    it('keeps the replaced state again once the doc has changed since the last version', async () => {
        const version = twoBlocks();
        at(2);
        await saveVersion(EDITOR, 'v2');
        storedPage().content = { html: '<p>Intro later</p>', blocks: { blocks: [para('intro', 'Intro later')] } };
        storedPage().rawText = 'Intro later';
        at(5);

        await restore(EDITOR, version._id);

        const safety = kept().filter((row) => row.reason === 'restore');
        expect(safety).toHaveLength(1);
        expect(safety[0]).toMatchObject({ rawText: 'Intro later', savedBy: EDITOR });
        expect(kept()).toHaveLength(3);
    });

    it('announces the doc the way a save does, and notifies no one of an old mention', async () => {
        const version = twoBlocks();

        await restore(EDITOR, version._id);

        expect(pageEvents()).toHaveLength(1);
        expect(pageEvents()[0]).toMatchObject({ type: 'update', module: 'pages', companyId: C, data: { title: 'Launch plan (draft)', rawText: 'Intro then' } });
        expect(String(pageEvents()[0].data._id)).toBe(mockIds.page);
        expect(notifyNewMentions).not.toHaveBeenCalled();
    });

    it('is refused to a reader, and leaves the doc alone when the current state cannot be kept first', async () => {
        const version = twoBlocks();

        expect(await restore(READER, version._id)).toMatchObject({ status: false, statusCode: 403 });
        mockFailing.versionWrites = true;
        expect((await restore(EDITOR, version._id)).status).toBe(false);

        expect(storedPage().rawText).toBe('Intro now Risks');
        expect(pageEvents()).toEqual([]);
    });

    it('never restores stored markup as it is', async () => {
        const version = seedVersion({ content: { blocks: [para('a', '<span data-mention="user" data-id="nope" onclick="steal()">@Ghost</span> hello')] } });

        await restore(EDITOR, version._id);

        expect(JSON.stringify(storedPage().content)).not.toContain('steal');
        expect(storedPage().content.blocks.blocks[0].data.text).toBe('@Ghost hello');
    });

    it('leaves a comment on a block that is gone at doc level, and one on a block that came back on its block', async () => {
        const version = twoBlocks();
        const comment = (blockId) => mockDb.seed(SCHEMA_TYPE.PAGE_COMMENTS, { pageId: oid(mockIds.page), blockId, userId: READER, message: 'Check this', createdAt: new Date(T0) });
        const onRisks = comment('risks');
        const onIntro = comment('intro');

        const before = (await call(comments.listComments, READER)).data;
        expect(before.map((row) => row.blockId)).toEqual(['risks', 'intro']);

        await restore(EDITOR, version._id);

        const after = (await call(comments.listComments, READER)).data;
        expect(after.find((row) => String(row._id) === String(onRisks._id))).toMatchObject({ blockId: '', blockRemoved: true });
        expect(after.find((row) => String(row._id) === String(onIntro._id))).toMatchObject({ blockId: 'intro' });
        expect(after.find((row) => String(row._id) === String(onIntro._id)).blockRemoved).toBeUndefined();
    });
});
