const verified = require('./fixtures/verifiedRequest');
const fakeMongo = require('./fixtures/fakeMongo');
const world = require('./fixtures/pageReachWorld');

let mockDb;
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../socket/helper', () => ({ findRoomsByPrefix: jest.fn(() => []) }));
jest.mock('../Modules/Pages/helpers/pageAi', () => ({ composePage: jest.fn(), isAiConfigured: () => false }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({
    handleSingleNotification: jest.fn(async () => []),
    handleNotificationtFun: jest.fn(async () => ({ status: true })),
}));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { Notification_key, DOC_NOTICE_SECTION } = require('../Config/notificationKey');
const { visibleProjectIds } = require('../Config/contentAccess');
const socketEmitter = require('../event/socketEventEmitter');
const { findRoomsByPrefix } = require('../socket/helper');
const notices = require('../Modules/notification/prepare-notification-data/controllerV2');
const { forgetHealedDocNotices } = require('../Modules/notification/docNotices');
const pages = require('../Modules/Pages/controller');
const shares = require('../Modules/Pages/shares');
const pageComments = require('../Modules/Pages/comments');
const { canUsePage, canManageShares } = require('../Modules/Pages/helpers/pageAccess');
const { MAX_PAGE_SHARES } = require('../Modules/Pages/helpers/pageRules');
const { explain } = require('../Modules/WhoCanSee/helpers/explain');
const { publicSources } = require('../Modules/AI/publicSources');
const { READERS } = require('../Modules/Agents/skills/readers');
const renderer = require('../Modules/PublicShares/publicRenderer');
const shareRelay = require('../socket/controller/pageShareSocket');
const { docMentionEmail, isDocMention } = require('../Modules/notification/sendEmail/docMentionEmail');

const { C, PEOPLE, PROJECTS, PAGES } = world;
const SEATLESS = 'a000000000000000000000af';
const STRANGER = 'a000000000000000000000ee';

const call = async (handler, { uid, params = {}, body = {}, query = {} }) => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (sent) => { res.body = sent; return res; };
    res.json = res.send;
    res.set = () => res;
    res.setHeader = () => res;
    res.type = () => res;
    res.header = () => res;
    await handler(verified({ uid, params, body, query, headers: { companyid: C } }), res);
    return res.body;
};

const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

const stored = (pageId) => mockDb.store[SCHEMA_TYPE.PAGES].find((page) => String(page._id) === pageId);
const namedOn = (pageId) => (stored(pageId).sharedWith || []).map((share) => `${world.nameOfPerson(share.userId)}:${share.role}`);

const list = (who, pageId) => call(shares.listShares, { uid: PEOPLE[who] || who, params: { id: pageId } });
const name = (who, pageId, target, role) => call(shares.putShare, { uid: PEOPLE[who] || who, params: { id: pageId, userId: PEOPLE[target] || target }, body: role ? { role } : {} });
const remove = (who, pageId, target) => call(shares.removeShare, { uid: PEOPLE[who] || who, params: { id: pageId, userId: PEOPLE[target] || target } });
const open = (who, pageId) => call(pages.getPage, { uid: PEOPLE[who] || who, params: { id: pageId } });
const save = (who, pageId, body) => call(pages.updatePage, { uid: PEOPLE[who] || who, params: { id: pageId }, body });

const endSeat = (who) => {
    mockDb.store[SCHEMA_TYPE.COMPANY_USERS].find((seat) => seat.userId === PEOPLE[who]).isDelete = true;
    myCache.flushAll();
};

beforeEach(() => {
    myCache.flushAll();
    jest.clearAllMocks();
    forgetHealedDocNotices();
    mockDb = fakeMongo.create();
    world.seed(mockDb);
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: SEATLESS, roleType: 3, status: 2, isDelete: true });
});

