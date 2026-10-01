const fakeMongo = require('./fixtures/fakeMongo');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Pages/helpers/pageAi', () => ({ composePage: jest.fn(), isAiConfigured: jest.fn(() => false) }));
jest.mock('../Config/contentAccess', () => ({
    projectAccess: jest.fn(),
    isCompanyMember: jest.fn(),
    isCompanyAdmin: jest.fn(async () => false),
    visibleProjectIds: jest.fn(async () => []),
}));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({
    handleSingleNotification: jest.fn(async () => []),
    handleNotificationtFun: jest.fn(async () => ({ status: true })),
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { projectAccess, isCompanyMember } = require('../Config/contentAccess');
const notices = require('../Modules/notification/prepare-notification-data/controllerV2');
const socketEmitter = require('../event/socketEventEmitter');
const { forgetHealedDocNotices } = require('../Modules/notification/docNotices');
const ctrl = require('../Modules/Pages/controller');

const C = '6f00000000000000000000c1';
const PROJECT = '6f0000000000000000000a01';
const AUTHOR = '6f0000000000000000000001';
const ANN = '6f0000000000000000000002';
const BOB = '6f0000000000000000000003';
const GONE = '6f0000000000000000000004';

const mention = (id, label) => `<span class="mention" data-mention="user" data-id="${id}">${label}</span>`;
const blocksWith = (...texts) => texts.map((text) => ({ type: 'paragraph', data: { text } }));

const response = () => {
    const res = { body: undefined };
    res.status = jest.fn(() => res);
    res.send = jest.fn((body) => { res.body = body; return res; });
    res.json = res.send;
    return res;
};

const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

const request = (uid, { params = {}, body = {} } = {}) => ({ uid, aud: C, headers: { companyid: C }, params, query: {}, body });

const save = async (uid, pageId, contentBlocks, extra = {}) => {
    const res = response();
    await ctrl.updatePage(request(uid, { params: { id: pageId }, body: { contentBlocks, ...extra } }), res);
    await settle();
    return res.body;
};

const seedPage = (doc = {}) => mockDb.seed(SCHEMA_TYPE.PAGES, {
    title: 'Launch plan',
    ProjectID: PROJECT,
    visibility: 'project',
    createdBy: AUTHOR,
    deletedStatusKey: 0,
    content: { html: '', blocks: { time: 1, blocks: [], version: '2.30.7' } },
    ...doc,
});

const sentNotices = () => notices.handleSingleNotification.mock.calls.map(([body]) => body);

beforeEach(() => {
    mockDb = fakeMongo.create();
    forgetHealedDocNotices();
    notices.handleSingleNotification.mockClear();
    socketEmitter.emit.mockClear();
    [AUTHOR, ANN, BOB].forEach((userId) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, status: 2, isDelete: false }));
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: GONE, status: 2, isDelete: true });
    mockDb.seed(SCHEMA_TYPE.NOTIFICATIONS_SETTINGS, { userId: ANN, tasks: { key: 'tasks', items: [] } });
    isCompanyMember.mockImplementation(async (companyId, uid) => [AUTHOR, ANN, BOB].includes(uid));
    projectAccess.mockImplementation(async (companyId, uid) => ({ visible: uid !== BOB, canEdit: uid === AUTHOR }));
});

describe('PAGES - @mention notices', () => {
    test('a newly mentioned reader is told once, with the doc and the line that names them', async () => {
        const page = seedPage();
        const body = await save(AUTHOR, page._id, blocksWith(`Can ${mention(ANN, '@Ann')} check the totals?`));
        expect(body.status).toBe(true);

        expect(sentNotices()).toEqual([expect.objectContaining({
            key: 'doc_mention',
            type: 'docs',
            companyId: C,
            projectId: PROJECT,
            userId: AUTHOR,
            assigneeUsers: [ANN],
            notSeen: [ANN],
            directUsers: [ANN],
            changeType: 'doc_mention',
            changeData: { pageId: String(page._id), pageTitle: 'Launch plan' },
            message: 'Can @Ann check the totals?',
        })]);
    });

    test('saving the same mention again tells nobody', async () => {
        const page = seedPage();
        const blocks = blocksWith(mention(ANN, '@Ann'));
        await save(AUTHOR, page._id, blocks);
        notices.handleSingleNotification.mockClear();
        await save(AUTHOR, page._id, [...blocks, ...blocksWith('More text')]);
        expect(notices.handleSingleNotification).not.toHaveBeenCalled();
    });

    test('someone who cannot open the doc, a removed member and the author are never told', async () => {
        const page = seedPage();
        await save(AUTHOR, page._id, blocksWith(`${mention(BOB, '@Bob')} ${mention(GONE, '@Gone')} ${mention(AUTHOR, '@Me')}`));
        expect(notices.handleSingleNotification).not.toHaveBeenCalled();
    });

    test('a private doc tells no one but its author could read it', async () => {
        const page = seedPage({ visibility: 'private' });
        await save(AUTHOR, page._id, blocksWith(mention(ANN, '@Ann')));
        expect(notices.handleSingleNotification).not.toHaveBeenCalled();
    });

    test('a company-wide doc carries no project on its notice', async () => {
        const page = seedPage({ ProjectID: undefined });
        await save(AUTHOR, page._id, blocksWith(mention(ANN, '@Ann')));
        const [notice] = sentNotices();
        expect(notice.assigneeUsers).toEqual([ANN]);
        expect(notice.projectId).toBeUndefined();
    });

    test('creating a doc that already mentions someone tells them', async () => {
        const res = response();
        await ctrl.createPage(request(AUTHOR, { body: { title: 'Notes', projectId: PROJECT, contentBlocks: blocksWith(mention(ANN, '@Ann')) } }), res);
        await settle();
        expect(res.body.status).toBe(true);
        expect(sentNotices().map((notice) => notice.assigneeUsers)).toEqual([[ANN]]);
    });

    test('a reader whose settings predate doc notices gets the docs section before the notice is sent', async () => {
        const page = seedPage();
        await save(AUTHOR, page._id, blocksWith(mention(ANN, '@Ann')));
        const settings = mockDb.store[SCHEMA_TYPE.NOTIFICATIONS_SETTINGS].find((row) => row.userId === ANN);
        expect(settings.docs.items).toEqual([expect.objectContaining({ key: 'doc_mention', browser: true })]);
    });
});

describe('PAGES - stored mention markup', () => {
    test('the saved blocks and html carry only the canonical mention element', async () => {
        const page = seedPage();
        const hostile = `<span class="mention" data-mention="user" data-id="${ANN}" onclick="steal()">@<img src=x onerror=alert(1)>Ann</span>`;
        const body = await save(AUTHOR, page._id, blocksWith(hostile), { contentHtml: `<p>${hostile}</p>` });
        const clean = mention(ANN, '@Ann');
        expect(body.data.content.blocks.blocks[0].data.text).toBe(clean);
        expect(body.data.content.html).toBe(`<p>${clean}</p>`);
        expect(JSON.stringify(body.data.content)).not.toMatch(/onclick|onerror|<img/);
    });
});
