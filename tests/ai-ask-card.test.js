const mockDbs = {};
const mockDbFor = (companyId) => {
    const id = String(companyId);
    if (!mockDbs[id]) mockDbs[id] = require('./fixtures/fakeMongo').create();
    return mockDbs[id];
};

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(companyId).crud(companyId, q, method) }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjects: jest.fn(), visibleProjectIds: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider', () => ({ getProvider: jest.fn(), isAnyProviderConfigured: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async () => 3), isPrivileged: (roleType) => roleType === 1 || roleType === 2 }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: jest.fn(), set: jest.fn(), del: jest.fn(), getTtl: jest.fn() } }));
jest.mock('../Modules/settings/securityPermissions/controller', () => ({ fetchRules: jest.fn(async () => []) }));
jest.mock('../Modules/Knowledge/flag', () => ({ enabledFor: jest.fn(async () => false) }));
jest.mock('../Modules/Knowledge/askSources', () => ({ askSources: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { schema } = require('../utils/mongo-handler/schema');
const { visibleProjects, visibleProjectIds } = require('../Modules/Agents/scope');
const knowledgeFlag = require('../Modules/Knowledge/flag');
const { askSources } = require('../Modules/Knowledge/askSources');
const { getProvider, isAnyProviderConfigured } = require('../Modules/AICore/llmProvider');
const askCard = require('../Modules/AI/askCard');
const cardStore = require('../Modules/AI/askCardStore');
const dashboards = require('../Modules/UserDashboard/controller');

const C = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const ALICE = '6f0000000000000000000011';
const BOB = '6f0000000000000000000012';
const CAROL = '6f0000000000000000000013';
const OPS = '6f0000000000000000000a01';
const HR = '6f0000000000000000000a02';
const SHARED = '6f0000000000000000000d01';
const PRIVATE = '6f0000000000000000000d02';
const CARD = '111222333';
const ANSWERS = SCHEMA_TYPE.DASHBOARD_CARD_ANSWERS;
const QUESTION = 'What is the budget?';
const HOUR = 60 * 60 * 1000;

const db = (companyId = C) => mockDbFor(companyId);
const kept = (companyId = C) => db(companyId).store[ANSWERS] || [];
const keptFor = (uid) => kept().filter((row) => row.userId === uid);

const jsonRes = () => {
    const res = { statusCode: 200 };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.send = jest.fn((body) => { res.body = body; return res; });
    res.json = res.send;
    return res;
};

const call = async (handler, { uid = ALICE, companyId = C, dashboardId = SHARED, cardUid = CARD, body = {}, apiToken, query = {} } = {}) => {
    const res = jsonRes();
    await handler({ headers: { companyid: companyId }, uid, params: { dashboardId, cardUid, id: dashboardId }, body, apiToken, query }, res);
    return res;
};
const read = (options) => call(askCard.readAnswer, options);
const ask = (options = {}) => call(askCard.askAnswer, { ...options, body: { question: QUESTION, ...(options.body || {}) } });

const askCardOn = (uid = CARD, cardData = { question: QUESTION }) => ({ componentId: 'AskAQuestionCard', cardId: '', uid, config: { cardData, filterData: [], position: {} } });

const seedDashboard = (over = {}) => db(over.companyId || C).seed(SCHEMA_TYPE.USERDASHBOARD, {
    _id: SHARED, userId: ALICE, ownerId: ALICE, visibility: 'workspace', sharedWith: [], title: 'Team', isDeleted: false, cards: [askCardOn()], ...over,
});

const seedTask = (projectId, over = {}) => db().seed(SCHEMA_TYPE.TASKS, {
    TaskName: 'Budget review', TaskKey: 'OPS-1', statusType: 'open', ProjectID: projectId, deletedStatusKey: 0, updatedAt: new Date('2026-09-01T00:00:00Z'), ...over,
});

const answering = (reply = (uid) => `It is 12k for ${uid} [OPS-1].`) => {
    const chat = jest.fn(async (opts) => ({ content: reply(opts.spend.userId), totalTokens: 42, model: 'm-1' }));
    getProvider.mockReturnValue({ chat });
    return chat;
};

const age = (uid, hours, extra = {}) => {
    const row = kept().find((r) => r.userId === uid);
    Object.assign(row, { askedAt: new Date(Date.now() - hours * HOUR), ...extra });
    return row;
};

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => { delete mockDbs[key]; });
    jest.clearAllMocks();
    isAnyProviderConfigured.mockReturnValue(true);
    visibleProjects.mockResolvedValue([{ _id: OPS, ProjectName: 'Ops' }]);
    visibleProjectIds.mockResolvedValue([OPS]);
    knowledgeFlag.enabledFor.mockResolvedValue(false);
    seedDashboard();
    seedTask(OPS);
});