describe('a doc shared with people by name: what the share gives', () => {
    const page = (pageId) => stored(pageId);

    it('a named person reaches the page: a viewer reads it, an editor reads and changes it', async () => {
        expect(await canUsePage(C, page(PAGES.namedView), PEOPLE.viewer)).toBe(true);
        expect(await canUsePage(C, page(PAGES.namedView), PEOPLE.viewer, { edit: true })).toBe(false);
        expect(await canUsePage(C, page(PAGES.namedEdit), PEOPLE.editor)).toBe(true);
        expect(await canUsePage(C, page(PAGES.namedEdit), PEOPLE.editor, { edit: true })).toBe(true);
    });

    it('reaches nobody who is not named, and nothing when the share is left out', async () => {
        for (const who of ['outside', 'guest', 'editor', 'owner', 'admin']) {
            expect(await canUsePage(C, page(PAGES.namedView), PEOPLE[who])).toBe(false);
        }
        expect(await canUsePage(C, page(PAGES.namedView), PEOPLE.viewer, { named: false })).toBe(false);
        expect(await canUsePage(C, page(PAGES.namedEdit), PEOPLE.editor, { edit: true, named: false })).toBe(false);
    });

    it('ends with the seat, read on every call', async () => {
        endSeat('viewer');
        expect(await canUsePage(C, page(PAGES.namedView), PEOPLE.viewer)).toBe(false);
        expect((await open('viewer', PAGES.namedView)).status).toBe(false);
        expect((await call(pages.listPages, { uid: PEOPLE.viewer, query: { scope: 'all' } })).data).toEqual([]);
        expect((await call(pages.listPages, { uid: PEOPLE.viewer, query: { scope: 'shared' } })).data).toEqual([]);
    });

    it('gives the page alone: not its project, its parent, its children or the other docs beside it', async () => {
        expect(await visibleProjectIds(C, PEOPLE.viewer)).not.toContain(PROJECTS.closed);
        expect(await canUsePage(C, page(PAGES.closed), PEOPLE.viewer)).toBe(false);

        page(PAGES.namedView).parentPageId = PAGES.closed;
        const child = mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Atlas child', visibility: 'private', createdBy: PEOPLE.inside, ProjectID: PROJECTS.closed, parentPageId: PAGES.namedView, deletedStatusKey: 0 });
        expect((await open('viewer', PAGES.closed)).status).toBe(false);
        expect((await open('viewer', String(child._id))).status).toBe(false);
        expect((await open('viewer', PAGES.namedView)).status).toBe(true);
    });

    it('lets the author manage the list, and an owner or admin where they can open the doc', async () => {
        const managers = async (pageId) => {
            const answers = {};
            for (const who of Object.keys(PEOPLE)) answers[who] = await canManageShares(C, page(pageId), PEOPLE[who]);
            return Object.keys(answers).filter((who) => answers[who]);
        };
        expect(await managers(PAGES.namedEdit)).toEqual(['owner', 'admin']);
        expect(await managers(PAGES.namedView)).toEqual(['inside']);
        expect(await managers(PAGES.shared)).toEqual(['owner', 'admin']);
        expect(await managers(PAGES.insidePrivate)).toEqual(['inside']);
    });
});

