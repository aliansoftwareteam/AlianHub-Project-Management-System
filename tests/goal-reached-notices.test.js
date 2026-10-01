/* Task 046 M3: a notice when a target or a goal is first reached. It goes to the goal's owner and the
   people the goal is shared with who can still read it, once, and names the goal and the target only.
   The handlers and the count run over fakeMongo; the notification pipeline is the one stand-in. */
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/settings/securityPermissions/controller', () => ({ fetchRules: jest.fn(async () => []) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleSingleNotification: jest.fn(async () => []) }));

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { Notification_key, GOAL_NOTICE_SECTION, goalNoticeSection } = require('../Config/notificationKey');
const logger = require('../Config/loggerConfig');
const notices = require('../Modules/notification/prepare-notification-data/controllerV2');
const { ensureGoalNoticeSection, forgetHealedGoalNotices } = require('../Modules/notification/goalNotices');
const goals = require('../Modules/Goals/controller');
const counts = require('../Modules/Goals/goalCounts');
const reached = require('../Modules/Goals/goalReached');
const { schema } = require('../utils/mongo-handler/schema');

const C = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const AUTHOR = '6f0000000000000000000003';
const NAMED = '6f0000000000000000000004';
const COLLEAGUE = '6f0000000000000000000005';
const GUEST = '6f0000000000000000000006';
const LEFT = '6f0000000000000000000008';
const ROLES = { [OWNER]: 1, [ADMIN]: 2, [AUTHOR]: 3, [NAMED]: 3, [COLLEAGUE]: 3, [GUEST]: 0 };
const T0 = new Date('2026-10-01T10:00:00.000Z');
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

let seq = 0;
const nextId = (prefix) => `6f${prefix}${String(++seq).padStart(20, '0')}`;
const project = (over = {}) => mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: nextId('a0'), ProjectName: 'Website', isPrivateSpace: false, AssigneeUserId: [], deletedStatusKey: 0, ...over });
const list = (proj, over = {}) => String(mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id: nextId('b0'), projectId: String(proj._id), name: 'Launch list', private: false, AssigneeUserId: [], deletedStatusKey: 0, ...over })._id);
const task = (proj, sprintId, over = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, {
    _id: nextId('f0'), TaskName: 'Write the copy', TaskKey: 'WEB-1', ProjectID: String(proj._id), sprintId, deletedStatusKey: 0, isParentTask: true, statusType: 'default_active', ...over,
});

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
};
const settle = async () => { for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const call = async (handler, uid, { body, id, targetId } = {}) => {
    const res = response();
    await handler({ headers: { companyid: C }, aud: C, uid, body, query: {}, params: { id, targetId } }, res);
    await settle();
    return res;
};
const goalRow = (id) => (mockDb.store[SCHEMA_TYPE.GOALS] || []).find((row) => String(row._id) === id);
const BOXES = [{ name: 'Pricing page live', kind: 'boolean' }, { name: 'Docs written', kind: 'boolean' }];
const goal = async (uid, body = {}) => {
    const res = await call(goals.createGoal, uid, { body: { name: 'Launch the site', targets: BOXES, ...body } });
    return res.body.data;
};
const tick = (uid, made, index, done = true) => call(goals.setTargetValue, uid, { id: made._id, targetId: made.targets[index].id, body: { done } });
const sent = () => notices.handleSingleNotification.mock.calls.map(([body]) => body);
const told = () => sent().map((body) => [body.key, body.changeData.targetName || '', [...body.assigneeUsers].sort()]);
const after = (ms) => jest.setSystemTime(new Date(Date.now() + ms));

beforeEach(() => {
    jest.useFakeTimers({ now: T0, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    myCache.flushAll();
    jest.clearAllMocks();
    forgetHealedGoalNotices();
    counts.forgetTries();
    Object.entries(ROLES).forEach(([userId, roleType]) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false }));
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: LEFT, roleType: 3, status: 2, isDelete: true });
});

afterEach(async () => {
    await counts.idle();
    jest.useRealTimers();
});