describe('the kept card answer collection', () => {
    it('is registered and declares every field a kept answer stores, so the strict schema drops none', () => {
        expect(ANSWERS).toBe('dashboard_card_answers');
        const { dbCollections } = require('../Config/collections');
        expect(dbCollections.DASHBOARD_CARD_ANSWERS).toBe('dashboard_card_answers');
        const { checkType, tableType } = jest.requireActual('../utils/mongo-handler/mongoQueries');
        const createSchema = require('../utils/mongo-handler/createSchema');
        expect(checkType(ANSWERS)).toBe(createSchema.dashboardCardAnswersSchema);
        expect(tableType(ANSWERS)).toBe('dashboard_card_answers');
        expect(createSchema.dashboardCardAnswersSchema.options.strict).toBe(true);
        expect(createSchema.dashboardCardAnswersSchema.indexes().some(([fields, options]) => options.unique
            && Object.keys(fields).join() === 'dashboardId,cardUid,userId')).toBe(true);

        const declared = Object.keys(schema.dashboardCardAnswers);
        ['dashboardId', 'cardUid', 'userId', 'question', 'projectId', 'answer', 'cited', 'askedAt', 'autoAskedAt'].forEach((field) => expect(declared).toContain(field));
        ['kind', 'sourceId', 'ref'].forEach((field) => expect(Object.keys(schema.dashboardCardAnswers.cited.type[0])).toContain(field));
    });

    it('writes only fields the schema declares', async () => {
        answering();
        await ask();
        age(ALICE, 30);
        getProvider.mockReturnValue({ chat: jest.fn(async () => { throw new Error('down'); }) });
        await ask();
        const declared = [...Object.keys(schema.dashboardCardAnswers), '_id'];
        kept().forEach((row) => Object.keys(row).forEach((field) => expect(declared).toContain(field)));
        expect(kept()[0].autoAskedAt).toBeInstanceOf(Date);
    });
});

describe('opening a dashboard with an Ask card', () => {
    it('asks the model once, keeps the answer, and hands it back on every later open', async () => {
        const chat = answering();
        expect((await read()).body.data).toEqual({ stored: null, stale: false, refreshDue: false });

        const first = await ask();
        expect(first.body.status).toBe(true);
        expect(first.body.data.answer).toContain('12k');
        expect(typeof first.body.data.askedAt).toBe('number');

        const again = await ask();
        const third = await ask();
        expect(chat).toHaveBeenCalledTimes(1);
        expect(again.body.data).toMatchObject({ kept: true, configured: true, answer: first.body.data.answer, askedAt: first.body.data.askedAt });
        expect(third.body.data.kept).toBe(true);

        const opened = await read();
        expect(chat).toHaveBeenCalledTimes(1);
        expect(opened.body.data).toMatchObject({ stale: false, refreshDue: false });
        expect(opened.body.data.stored).toMatchObject({ question: QUESTION, projectId: '', answer: first.body.data.answer, askedAt: first.body.data.askedAt });
        expect(opened.body.data.stored.cited).toEqual([expect.objectContaining({ kind: 'task', ref: 'OPS-1', title: 'Budget review', available: true })]);
        expect(kept()).toHaveLength(1);
    });

    it('asks again when the person refreshes, and replaces the kept answer', async () => {
        const chat = answering();
        await ask();
        getProvider.mockReturnValue({ chat: chat.mockImplementation(async () => ({ content: 'Now 15k [OPS-1].', totalTokens: 7, model: 'm-1' })) });
        const fresh = await ask({ body: { fresh: true } });
        expect(chat).toHaveBeenCalledTimes(2);
        expect(fresh.body.data.answer).toBe('Now 15k [OPS-1].');
        expect(kept()).toHaveLength(1);
        expect((await read()).body.data.stored.answer).toBe('Now 15k [OPS-1].');
    });

    it('asks again when the question or the project it searches changes', async () => {
        const chat = answering();
        await ask();
        await ask({ body: { question: 'Who reviews the budget?' } });
        expect(chat).toHaveBeenCalledTimes(2);
        await ask({ body: { question: 'Who reviews the budget?', projectId: OPS } });
        expect(chat).toHaveBeenCalledTimes(3);
        await ask({ body: { question: 'Who reviews the budget?', projectId: OPS } });
        expect(chat).toHaveBeenCalledTimes(3);
        expect(kept()).toHaveLength(1);
        expect(kept()[0]).toMatchObject({ question: 'Who reviews the budget?', projectId: OPS });
    });

    it('keeps nothing when the model was never called', async () => {
        const chat = answering();
        const none = await ask({ body: { question: 'zzzz qqqq' } });
        expect(none.body.data).toMatchObject({ answer: '', emptyCode: 'no_match' });
        isAnyProviderConfigured.mockReturnValue(false);
        const unconfigured = await ask();
        expect(unconfigured.body.data.configured).toBe(false);
        expect(chat).not.toHaveBeenCalled();
        expect(kept()).toHaveLength(0);
    });

    it('refuses an empty question without asking', async () => {
        const chat = answering();
        const res = await ask({ body: { question: '   ' } });
        expect(res.body).toMatchObject({ status: false, code: 'question_required' });
        expect(chat).not.toHaveBeenCalled();
    });

    it('answers a failed ask the way the ask route does, and keeps nothing', async () => {
        const error = Object.assign(new Error('Budget used'), { code: 'ai_budget_exhausted' });
        getProvider.mockReturnValue({ chat: jest.fn(async () => { throw error; }) });
        const res = await ask();
        expect(res.body).toEqual({ status: false, statusText: 'Budget used', code: 'ai_budget_exhausted' });
        expect(kept()).toHaveLength(0);
    });
});