describe('a doc shared with people by name: the routes', () => {
    it('lists the people to the author, an owner and an admin', async () => {
        const expected = { status: true, data: { limit: MAX_PAGE_SHARES, people: [{ userId: PEOPLE.editor, role: 'editor', by: PEOPLE.owner, active: true }] } };
        expect(await list('owner', PAGES.namedEdit)).toMatchObject(expected);
        expect(await list('admin', PAGES.namedEdit)).toMatchObject(expected);
        expect(await list('inside', PAGES.namedView)).toMatchObject({ status: true, data: { people: [{ userId: PEOPLE.viewer, role: 'viewer' }] } });
    });

    it.each([
        ['a named editor', 'editor', PAGES.namedEdit, 403],
        ['a named viewer', 'viewer', PAGES.namedView, 403],
        ['a member of the project who is not the author', 'inside', PAGES.namedEdit, 403],
        ['a guest who can read the doc', 'guest', PAGES.shared, 403],
        ['a member outside the project', 'outside', PAGES.namedEdit, 404],
        ['an owner, for another person\'s private doc', 'owner', PAGES.namedView, 404],
        ['an admin, for another person\'s private doc', 'admin', PAGES.namedView, 404],
        ['someone whose seat ended', SEATLESS, PAGES.shared, 404],
    ])('refuses %s the list and every change to it', async (_what, who, pageId, statusCode) => {
        const before = JSON.stringify(stored(pageId).sharedWith || []);
        expect(await list(who, pageId)).toMatchObject({ status: false, statusCode });
        expect(await name(who, pageId, 'outside', 'viewer')).toMatchObject({ status: false, statusCode });
        expect(await remove(who, pageId, 'viewer')).toMatchObject({ status: false, statusCode });
        expect(JSON.stringify(stored(pageId).sharedWith || [])).toBe(before);
        expect(socketEmitter.emit).not.toHaveBeenCalled();
    });

    it('names a person, who then opens the doc, and changes their role without naming them twice', async () => {
        expect((await open('outside', PAGES.namedView)).status).toBe(false);

        expect(await name('inside', PAGES.namedView, 'outside')).toMatchObject({ status: true });
        expect(namedOn(PAGES.namedView)).toEqual(['viewer:viewer', 'outside:viewer']);
        expect(stored(PAGES.namedView).sharedWith[1]).toMatchObject({ by: PEOPLE.inside, at: expect.any(Date) });
        expect((await open('outside', PAGES.namedView)).status).toBe(true);
        expect((await save('outside', PAGES.namedView, { title: 'Taken' })).status).toBe(false);

        expect(await name('inside', PAGES.namedView, 'outside', 'editor')).toMatchObject({ status: true });
        expect(namedOn(PAGES.namedView)).toEqual(['viewer:viewer', 'outside:editor']);
        expect((await save('outside', PAGES.namedView, { title: 'Agreed' })).status).toBe(true);
        expect(stored(PAGES.namedView)).toMatchObject({ title: 'Agreed', visibility: 'private', createdBy: PEOPLE.inside });
    });

    it('removes a person, who loses the doc on the next request', async () => {
        expect((await open('viewer', PAGES.namedView)).status).toBe(true);
        expect(await remove('inside', PAGES.namedView, 'viewer')).toMatchObject({ status: true, data: { people: [] } });
        expect((await open('viewer', PAGES.namedView)).status).toBe(false);
        expect((await call(pages.listPages, { uid: PEOPLE.viewer, query: { scope: 'shared' } })).data).toEqual([]);
        expect(await remove('inside', PAGES.namedView, 'viewer')).toMatchObject({ status: true, data: { people: [] } });
    });

    it('names only someone who holds a seat, in a role it knows', async () => {
        for (const target of [SEATLESS, STRANGER, 'not-an-id']) {
            expect(await name('owner', PAGES.namedEdit, target, 'viewer')).toMatchObject({ status: false, statusCode: 400 });
        }
        expect(await name('owner', PAGES.namedEdit, 'outside', 'owner')).toMatchObject({ status: false, statusCode: 400 });
        expect(namedOn(PAGES.namedEdit)).toEqual(['editor:editor']);
    });

    it('names a guest, who reads docs like any other seat', async () => {
        expect(await name('inside', PAGES.namedView, 'guest', 'viewer')).toMatchObject({ status: true });
        expect((await open('guest', PAGES.namedView)).status).toBe(true);
        expect((await open('guest', PAGES.closed)).status).toBe(false);
    });

    it('shows a person whose seat ended as no longer active, and gives them nothing', async () => {
        endSeat('editor');
        expect((await list('owner', PAGES.namedEdit)).data.people).toEqual([expect.objectContaining({ userId: PEOPLE.editor, active: false })]);
        expect((await open('editor', PAGES.namedEdit)).status).toBe(false);
        expect((await save('editor', PAGES.namedEdit, { title: 'Taken' })).status).toBe(false);
    });

    it('stops at the limit, and still changes a role beyond it', async () => {
        const filler = Array.from({ length: MAX_PAGE_SHARES - 1 }, (_, index) => ({ userId: `f${String(index).padStart(23, '0')}`, role: 'viewer', by: PEOPLE.owner, at: new Date() }));
        stored(PAGES.namedEdit).sharedWith.push(...filler);

        expect(await name('owner', PAGES.namedEdit, 'outside', 'viewer')).toMatchObject({ status: false, statusCode: 400 });
        expect(stored(PAGES.namedEdit).sharedWith).toHaveLength(MAX_PAGE_SHARES);
        expect(await name('owner', PAGES.namedEdit, 'editor', 'viewer')).toMatchObject({ status: true });
        expect(stored(PAGES.namedEdit).sharedWith[0]).toMatchObject({ userId: PEOPLE.editor, role: 'viewer' });
    });

    it('announces the page change, and tells the person alone that their docs changed', async () => {
        await name('inside', PAGES.namedView, 'outside', 'viewer');
        expect(socketEmitter.emit).toHaveBeenCalledWith('update', expect.objectContaining({ module: 'pages', companyId: C, data: expect.objectContaining({ _id: PAGES.namedView }) }));
        expect(socketEmitter.emit).toHaveBeenCalledWith('update', { type: 'update', module: 'pageShares', companyId: C, data: { userId: PEOPLE.outside } });

        socketEmitter.emit.mockClear();
        await remove('inside', PAGES.namedView, 'outside');
        expect(socketEmitter.emit).toHaveBeenCalledWith('update', expect.objectContaining({ module: 'pages' }));
        expect(socketEmitter.emit).toHaveBeenCalledWith('update', expect.objectContaining({ module: 'pageShares', data: { userId: PEOPLE.outside } }));
    });
});