describe('a target that is reached', () => {
    it('is told once, as a goal notice from whoever set it, naming the goal and the target', async () => {
        const made = await goal(AUTHOR, { visibility: 'people', sharedWith: [NAMED] });
        expect(sent()).toEqual([]);
        const res = await tick(AUTHOR, made, 0);
        expect(res.statusCode).toBe(200);
        expect(sent()).toEqual([{
            key: Notification_key.GOAL_TARGET_REACHED,
            type: 'goals',
            message: 'The target &quot;Pricing page live&quot; of the goal &quot;Launch the site&quot; is reached.',
            companyId: C,
            userId: AUTHOR,
            assigneeUsers: [AUTHOR, NAMED],
            notSeen: [AUTHOR, NAMED],
            directUsers: [AUTHOR, NAMED],
            isSelected: false,
            changeType: 'goal_reached',
            changeData: { goalId: made._id, goalName: 'Launch the site', targetId: made.targets[0].id, targetName: 'Pricing page live', byCount: false },
        }]);
        expect(goalRow(made._id).targets[0].notifiedAt).toEqual(T0);
        expect(goalRow(made._id).targets[1].notifiedAt).toBeUndefined();
    });

    it('is not told again by a write that leaves it reached', async () => {
        const made = await goal(AUTHOR, { targets: [{ name: 'Customers', kind: 'number', target: 10 }, BOXES[0]] });
        await call(goals.setTargetValue, AUTHOR, { id: made._id, targetId: made.targets[0].id, body: { current: 10 } });
        await call(goals.setTargetValue, AUTHOR, { id: made._id, targetId: made.targets[0].id, body: { current: 12 } });
        await call(goals.editTarget, AUTHOR, { id: made._id, targetId: made.targets[0].id, body: { name: 'New customers' } });
        expect(told()).toEqual([[Notification_key.GOAL_TARGET_REACHED, 'Customers', [AUTHOR]]]);
    });

    it('that falls back and arrives again is told again only a day after it last was', async () => {
        const made = await goal(AUTHOR);
        await tick(AUTHOR, made, 0);
        await tick(AUTHOR, made, 0, false);
        after(DAY - 1);
        await tick(AUTHOR, made, 0);
        expect(told()).toHaveLength(1);
        expect(goalRow(made._id).targets[0].notifiedAt).toEqual(T0);

        await tick(AUTHOR, made, 0, false);
        after(1);
        await tick(AUTHOR, made, 0);
        expect(told()).toHaveLength(2);
        expect(goalRow(made._id).targets[0].notifiedAt).toEqual(new Date(T0.getTime() + DAY));
    });

    it('made already reached is told when it is made', async () => {
        const made = await goal(AUTHOR, { visibility: 'people', sharedWith: [NAMED], targets: [{ name: 'Customers', kind: 'number', target: 10, current: 10 }, BOXES[0]] });
        expect(told()).toEqual([[Notification_key.GOAL_TARGET_REACHED, 'Customers', [AUTHOR, NAMED]]]);
        await call(goals.addTarget, AUTHOR, { id: made._id, body: { name: 'Revenue', kind: 'number', target: 5, current: 5 } });
        expect(told().map(([, name]) => name)).toEqual(['Customers', 'Revenue']);
    });
});