describe('an answer past the limit the card sets', () => {
    it('is handed back marked as old, and one open may ask for a new one', async () => {
        const chat = answering();
        await ask();
        age(ALICE, 30);

        const opened = await read();
        expect(opened.body.data).toMatchObject({ stale: true, refreshDue: true });
        expect(opened.body.data.stored.answer).toContain('12k');

        const renewed = await ask();
        expect(chat).toHaveBeenCalledTimes(2);
        expect(renewed.body.data.kept).toBeUndefined();
        expect((await read()).body.data).toMatchObject({ stale: false, refreshDue: false });
    });

    it('lets opens ask at most once per limit when that ask fails', async () => {
        answering();
        await ask();
        age(ALICE, 30);
        const failing = jest.fn(async () => { throw new Error('down'); });
        getProvider.mockReturnValue({ chat: failing });

        const failedOnce = await ask();
        expect(failedOnce.body.status).toBe(false);
        const second = await ask();
        const third = await ask();
        expect(failing).toHaveBeenCalledTimes(1);
        expect(second.body.data).toMatchObject({ kept: true });
        expect(second.body.data.answer).toContain('12k');
        expect(third.body.data.kept).toBe(true);
        expect((await read()).body.data).toMatchObject({ stale: true, refreshDue: false });

        age(ALICE, 30, { autoAskedAt: new Date(Date.now() - 25 * HOUR) });
        expect((await read()).body.data.refreshDue).toBe(true);
        await ask();
        expect(failing).toHaveBeenCalledTimes(2);
    });

    it('still asks when the person refreshes, whatever the last automatic ask did', async () => {
        const chat = answering();
        await ask();
        age(ALICE, 30, { autoAskedAt: new Date() });
        await ask({ body: { fresh: true } });
        expect(chat).toHaveBeenCalledTimes(2);
    });

    it('uses the limit saved on the card: a day unless set, an hour when chosen, and none for "never"', async () => {
        const chat = answering();
        await ask();
        const dashboard = db().store[SCHEMA_TYPE.USERDASHBOARD][0];

        age(ALICE, 2);
        expect((await read()).body.data.stale).toBe(false);

        dashboard.cards = [askCardOn(CARD, { question: QUESTION, refreshAfter: '1' })];
        expect((await read()).body.data).toMatchObject({ stale: true, refreshDue: true });

        dashboard.cards = [askCardOn(CARD, { question: QUESTION, refreshAfter: 'never' })];
        age(ALICE, 24 * 400);
        expect((await read()).body.data).toMatchObject({ stale: false, refreshDue: false });
        expect((await ask()).body.data.kept).toBe(true);
        expect(chat).toHaveBeenCalledTimes(1);

        dashboard.cards = [askCardOn(CARD, { question: QUESTION, refreshAfter: 'soon' })];
        expect(askCard.limitOf({ refreshAfter: 'soon' })).toBe(24 * HOUR);
        expect((await read()).body.data.stale).toBe(true);
    });
});