describe('a doc shared with people by name: what a named person may do', () => {
    it('an editor changes the title and the body, and nothing else about the doc', async () => {
        expect((await save('editor', PAGES.namedEdit, { title: 'Agreed', contentHtml: '<p>New text</p>' })).status).toBe(true);
        expect(stored(PAGES.namedEdit)).toMatchObject({ title: 'Agreed', rawText: 'New text' });

        for (const body of [{ visibility: 'private' }, { visibility: 'project' }, { isWiki: true }, { ownerId: PEOPLE.editor }, { linkedTasks: [] }, { title: 'Both', isWiki: true }]) {
            expect(await save('editor', PAGES.namedEdit, body)).toMatchObject({ status: false, statusCode: 403 });
        }
        expect(stored(PAGES.namedEdit)).toMatchObject({ title: 'Agreed', visibility: 'project', linkedTasks: [world.TASK] });
        expect(stored(PAGES.namedEdit).isWiki).toBeFalsy();
    });

    it('an editor does not delete the doc, restore it, review it or approve it', async () => {
        const id = PAGES.namedEdit;
        expect((await call(pages.deletePage, { uid: PEOPLE.editor, params: { id } })).status).toBe(false);
        expect((await call(pages.markReviewed, { uid: PEOPLE.editor, params: { id } })).status).toBe(false);
        stored(id).createdByAgent = true;
        expect((await call(pages.approvePage, { uid: PEOPLE.editor, params: { id } })).status).toBe(false);
        expect(stored(id)).toMatchObject({ deletedStatusKey: 0 });
        expect(stored(id).agentStatus).toBeUndefined();

        stored(id).deletedStatusKey = 1;
        expect((await call(pages.restorePage, { uid: PEOPLE.editor, params: { id } })).status).toBe(false);
        expect(stored(id).deletedStatusKey).toBe(1);
        expect((await call(pages.restorePage, { uid: PEOPLE.owner, params: { id } })).status).toBe(true);
    });

    it('a viewer changes nothing', async () => {
        expect((await save('viewer', PAGES.namedView, { title: 'Taken' })).status).toBe(false);
        expect((await call(pages.deletePage, { uid: PEOPLE.viewer, params: { id: PAGES.namedView } })).status).toBe(false);
        expect(stored(PAGES.namedView)).toMatchObject({ title: 'Atlas namedView', deletedStatusKey: 0 });
    });

    it('is told the doc is shared with them, and only a manager is told with how many', async () => {
        const asViewer = (await open('viewer', PAGES.namedView)).data;
        expect(asViewer).toMatchObject({ sharedWithMe: 'viewer', canManageShares: false });
        expect(asViewer.sharedWith).toBeUndefined();
        expect(asViewer.sharedCount).toBeUndefined();

        const asAuthor = (await open('inside', PAGES.namedView)).data;
        expect(asAuthor).toMatchObject({ sharedWithMe: '', canManageShares: true, sharedCount: 1 });
        expect(asAuthor.sharedWith).toBeUndefined();

        const saved = (await save('editor', PAGES.namedEdit, { title: 'Agreed' })).data;
        expect(saved).toMatchObject({ title: 'Agreed', sharedWithMe: 'editor', canManageShares: false });
        expect(saved.sharedWith).toBeUndefined();
    });

    it('is shown as named in who-can-see to the managers and to themselves, and to no other reader', async () => {
        const groups = async (who, pageId) => Object.fromEntries((await explain('page', C, pageId, PEOPLE[who])).groups.map((group) => [group.reason, group.userIds.map(world.nameOfPerson)]));

        expect(await groups('inside', PAGES.namedView)).toEqual({ author: ['inside'], named: ['viewer'] });
        expect(await groups('viewer', PAGES.namedView)).toEqual({ author: ['inside'], named: ['viewer'] });
        expect((await groups('owner', PAGES.namedEdit)).named).toEqual(['editor']);
        expect((await groups('inside', PAGES.namedEdit)).named).toBeUndefined();
        expect(await explain('page', C, PAGES.namedView, PEOPLE.outside)).toBeNull();
    });
});