describe('a goal that is reached', () => {
    it('is told after its last target, once, and stores when', async () => {
        const made = await goal(AUTHOR, { visibility: 'people', sharedWith: [NAMED] });
        await tick(AUTHOR, made, 0);
        expect(goalRow(made._id).reachedAt).toBeNull();
        await tick(AUTHOR, made, 1);
        expect(told()).toEqual([
            [Notification_key.GOAL_TARGET_REACHED, 'Pricing page live', [AUTHOR, NAMED]],
            [Notification_key.GOAL_TARGET_REACHED, 'Docs written', [AUTHOR, NAMED]],
            [Notification_key.GOAL_REACHED, '', [AUTHOR, NAMED]],
        ]);
        expect(sent()[2]).toMatchObject({
            type: 'goals', userId: AUTHOR, changeType: 'goal_reached', message: 'The goal &quot;Launch the site&quot; is reached.',
            changeData: { goalId: made._id, goalName: 'Launch the site', byCount: false },
        });
        expect(Object.keys(sent()[2].changeData).sort()).toEqual(['byCount', 'goalId', 'goalName']);
        expect(goalRow(made._id)).toMatchObject({ progressPct: 100, reachedAt: T0, notifiedAt: T0 });

        await call(goals.updateGoal, AUTHOR, { id: made._id, body: { name: 'Launch the site, again' } });
        expect(told()).toHaveLength(3);
    });

    it('is told when the target that held it back is removed', async () => {
        const made = await goal(AUTHOR);
        await tick(AUTHOR, made, 0);
        await call(goals.removeTarget, AUTHOR, { id: made._id, targetId: made.targets[1].id });
        expect(told().map(([key]) => key)).toEqual([Notification_key.GOAL_TARGET_REACHED, Notification_key.GOAL_REACHED]);
    });

    it('that falls back clears when it was reached, and is told again only a day later', async () => {
        const made = await goal(AUTHOR, { targets: [BOXES[0]] });
        await tick(AUTHOR, made, 0);
        await tick(AUTHOR, made, 0, false);
        expect(goalRow(made._id)).toMatchObject({ reachedAt: null, notifiedAt: T0 });
        await tick(AUTHOR, made, 0);
        expect(told()).toHaveLength(2);
        expect(goalRow(made._id).reachedAt).toEqual(T0);

        await tick(AUTHOR, made, 0, false);
        after(DAY);
        await tick(AUTHOR, made, 0);
        expect(told()).toHaveLength(4);
    });

    it('with no target is never reached', () => {
        expect(reached.stamped({ targets: [], progressPct: 0 }, { targets: [], progressPct: 100 }).due).toEqual([]);
    });

    it('that was at 100% before notices existed is not told on its next write', async () => {
        const made = await goal(AUTHOR, { targets: [BOXES[0]] });
        await tick(AUTHOR, made, 0);
        const row = goalRow(made._id);
        delete row.reachedAt;
        delete row.notifiedAt;
        notices.handleSingleNotification.mockClear();
        await call(goals.editTarget, AUTHOR, { id: made._id, targetId: made.targets[0].id, body: { name: 'Renamed' } });
        expect(sent()).toEqual([]);
    });
});

describe('a count that reaches a target', () => {
    const counted = async (body = {}) => {
        const open = project();
        const openList = list(open);
        const row = task(open, openList);
        const made = await goal(AUTHOR, { visibility: 'people', sharedWith: [NAMED], targets: [{ name: 'Launch tasks', kind: 'tasks', sources: { sprintIds: [openList], taskIds: [String(row._id)] } }], ...body });
        return { made, open, openList, row };
    };
    const recount = async (id) => {
        after(10 * MINUTE);
        await call(goals.getGoal, AUTHOR, { id });
        await counts.idle();
        await settle();
    };

    it('tells everyone who reads the goal, in the goal\'s own name', async () => {
        const { made, row } = await counted();
        expect(sent()).toEqual([]);
        row.statusType = 'close';
        await recount(made._id);

        expect(told()).toEqual([
            [Notification_key.GOAL_TARGET_REACHED, 'Launch tasks', [AUTHOR, NAMED]],
            [Notification_key.GOAL_REACHED, '', [AUTHOR, NAMED]],
        ]);
        sent().forEach((body) => expect(body).toMatchObject({ userId: made._id, changeData: { byCount: true } }));
        expect(goalRow(made._id).targets[0].notifiedAt).toEqual(new Date(T0.getTime() + 10 * MINUTE));
    });

    it('names nothing the target is counted from', async () => {
        const { made, open, openList, row } = await counted();
        row.statusType = 'close';
        await recount(made._id);
        expect(sent()).toHaveLength(2);
        const payload = JSON.stringify(sent());
        ['Launch list', 'Write the copy', 'WEB-1', 'Website', openList, String(row._id), String(open._id)].forEach((text) => expect(payload).not.toContain(text));
        sent().forEach((body) => expect(Object.keys(body.changeData).sort()).toEqual(body.changeData.targetId ? ['byCount', 'goalId', 'goalName', 'targetId', 'targetName'] : ['byCount', 'goalId', 'goalName']));
    });

    it('tells nothing when the next count finds it still reached', async () => {
        const { made, row } = await counted();
        row.statusType = 'close';
        await recount(made._id);
        notices.handleSingleNotification.mockClear();
        await recount(made._id);
        await recount(made._id);
        expect(sent()).toEqual([]);
    });

    it('is told as the count\'s even when a person linked the last task', async () => {
        const { made, open, openList } = await counted();
        const closed = task(open, openList, { statusType: 'close' });
        await call(goals.editTarget, AUTHOR, { id: made._id, targetId: made.targets[0].id, body: { sources: { sprintIds: [], taskIds: [String(closed._id)] } } });
        expect(sent()[0]).toMatchObject({ key: Notification_key.GOAL_TARGET_REACHED, userId: made._id, changeData: { byCount: true } });
        expect(sent()[1]).toMatchObject({ key: Notification_key.GOAL_REACHED, userId: AUTHOR, changeData: { byCount: false } });
    });
});

