/* A doc page's body as each write stores it, through the real handlers on the in-memory database, and what the audit
   script reports about rows stored before bodies were cleaned on save. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    ...jest.requireActual('../utils/mongo-handler/mongoQueries'),
    MongoDbCrudOpration: (companyId, query, method) => mockDb.crud(companyId, query, method),
}));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleSingleNotification: jest.fn(async () => []) }));
jest.mock('../Modules/notification/docNotices', () => ({ ensureDocNoticeSection: jest.fn(async () => undefined) }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Pages/helpers/pageAi', () => ({ composePage: jest.fn(), isAiConfigured: () => false }));
jest.mock('../Modules/Pages/helpers/pageMentionNotices', () => ({ notifyMentioned: jest.fn(async () => undefined) }));
jest.mock('../Config/contentAccess', () => ({
    projectAccess: jest.fn(async () => ({ visible: true, canEdit: true })),
    isCompanyMember: jest.fn(async () => true),
    isCompanyAdmin: jest.fn(async () => false),
    visibleProjectIds: jest.fn(async () => []),
}));

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { notifyMentioned } = require('../Modules/Pages/helpers/pageMentionNotices');
const pages = require('../Modules/Pages/controller');
const history = require('../Modules/Pages/versions');
const pageRequests = require('../Modules/Agents/pageRequests');
const { LIMITS } = require('../Modules/Tasks/helpers/cleanRichText');
const audit = require('../scripts/rich-text-audit');

const C = '6f0000000000000000000c01';
const PROJECT = '6f0000000000000000000701';
const PAGE = '6f0000000000000000000e01';
const AUTHOR = '6f0000000000000000000a01';
const EDITOR = '6f0000000000000000000a02';
const MENTIONED = '6f0000000000000000000a06';
const MINUTE = 60 * 1000;
const T0 = new Date('2026-10-01T09:00:00Z').getTime();
const oid = (id) => new mongoose.Types.ObjectId(id);
const at = (minutes) => jest.setSystemTime(T0 + minutes * MINUTE);

const LINK = 'target="_blank" rel="noopener noreferrer"';
const MENTION = `<span class="mention" data-mention="user" data-id="${MENTIONED}">@Max</span>`;
const para = (id, text) => ({ id, type: 'paragraph', data: { text } });
const SENT = [
    para('a', `Ask ${MENTION} <b onclick="window.__ran = 1">today</b><script>window.__ran = 1</script>`),
    para('b', '<img src="https://example.test/chart.png" onerror="window.__ran = 1"> and <a href="javascript:window.__ran = 1">this</a>'),
    { id: 'c', type: 'callout', data: { text: '<i style="color:red;position:fixed">Careful</i>', tone: 'warn', html: '<iframe src="https://remote.example.test"></iframe>' } },
    { id: 'd', type: 'embed', data: { service: 'youtube', embed: 'https://remote.example.test/frame', source: 'https://remote.example.test/page', caption: '' } },
];
const KEPT = [
    para('a', `Ask ${MENTION} <b>today</b>`),
    para('b', '<img src="https://example.test/chart.png"> and <a>this</a>'),
    { id: 'c', type: 'callout', data: { text: '<i style="color:red">Careful</i>', tone: 'warn' } },
    para('d', `<a href="https://remote.example.test/page" ${LINK}>https://remote.example.test/page</a>`),
];
const SENT_HTML = `<p onclick="window.__ran = 1">Ask ${MENTION} <b>today</b></p><iframe src="https://remote.example.test"></iframe><p><a href="https://example.test/spec">spec</a></p>`;
const KEPT_HTML = `<p>Ask ${MENTION} <b>today</b></p><p><a href="https://example.test/spec" ${LINK}>spec</a></p>`;
const EDITOR_MADE = [
    para('a', `Ask ${MENTION} about <b>the date</b> &amp; the room<br>today`),
    { id: 'b', type: 'list', data: { style: 'unordered', items: [{ content: 'one', items: [{ content: 'two', items: [] }] }] } },
    { id: 'c', type: 'callout', data: { text: '<b>Careful</b>', tone: 'warn' } },
    { id: 'd', type: 'image', data: { url: '', key: `Pages/${PAGE}/chart.png`, caption: 'Sales < costs' } },
    { id: 'e', type: 'task', data: { taskId: '6f0000000000000000000b01', taskKey: 'AP-1', title: 'Fix <Header>' } },
];
const NOTHING_RUNS = /onclick|onerror|<script|<iframe|javascript:|position/;

const res = () => {
    const r = { body: null };
    r.status = () => r;
    r.json = (body) => { r.body = body; return r; };
    r.send = r.json;
    return r;
};
const call = async (handler, uid, { params = {}, body = {} } = {}) => {
    const r = res();
    await handler({ headers: { companyid: C }, aud: C, uid, params: { id: PAGE, ...params }, body, query: {} }, r);
    return r.body;
};
const draft = (blocks, contentHtml) => ({ contentBlocks: { time: 1, blocks, version: '2.30.7' }, ...(contentHtml === undefined ? {} : { contentHtml }) });
const storedPages = () => mockDb.store[SCHEMA_TYPE.PAGES];
const storedPage = (id = PAGE) => storedPages().find((row) => String(row._id) === String(id));
const versions = () => mockDb.store[SCHEMA_TYPE.PAGE_VERSIONS] || [];

const seedPage = (extra = {}) => mockDb.seed(SCHEMA_TYPE.PAGES, {
    _id: PAGE, title: 'Launch plan', ProjectID: oid(PROJECT), createdBy: AUTHOR, updatedBy: AUTHOR, editedBy: AUTHOR,
    createdAt: new Date(T0), editedAt: new Date(T0), visibility: 'project', deletedStatusKey: 0,
    content: { html: '<p>One</p>', blocks: { time: 1, blocks: [para('a', 'One')], version: '2.30.7' } }, rawText: 'One', ...extra,
});

beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'] });
});
afterAll(() => jest.useRealTimers());

beforeEach(() => {
    Object.keys(mockDb.store).forEach((key) => { mockDb.store[key].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    at(0);
    seedPage();
});

describe('a new doc', () => {
    it('stores its body as the docs editor would draw it, as a copy kept from an edit does', async () => {
        const made = await call(pages.createPage, AUTHOR, { body: { title: 'Launch plan (my copy)', projectId: PROJECT, contentBlocks: SENT } });
        expect(made).toMatchObject({ status: true });
        const { content, rawText } = storedPage(made.data._id);
        expect(content.blocks.blocks).toEqual(KEPT);
        expect(content.html).not.toMatch(NOTHING_RUNS);
        expect(content.html).toContain(`<p>Ask ${MENTION} <b>today</b></p>`);
        expect(rawText).not.toMatch(/__ran/);
    });

    it('still tells the person it names', async () => {
        const made = await call(pages.createPage, AUTHOR, { body: { title: 'Notes', projectId: PROJECT, contentBlocks: SENT } });
        expect(storedPage(made.data._id).mentionsTold).toEqual([MENTIONED]);
        expect(notifyMentioned).toHaveBeenCalledWith(expect.objectContaining({ named: [MENTIONED] }));
    });

    it('is refused when its body is beyond a size limit', async () => {
        const made = await call(pages.createPage, AUTHOR, { body: { title: 'Deep', projectId: PROJECT, contentBlocks: [para('a', `${'<b>'.repeat(LIMITS.tagDepth + 1)}x`)] } });
        expect(made).toMatchObject({ status: false, statusCode: 400, statusText: expect.stringMatching(/100 tags deep/) });
        expect(storedPages()).toHaveLength(1);
    });
});

describe('a doc that is edited', () => {
    it('stores the blocks and the HTML it is sent as the docs editor would draw them', async () => {
        expect(await call(pages.updatePage, AUTHOR, { body: draft(SENT, SENT_HTML) })).toMatchObject({ status: true });
        expect(storedPage().content).toEqual({ html: KEPT_HTML, blocks: { time: expect.any(Number), blocks: KEPT, version: '2.30.7' } });
        expect(storedPage().rawText).toBe('Ask @Max today spec');
    });

    it('stores a body the editor made as it was sent', async () => {
        await call(pages.updatePage, AUTHOR, { body: draft(EDITOR_MADE) });
        expect(JSON.stringify(storedPage().content.blocks.blocks)).toBe(JSON.stringify(EDITOR_MADE));
    });

    it('keeps a version that holds the body as it was stored, never as it was sent', async () => {
        await call(pages.updatePage, AUTHOR, { body: draft(SENT, SENT_HTML) });
        at(30);
        await call(pages.updatePage, EDITOR, { body: draft([para('z', 'Rewritten by someone else')], '<p>Rewritten by someone else</p>') });
        const kept = versions().find((version) => version.savedBy === AUTHOR && version.content.blocks.length === KEPT.length);
        expect(kept.content.blocks).toEqual(KEPT);
        expect(JSON.stringify(versions())).not.toMatch(NOTHING_RUNS);
    });

    it('reads a second save of the same body as no change', async () => {
        await call(pages.updatePage, AUTHOR, { body: draft(SENT, SENT_HTML) });
        const { editedAt } = storedPage();
        const kept = versions().length;
        at(45);
        expect(await call(pages.updatePage, AUTHOR, { body: draft(SENT, SENT_HTML) })).toMatchObject({ status: true });
        expect(storedPage().editedAt).toEqual(editedAt);
        expect(versions()).toHaveLength(kept);
    });

    it('is refused beyond a size limit, and the doc keeps what it had', async () => {
        const blocks = Array.from({ length: LIMITS.blocks + 1 }, (_, index) => para(`p${index}`, 'x'));
        expect(await call(pages.updatePage, AUTHOR, { body: draft(blocks) })).toMatchObject({ status: false, statusCode: 400, statusText: expect.stringMatching(/5000 blocks/) });
        expect(storedPage().rawText).toBe('One');
    });
});

describe('a version that is restored', () => {
    it('comes back as the docs editor would draw it, though it was kept before bodies were cleaned', async () => {
        const version = mockDb.seed(SCHEMA_TYPE.PAGE_VERSIONS, {
            _id: new mongoose.Types.ObjectId().toString(), pageId: oid(PAGE), title: 'Launch plan', content: { blocks: SENT }, rawText: 'Earlier',
            savedBy: AUTHOR, savedAt: new Date(T0 - 60 * MINUTE), createdAt: new Date(T0 - 60 * MINUTE), reason: 'interval', visibility: 'project', hash: 'seeded', size: 100,
        });
        at(5);
        expect(await call(history.restoreVersion, AUTHOR, { params: { versionId: version._id } })).toMatchObject({ status: true });
        expect(storedPage().content.blocks.blocks).toEqual(KEPT);
        expect(storedPage().content.html).not.toMatch(NOTHING_RUNS);
        expect(notifyMentioned).not.toHaveBeenCalled();
    });
});

describe('a doc an agent or an outside client writes', () => {
    const actor = { userId: AUTHOR, agentName: 'Planner' };
    const TEXT = '# Plan\n\nShip <b onclick="window.__ran = 1">it</b> & "rest"\n\n- one\n- two';
    const WRITTEN = [
        { type: 'header', data: { text: 'Plan', level: 1 } },
        { type: 'paragraph', data: { text: 'Ship &lt;b onclick="window.__ran = 1"&gt;it&lt;/b&gt; &amp; "rest"' } },
        { type: 'list', data: { style: 'unordered', items: [{ content: 'one', items: [] }, { content: 'two', items: [] }] } },
    ];

    it('is stored as the docs editor would draw it when it is created', async () => {
        const { result } = await pageRequests.executors['page.create']({ companyId: C, actor, params: { title: 'Agent notes', projectId: PROJECT, text: TEXT } });
        expect(storedPage(result.pageId).content.blocks.blocks).toEqual(WRITTEN);
        expect(storedPage(result.pageId).content.html).toBe('<h1>Plan</h1><p>Ship &lt;b onclick="window.__ran = 1"&gt;it&lt;/b&gt; &amp; "rest"</p><ul><li>one</li><li>two</li></ul>');
    });

    it('is stored as the docs editor would draw it when it is changed', async () => {
        await pageRequests.executors['page.update']({ companyId: C, actor, params: { pageId: PAGE, text: TEXT } });
        expect(storedPage().content.blocks.blocks).toEqual(WRITTEN);
        expect(storedPage().content.html).toMatch(/^<h1>Plan<\/h1><p>Ship &lt;b/);
    });
});

describe('the audit of rows stored before bodies were cleaned', () => {
    const OTHER_PAGE = '6f0000000000000000000e02';
    const tooDeep = `${'<b>'.repeat(LIMITS.tagDepth + 1)}x`;

    const seedRows = () => {
        storedPage().content = { html: KEPT_HTML, blocks: { time: 1, blocks: KEPT, version: '2.30.7' } };
        seedPage({ _id: OTHER_PAGE, content: { html: SENT_HTML, blocks: { time: 1, blocks: SENT, version: '2.30.7' } } });
        mockDb.seed(SCHEMA_TYPE.PAGE_VERSIONS, { _id: '6f0000000000000000000f01', pageId: oid(PAGE), content: { blocks: SENT } });
        mockDb.seed(SCHEMA_TYPE.TASKS, { _id: '6f0000000000000000000b01', descriptionBlock: { blocks: [para('a', 'Plain <b>words</b>')] }, description: 'Plain words' });
        mockDb.seed(SCHEMA_TYPE.TASKS, { _id: '6f0000000000000000000b02', descriptionBlock: { blocks: [para('a', 'See <a href="https://example.test/spec">the spec</a> &quot;now&quot;')] } });
        mockDb.seed(SCHEMA_TYPE.TASKS, { _id: '6f0000000000000000000b03', description: 'Older <b onclick="window.__ran = 1">text</b>' });
        mockDb.seed(SCHEMA_TYPE.TASKS, { _id: '6f0000000000000000000b04', descriptionBlock: { blocks: [para('a', tooDeep)] } });
        mockDb.seed(SCHEMA_TYPE.TASKS, { _id: '6f0000000000000000000b05', TaskName: 'No description' });
        mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT, descriptionBlock: { blocks: [para('a', '<img src=x onerror="window.__ran = 1">Plan')] } });
        mockDb.seed(SCHEMA_TYPE.TASK_TEMPLATES, { _id: '6f0000000000000000000f02', descriptionBlock: {} });
        mockDb.seed(SCHEMA_TYPE.RECURRING_TASKS, { _id: '6f0000000000000000000f03', templateSnapshot: { descriptionBlock: { blocks: [para('a', '<script>window.__ran = 1</script>Weekly')] } } });
    };

    it('counts, collection by collection, the rows a save today would write differently', async () => {
        seedRows();
        const [report] = await audit.auditCompanies([C]);
        expect(report.companyId).toBe(C);
        expect(report.collections).toEqual({
            tasks: { read: 5, respelled: 1, reduced: 1, refused: 1, reducedIds: ['6f0000000000000000000b03'], refusedIds: ['6f0000000000000000000b04'] },
            projects: { read: 1, respelled: 0, reduced: 1, refused: 0, reducedIds: [PROJECT], refusedIds: [] },
            task_templates: { read: 1, respelled: 0, reduced: 0, refused: 0, reducedIds: [], refusedIds: [] },
            recurring_tasks: { read: 1, respelled: 0, reduced: 1, refused: 0, reducedIds: ['6f0000000000000000000f03'], refusedIds: [] },
            pages: { read: 2, respelled: 0, reduced: 1, refused: 0, reducedIds: [OTHER_PAGE], refusedIds: [] },
            pageVersions: { read: 1, respelled: 0, reduced: 1, refused: 0, reducedIds: ['6f0000000000000000000f01'], refusedIds: [] },
        });
    });

    it('reads and never writes, and prints counts and ids but no text', async () => {
        seedRows();
        const before = JSON.stringify(mockDb.store);
        const lines = [];
        audit.print(await audit.auditCompanies([C]), (line) => lines.push(line));
        expect(JSON.stringify(mockDb.store)).toBe(before);
        expect([...new Set(mockDb.calls.map((made) => made.method))]).toEqual(['find']);
        expect(mockDb.calls.every((made) => made.companyId === C)).toBe(true);
        expect(lines[0]).toBe(`company ${C}`);
        expect(lines.at(-1)).toBe('total: read 11  respelled 1  reduced 5  refused 1');
        expect(lines.join('\n')).not.toMatch(/__ran|Plan|words|Weekly|spec/);
    });

    it('takes the companies from the database when none is named', async () => {
        mockDb.seed(SCHEMA_TYPE.COMPANIES, { _id: C });
        const reports = await audit.auditCompanies();
        expect(reports.map((report) => report.companyId)).toEqual([C]);
        expect(mockDb.calls[0]).toMatchObject({ companyId: SCHEMA_TYPE.GOLBAL, type: SCHEMA_TYPE.COMPANIES, method: 'find' });
    });
});