describe('a doc shared with people by name: the notice', () => {
    const told = () => notices.handleSingleNotification.mock.calls.map(([notice]) => notice);

    it('tells a newly named person once, naming the doc and who shared it', async () => {
        await name('inside', PAGES.namedView, 'outside', 'viewer');
        await settle();

        expect(told()).toEqual([expect.objectContaining({
            key: Notification_key.DOC_SHARED,
            type: DOC_NOTICE_SECTION.key,
            companyId: C,
            userId: PEOPLE.inside,
            assigneeUsers: [PEOPLE.outside],
            directUsers: [PEOPLE.outside],
            changeType: 'doc_shared',
            changeData: { pageId: PAGES.namedView, pageTitle: 'Atlas namedView', role: 'viewer' },
        })]);
        expect(told()[0].projectId).toBeUndefined();
        expect(DOC_NOTICE_SECTION.items.find((item) => item.key === Notification_key.DOC_SHARED)).toMatchObject({ email: false, browser: true, mobile: true });
    });

    it('says nothing for a role change, for a person named again, or to the person who names themselves', async () => {
        await name('inside', PAGES.namedView, 'outside', 'viewer');
        await name('inside', PAGES.namedView, 'outside', 'editor');
        await remove('inside', PAGES.namedView, 'outside');
        await name('inside', PAGES.namedView, 'outside', 'viewer');
        await name('owner', PAGES.namedEdit, 'owner', 'viewer');
        await settle();

        expect(told()).toHaveLength(1);
        expect(stored(PAGES.namedView).sharesTold).toEqual([PEOPLE.outside]);
    });

    it('writes the email for a person who asked for one', () => {
        expect(isDocMention(Notification_key.DOC_SHARED)).toBe(true);
        const mail = docMentionEmail({ notification: { key: Notification_key.DOC_SHARED, companyId: C, User_Employee_Name: 'Ira', changeData: { pageId: PAGES.namedView, pageTitle: 'Atlas' } } });
        expect(mail.subject).toContain('Ira shared Atlas with you');
    });

    it('relays the change to the named person\'s own connections only', () => {
        const socketOf = (uid, companyId = C) => {
            const socket = { identity: { uid, companyId }, rooms: new Set(['room']), emit: jest.fn() };
            return { socket, roomName: 'room' };
        };
        const theirs = socketOf(PEOPLE.outside);
        const others = [socketOf(PEOPLE.inside), socketOf(PEOPLE.outside, 'c000000000000000000000c2')];
        findRoomsByPrefix.mockReturnValue([theirs, ...others]);

        shareRelay.relay({ type: 'update', module: 'pageShares', companyId: C, data: { userId: PEOPLE.outside } });

        expect(theirs.socket.emit).toHaveBeenCalledWith(shareRelay.EVENT, { type: 'update' });
        others.forEach((entry) => expect(entry.socket.emit).not.toHaveBeenCalled());
    });
});