describe('who is told', () => {
    const reachedBy = async (uid, body) => {
        const made = await goal(uid, body);
        notices.handleSingleNotification.mockClear();
        await tick(uid, made, 0);
        return sent()[0] ? [...sent()[0].assigneeUsers].sort() : null;
    };

    it('is the owner alone for a private goal', async () => {
        expect(await reachedBy(AUTHOR, {})).toEqual([AUTHOR]);
    });

    it('is the owner and the people named for a goal shared with people', async () => {
        expect(await reachedBy(AUTHOR, { visibility: 'people', sharedWith: [NAMED, GUEST] })).toEqual([AUTHOR, NAMED, GUEST].sort());
    });

    it('is the owner and the people named for a workspace goal, not the workspace', async () => {
        expect(await reachedBy(AUTHOR, { visibility: 'workspace', sharedWith: [GUEST] })).toEqual([AUTHOR, GUEST].sort());
    });

    it('leaves out someone named who no longer holds a seat', async () => {
        const made = await goal(AUTHOR, { visibility: 'people', sharedWith: [NAMED, COLLEAGUE] });
        mockDb.store[SCHEMA_TYPE.COMPANY_USERS].find((seat) => seat.userId === NAMED).isDelete = true;
        await tick(AUTHOR, made, 0);
        expect(sent()[0].assigneeUsers).toEqual([AUTHOR, COLLEAGUE]);
        expect(JSON.stringify(sent())).not.toContain(NAMED);
    });

    it('leaves out someone still named on a goal that has since become its owner\'s alone', async () => {
        const made = await goal(AUTHOR, { visibility: 'people', sharedWith: [NAMED] });
        Object.assign(goalRow(made._id), { visibility: 'private' });
        await tick(AUTHOR, made, 0);
        expect(sent()[0].assigneeUsers).toEqual([AUTHOR]);
    });

    it('leaves out the person a goal was handed over by, unless it is shared with them', async () => {
        const made = await goal(AUTHOR, { visibility: 'people', sharedWith: [NAMED] });
        await call(goals.updateGoal, AUTHOR, { id: made._id, body: { ownerUserId: COLLEAGUE } });
        await tick(COLLEAGUE, made, 0);
        expect([...sent()[0].assigneeUsers].sort()).toEqual([COLLEAGUE, NAMED].sort());
    });

    it('is nobody when the owner has no seat and nobody is named', async () => {
        const made = await goal(AUTHOR);
        mockDb.store[SCHEMA_TYPE.COMPANY_USERS].find((seat) => seat.userId === AUTHOR).isDelete = true;
        expect(await reached.tell(C, goalRow(made._id), [{ targetId: 't', targetName: 'T', byCount: true }])).toEqual([]);
        expect(sent()).toEqual([]);
    });
});