describe('who a kept answer belongs to', () => {
    it('keeps one answer per viewer of a shared dashboard, each read back only by its own viewer', async () => {
        const chat = answering();
        const alice = await ask({ uid: ALICE });
        expect(alice.body.data.answer).toContain(ALICE);

        expect((await read({ uid: BOB })).body.data).toEqual({ stored: null, stale: false, refreshDue: false });

        const bob = await ask({ uid: BOB });
        expect(chat).toHaveBeenCalledTimes(2);
        expect(chat.mock.calls[1][0].spend.userId).toBe(BOB);
        expect(bob.body.data.kept).toBeUndefined();
        expect(bob.body.data.answer).toContain(BOB);
        expect(bob.body.data.answer).not.toContain(ALICE);

        expect((await read({ uid: BOB })).body.data.stored.answer).toBe(bob.body.data.answer);
        expect((await read({ uid: ALICE })).body.data.stored.answer).toBe(alice.body.data.answer);
        expect(keptFor(ALICE)).toHaveLength(1);
        expect(keptFor(BOB)).toHaveLength(1);
    });

    it('takes the viewer from the session alone', async () => {
        answering();
        await ask({ uid: ALICE });
        const named = { userId: ALICE, uid: ALICE, viewerId: ALICE };
        expect((await read({ uid: BOB, body: named, query: named })).body.data.stored).toBeNull();
        const asked = await ask({ uid: BOB, body: named });
        expect(asked.body.data.kept).toBeUndefined();
        expect(asked.body.data.answer).toContain(BOB);
        expect(keptFor(ALICE)).toHaveLength(1);
        expect(keptFor(ALICE)[0].answer).toContain(ALICE);
    });

    it('answers "not found" for a dashboard the caller cannot open, and asks nothing', async () => {
        const chat = answering();
        seedDashboard({ _id: PRIVATE, visibility: 'private', title: 'Mine' });
        await ask({ uid: ALICE, dashboardId: PRIVATE });
        expect(chat).toHaveBeenCalledTimes(1);

        const readBack = await read({ uid: BOB, dashboardId: PRIVATE });
        const asked = await ask({ uid: BOB, dashboardId: PRIVATE });
        [readBack, asked].forEach((res) => {
            expect(res.statusCode).toBe(404);
            expect(res.body).toMatchObject({ status: false, code: 'card_not_found' });
            expect(JSON.stringify(res.body)).not.toContain('12k');
        });
        expect(chat).toHaveBeenCalledTimes(1);
        expect(keptFor(BOB)).toHaveLength(0);

        db().store[SCHEMA_TYPE.USERDASHBOARD].find((d) => d._id === PRIVATE).sharedWith = [BOB];
        expect((await read({ uid: BOB, dashboardId: PRIVATE })).body.data.stored).toBeNull();
    });

    it('answers the same "not found" for a missing dashboard, a deleted one, a card that is not on it and a card of another kind', async () => {
        const chat = answering();
        seedDashboard({ _id: PRIVATE, isDeleted: true });
        const dashboard = db().store[SCHEMA_TYPE.USERDASHBOARD][0];
        dashboard.cards.push({ componentId: 'VelocityCard', uid: '999', config: { cardData: {} } });
        const misses = [
            await ask({ dashboardId: '6f0000000000000000000dff' }),
            await ask({ dashboardId: 'nope' }),
            await ask({ dashboardId: PRIVATE }),
            await ask({ cardUid: '424242' }),
            await ask({ cardUid: '999' }),
            await ask({ cardUid: '../x' }),
            await read({ cardUid: '424242' }),
        ];
        misses.forEach((res) => {
            expect(res.statusCode).toBe(404);
            expect(res.body.code).toBe('card_not_found');
        });
        expect(chat).not.toHaveBeenCalled();
        expect(kept()).toHaveLength(0);
    });

    it('stays inside its workspace', async () => {
        answering();
        await ask();
        seedDashboard({ companyId: OTHER_COMPANY });
        expect((await read({ companyId: OTHER_COMPANY })).body.data.stored).toBeNull();
        expect(kept(OTHER_COMPANY)).toHaveLength(0);
    });

    it('refuses a token limited to some projects', async () => {
        const chat = answering();
        const res = await ask({ apiToken: { projectIds: [OPS] } });
        expect(res.statusCode).toBe(403);
        expect(res.body.code).toBe('token_limited_to_projects');
        expect(chat).not.toHaveBeenCalled();
    });

    it('needs a signed-in caller', async () => {
        const res = await read({ uid: '' });
        expect(res.statusCode).toBe(401);
    });

    it('leaves out a cited source its reader can no longer open', async () => {
        answering();
        await ask();
        expect((await read()).body.data.stored.cited).toHaveLength(1);
        visibleProjects.mockResolvedValue([{ _id: HR, ProjectName: 'HR' }]);
        const later = (await read()).body.data.stored;
        expect(later.cited).toEqual([]);
        expect(JSON.stringify(later.cited)).not.toContain('Budget review');
    });

    describe('a cited passage of the knowledge store', () => {
        const passage = (comment) => ({
            kind: 'comment', id: String(comment._id), ref: `comment:${String(comment._id).slice(-6)}`, title: 'The budget is 12k', project: 'Ops', projectId: OPS,
            detail: 'The budget is 12k', updatedAt: new Date('2026-09-01T00:00:00Z'), permission: { visibility: 'project', via: 'task' }, origin: 'chunk',
        });
        const withPassage = () => {
            const task = db().store[SCHEMA_TYPE.TASKS][0];
            const comment = db().seed(SCHEMA_TYPE.COMMENTS, {
                _id: new (require('mongoose').Types.ObjectId)('6f0000000000000000000e01'), taskId: task._id, projectId: OPS, userId: BOB,
                message: 'The budget is 12k', type: 'text', updatedAt: new Date('2026-09-02T00:00:00Z'),
            });
            knowledgeFlag.enabledFor.mockResolvedValue(true);
            askSources.mockResolvedValue([passage(comment)]);
            answering(() => `It is 12k [${passage(comment).ref}].`);
            return { task, comment };
        };

        it('is kept by its source id and listed again on a later open, read from the live row', async () => {
            const { comment } = withPassage();
            await ask();
            expect(kept()[0].cited).toEqual([{ kind: 'comment', sourceId: String(comment._id), ref: passage(comment).ref }]);

            const later = (await read()).body.data.stored;
            expect(later.cited).toEqual([expect.objectContaining({ kind: 'comment', id: String(comment._id), ref: passage(comment).ref, title: 'The budget is 12k', available: true })]);
        });

        it('is left out once the reader can no longer retrieve it', async () => {
            const { comment } = withPassage();
            await ask();
            expect((await read()).body.data.stored.cited).toHaveLength(1);

            visibleProjectIds.mockResolvedValue([HR]);
            const moved = (await read()).body.data.stored;
            expect(moved.cited).toEqual([]);
            expect(JSON.stringify(moved.cited)).not.toContain('12k');

            visibleProjectIds.mockResolvedValue([OPS]);
            db().store[SCHEMA_TYPE.COMMENTS].find((row) => String(row._id) === String(comment._id)).isDeleted = true;
            expect((await read()).body.data.stored.cited).toEqual([]);
        });
    });

    it('keeps the ids of what it cited, not their titles', async () => {
        answering();
        await ask();
        expect(kept()[0].cited).toEqual([{ kind: 'task', sourceId: expect.any(String), ref: 'OPS-1' }]);
    });
});