describe('a doc shared with people by name: readers that take what every reader of a project can open', () => {
    const closed = [{ _id: PROJECTS.closed, ProjectName: 'Closed' }];

    it('Ask leaves a private doc out of the shared sources, named people or not', async () => {
        const found = await publicSources(C, { question: 'atlas', projects: closed });
        expect(world.named(found.filter((source) => source.kind === 'page'))).toEqual(['closed', 'namedEdit']);
    });

    it('an agent reading a project\'s docs, or the doc linked to a task, does not read it either', async () => {
        const listed = await READERS['project.pages'](C, { task: { ProjectID: PROJECTS.closed } }, { staleDays: 1, limit: 20, excerptChars: 80 });
        expect(listed.titles).toEqual(['Atlas closed', 'Atlas namedEdit']);

        const OTHER_TASK = 'd000000000000000000000d2';
        stored(PAGES.namedView).linkedTasks = [OTHER_TASK];
        expect(await READERS.linked_doc(C, { task: { _id: OTHER_TASK } }, { maxChars: 200 })).toEqual({ skip: 'no document is attached to this task' });
    });

    it('a public link does not serve it', async () => {
        const token = 'ab'.repeat(32);
        const link = mockDb.seed(SCHEMA_TYPE.PUBLIC_SHARES, { token, enabled: true, allowIntake: false, entityType: 'page', entityId: PAGES.namedView, createdBy: PEOPLE.inside });
        mockDb.seed(SCHEMA_TYPE.PUBLIC_SHARE_INDEX, { token, companyId: C, shareId: link._id });

        const served = () => call(renderer.renderShare, { uid: undefined, params: { token } });
        expect(String(await served())).not.toContain('Atlas namedView');

        stored(PAGES.namedView).visibility = 'project';
        expect(String(await served())).toContain('Atlas namedView');
    });
});

describe('what a person may do with a doc is said on the doc', () => {
    const canEdit = async (who, pageId) => (await open(who, pageId)).data.canEdit;

    it('tells each reader whether they may change it', async () => {
        expect(await canEdit('owner', PAGES.shared)).toBe(true);
        expect(await canEdit('outside', PAGES.shared)).toBe(true);
        expect(await canEdit('guest', PAGES.shared)).toBe(false);
        expect(await canEdit('guest', PAGES.company)).toBe(false);
        expect(await canEdit('viewer', PAGES.namedView)).toBe(false);
        expect(await canEdit('editor', PAGES.namedEdit)).toBe(true);
        expect(await canEdit('inside', PAGES.namedView)).toBe(true);
    });
});