describe('a notice that cannot be sent', () => {
    it('does not fail the write that reached the target, and is logged', async () => {
        notices.handleSingleNotification.mockRejectedValueOnce(new Error('the pipeline is down'));
        const made = await goal(AUTHOR);
        const res = await tick(AUTHOR, made, 0);
        expect(res.statusCode).toBe(200);
        expect(res.body.data.targets[0]).toMatchObject({ done: true, progressPct: 100 });
        expect(logger.error).toHaveBeenCalledTimes(1);
    });
});

describe('the settings row', () => {
    it('is a Goals section with one switch for targets and one for goals, in-app by default', () => {
        expect(GOAL_NOTICE_SECTION).toMatchObject({ key: 'goals', sectionName: 'Goals' });
        expect(goalNoticeSection().items).toEqual([
            { name: 'Targets reached on my goals', email: false, browser: true, mobile: true, key: 'goal_target_reached' },
            { name: 'Goals reached', email: false, browser: true, mobile: true, key: 'goal_reached' },
        ]);
    });

    it('is added to the settings of everyone told, who had none, before the notice is sent', async () => {
        [AUTHOR, NAMED].forEach((userId) => mockDb.seed(SCHEMA_TYPE.NOTIFICATIONS_SETTINGS, { userId, tasks: { key: 'tasks', items: [] } }));
        const made = await goal(AUTHOR, { visibility: 'people', sharedWith: [NAMED] });
        await tick(AUTHOR, made, 0);
        mockDb.store[SCHEMA_TYPE.NOTIFICATIONS_SETTINGS].forEach((row) => expect(row.goals).toEqual(goalNoticeSection()));
    });

    it('gains an item it lacks without touching the switches already set', async () => {
        mockDb.seed(SCHEMA_TYPE.NOTIFICATIONS_SETTINGS, { userId: AUTHOR, goals: { key: 'goals', sectionName: 'Goals', items: [{ name: 'Goals reached', email: true, browser: false, mobile: true, key: 'goal_reached' }] } });
        await ensureGoalNoticeSection(C, [AUTHOR]);
        expect(mockDb.store[SCHEMA_TYPE.NOTIFICATIONS_SETTINGS][0].goals.items).toEqual([
            { name: 'Goals reached', email: true, browser: false, mobile: true, key: 'goal_reached' },
            { name: 'Targets reached on my goals', email: false, browser: true, mobile: true, key: 'goal_target_reached' },
        ]);
    });

    it('is given to a new person with their first settings, and to the settings page of an older one', () => {
        const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        expect(read('utils/data.js')).toContain('[GOAL_NOTICE_SECTION.key]: goalNoticeSection(),');
        expect(read('Modules/settings/settingNotifications/controller.js')).toContain('await ensureGoalNoticeSection(companyId, [id]);');
        expect(read('Modules/Inbox/controller.js')).toMatch(/STRUCTURED_CHANGES = \[[^\]]*'goal_reached'/);
    });
});

describe('the stored fields', () => {
    const { checkType } = jest.requireActual('../utils/mongo-handler/mongoQueries');

    it('are declared where the write puts them', () => {
        const Goal = mongoose.model('goal_reached_fit', checkType(SCHEMA_TYPE.GOALS));
        const kept = new Goal({
            name: 'N', ownerUserId: AUTHOR, visibility: 'private', reachedAt: T0, notifiedAt: T0,
            targets: [{ id: 't', name: 'T', kind: 'boolean', done: true, reachedAt: T0, notifiedAt: T0 }],
        }).toObject();
        expect(kept).toMatchObject({ reachedAt: T0, notifiedAt: T0, targets: [{ reachedAt: T0, notifiedAt: T0 }] });
        expect(schema.goals.targets.type[0].notifiedAt.type.name).toBe('Date');
    });

    it('include the Goals section of a person\'s notification settings', () => {
        const Settings = mongoose.model('goal_notice_settings_fit', checkType(SCHEMA_TYPE.NOTIFICATIONS_SETTINGS));
        const kept = new Settings({ userId: AUTHOR, project: {}, tasks: {}, chat: {}, goals: goalNoticeSection() }).toObject();
        expect(kept.goals).toEqual(goalNoticeSection());
    });
});