describe('when kept answers go', () => {
    const save = (cards) => call(dashboards.updateSharedDashboardCards, { uid: ALICE, body: { cards } });

    it('drops the answers of a card that leaves the dashboard, and keeps the others', async () => {
        answering();
        const dashboard = db().store[SCHEMA_TYPE.USERDASHBOARD][0];
        dashboard.cards.push(askCardOn('444555666'));
        await ask({ uid: ALICE });
        await ask({ uid: BOB });
        await ask({ uid: ALICE, cardUid: '444555666' });
        expect(kept()).toHaveLength(3);

        await save([{ ...askCardOn('444555666') }]);
        expect(kept().map((row) => row.cardUid)).toEqual(['444555666']);

        await save([]);
        expect(kept()).toHaveLength(0);
    });

    it('drops every answer of a deleted dashboard', async () => {
        answering();
        seedDashboard({ _id: PRIVATE, visibility: 'workspace' });
        await ask({ uid: ALICE });
        await ask({ uid: BOB });
        await ask({ uid: CAROL, dashboardId: PRIVATE });
        await call(dashboards.deleteSharedDashboard, { uid: ALICE });
        expect(kept().map((row) => row.dashboardId)).toEqual([PRIVATE]);
    });

    it('erases one person\'s kept answers and nobody else\'s', async () => {
        answering();
        await ask({ uid: ALICE });
        await ask({ uid: BOB });
        expect(await cardStore.hasAnswers(C, ALICE)).toBe(true);
        expect(await cardStore.eraseViewer(C, ALICE)).toBe(1);
        expect(await cardStore.hasAnswers(C, ALICE)).toBe(false);
        expect(keptFor(BOB)).toHaveLength(1);
        await expect(cardStore.eraseViewer(C, 'everyone')).rejects.toThrow(/valid user id/);
        await expect(cardStore.eraseViewer(C, '')).rejects.toThrow(/valid user id/);
    });
});