describe('a guest reads the docs they reach', () => {
    const create = (who, body) => call(pages.createPage, { uid: PEOPLE[who], body });
    const pageCount = () => mockDb.store[SCHEMA_TYPE.PAGES].length;

    it('changes a doc only when it is shared with them as an editor', async () => {
        expect((await open('guest', PAGES.shared)).status).toBe(true);
        expect((await save('guest', PAGES.shared, { title: 'Taken' })).status).toBe(false);
        expect((await save('guest', PAGES.company, { title: 'Taken' })).status).toBe(false);

        await name('owner', PAGES.shared, 'guest', 'viewer');
        expect((await save('guest', PAGES.shared, { title: 'Taken' })).status).toBe(false);
        expect(stored(PAGES.shared).title).toBe('Atlas shared');

        await name('owner', PAGES.shared, 'guest', 'editor');
        expect((await save('guest', PAGES.shared, { title: 'Agreed' })).status).toBe(true);
        expect((await save('guest', PAGES.shared, { isWiki: true })).status).toBe(false);
        expect(stored(PAGES.shared)).toMatchObject({ title: 'Agreed' });
    });

    it('creates no doc, in a project or outside one', async () => {
        const before = pageCount();
        expect(await create('guest', { title: 'Mine', projectId: PROJECTS.open })).toMatchObject({ status: false, statusCode: 403 });
        expect(await create('guest', { title: 'Mine' })).toMatchObject({ status: false, statusCode: 403 });
        expect(await create('guest', { title: 'Mine', parentPageId: PAGES.shared })).toMatchObject({ status: false, statusCode: 403 });
        expect(pageCount()).toBe(before);
        expect((await create('outside', { title: 'Theirs', projectId: PROJECTS.open })).status).toBe(true);
    });

    it('deletes no doc, and does not choose who a doc of theirs is shared with', async () => {
        const own = mockDb.seed(SCHEMA_TYPE.PAGES, { title: 'Atlas early', visibility: 'project', createdBy: PEOPLE.guest, ProjectID: PROJECTS.open, deletedStatusKey: 0 });

        expect(await call(pages.deletePage, { uid: PEOPLE.guest, params: { id: PAGES.shared } })).toMatchObject({ status: false, statusCode: 403 });
        expect(await call(pages.deletePage, { uid: PEOPLE.guest, params: { id: String(own._id) } })).toMatchObject({ status: false, statusCode: 403 });
        expect(await call(pages.deletePage, { uid: PEOPLE.guest, params: { id: PAGES.closed } })).toMatchObject({ status: false, statusCode: 404 });
        expect(await name('guest', String(own._id), 'guest', 'editor')).toMatchObject({ status: false, statusCode: 403 });
        expect(mockDb.store[SCHEMA_TYPE.PAGES].filter((page) => page.deletedStatusKey === 1).map((page) => String(page._id))).toEqual([PAGES.deleted]);
    });

    it('still takes part in the comments of a doc they read', async () => {
        const listed = await call(pageComments.listComments, { uid: PEOPLE.guest, params: { id: PAGES.shared } });
        expect(listed.status).toBe(true);
    });
});

describe('a page under another page needs the right to change that page', () => {
    const create = (who, body) => call(pages.createPage, { uid: PEOPLE[who], body });
    const children = (pageId) => mockDb.store[SCHEMA_TYPE.PAGES].filter((page) => String(page.parentPageId || '') === pageId);

    it('refuses a person who only reads the parent, and answers not found to one who cannot open it', async () => {
        expect(await create('viewer', { title: 'Under', parentPageId: PAGES.namedView })).toMatchObject({ status: false, statusCode: 403 });
        expect(await create('outside', { title: 'Under', parentPageId: PAGES.namedView })).toMatchObject({ status: false, statusCode: 404 });
        expect(await create('outside', { title: 'Under', parentPageId: PAGES.closed })).toMatchObject({ status: false, statusCode: 404 });
        expect(children(PAGES.namedView)).toEqual([]);
        expect(children(PAGES.closed)).toEqual([]);
    });

    it('lets a person who may change the parent add to it', async () => {
        expect((await create('editor', { title: 'Under', parentPageId: PAGES.namedEdit })).status).toBe(true);
        expect((await create('outside', { title: 'Under', parentPageId: PAGES.shared, projectId: PROJECTS.open })).status).toBe(true);
        expect(children(PAGES.namedEdit)).toHaveLength(1);
        expect(children(PAGES.shared)).toHaveLength(1);
    });

    it('answers not found for a project the person cannot see', async () => {
        expect(await create('outside', { title: 'There', projectId: PROJECTS.closed })).toMatchObject({ status: false, statusCode: 404 });
    });
});
