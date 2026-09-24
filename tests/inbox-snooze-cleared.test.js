jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Modules/notification-count/controller', () => ({
    updateUnReadCommentsCountFun: jest.fn(() => Promise.resolve({ status: true })),
    updateCount: jest.fn((companyId, userIds, query, cb) => cb({ status: true })),
    updateMentionCount: jest.fn((companyId, userIds, field, cb) => cb({ status: true })),
}));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(() => Promise.resolve(3)), isPrivileged: () => false }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const counter = require('../Modules/notification-count/controller');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const R = require('../Modules/Inbox/helpers/inboxRules');
const ctrl = require('../Modules/Inbox/controller');
const state = require('../Modules/Inbox/helpers/inboxState');

const UID = '64b000000000000000000001';
const OTHER_UID = '64b000000000000000000002';
const N1 = '64a000000000000000000001';
const M1 = '64a000000000000000000002';
const DAY = 24 * 60 * 60 * 1000;

const reqOf = (body = {}, query = {}) => ({ uid: UID, headers: { companyid: 'c1' }, body, query });
const resOf = () => {
    const res = { send: jest.fn(), status: jest.fn(() => res), json: jest.fn() };
    return res;
};
const sent = (res) => res.send.mock.calls[0][0];
const callsOf = (method, type) => MongoDbCrudOpration.mock.calls
    .filter(([, q, m]) => m === method && (!type || q.type === type));
const filtersOf = (method, type) => callsOf(method, type).map(([, q]) => q.data[0]);
const json = (v) => JSON.stringify(v);

beforeEach(() => {
    MongoDbCrudOpration.mockReset();
    MongoDbCrudOpration.mockImplementation((companyId, q, method) => {
        if (method === 'updateOne' || method === 'updateMany') return Promise.resolve({ matchedCount: 1 });
        return Promise.resolve([]);
    });
    counter.updateCount.mockClear();
    counter.updateUnReadCommentsCountFun.mockClear();
});

describe('the notification and mention schemas', () => {
    const { notificationsSchema, mentionsSchema } = require('../utils/mongo-handler/createSchema');

    it('declares the snooze, clear and reason fields on a notification', () => {
        ['snoozedUntil', 'snoozeUntilChange', 'clearedAt', 'reason'].forEach((field) => expect(notificationsSchema.path(field)).toBeDefined());
        expect(notificationsSchema.path('snoozedUntil').instance).toBe('Date');
        expect(notificationsSchema.path('clearedAt').instance).toBe('Date');
    });

    it('declares the per-reader snooze and clear state on a mention', () => {
        ['snoozes', 'clearedFor', 'purgeAt'].forEach((field) => expect(mentionsSchema.path(field)).toBeDefined());
    });

    it('purges a cleared notification 30 days after it was cleared', () => {
        const ttl = notificationsSchema.indexes().find(([keys]) => keys.clearedAt === 1);
        expect(ttl).toBeDefined();
        expect(ttl[1].expireAfterSeconds).toBe(30 * 24 * 60 * 60);
        expect(R.CLEARED_RETENTION_SECONDS).toBe(30 * 24 * 60 * 60);
    });

    it('purges a mention once every reader has cleared it, at the time the last one set', () => {
        const ttl = mentionsSchema.indexes().find(([keys]) => keys.purgeAt === 1);
        expect(ttl).toBeDefined();
        expect(ttl[1].expireAfterSeconds).toBe(0);
    });
});

describe('which rows each tab reads', () => {
    const now = new Date('2026-09-24T10:00:00Z');

    it('always reads only the caller\'s own notifications', () => {
        R.INBOX_TABS.forEach((tab) => {
            expect(json(R.notificationMatch(UID, { tab, now }))).toContain(`"receiverID":"${UID}"`);
            expect(json(R.mentionMatch(UID, { tab, now }))).toContain(UID);
        });
    });

    it('keeps watched-only updates out of Primary and puts them in Other', () => {
        expect(json(R.notificationMatch(UID, { tab: 'primary', now }))).toContain('{"reason":{"$ne":"watching"}}');
        expect(json(R.notificationMatch(UID, { tab: 'other', now }))).toContain('{"reason":"watching"}');
        expect(R.planFor('other').mentions).toBe(false);
    });

    it('shows snoozed rows only in Later', () => {
        const later = R.notificationMatch(UID, { tab: 'later', now });
        const primary = R.notificationMatch(UID, { tab: 'primary', now });
        expect(json(later)).toContain(`{"snoozedUntil":{"$gt":"${now.toISOString()}"}}`);
        expect(json(later)).toContain('{"snoozeUntilChange":true}');
        expect(json(primary)).toContain('"$nor"');
        expect(json(R.mentionMatch(UID, { tab: 'later', now }))).toContain('"snoozes":{"$elemMatch"');
    });

    it('shows cleared rows only in Cleared, and only for 30 days', () => {
        const cutoff = new Date(now.getTime() - 30 * DAY).toISOString();
        expect(json(R.notificationMatch(UID, { tab: 'cleared', now }))).toContain(`{"clearedAt":{"$gte":"${cutoff}"}}`);
        expect(json(R.notificationMatch(UID, { tab: 'primary', now }))).toContain('{"clearedAt":null}');
        expect(json(R.mentionMatch(UID, { tab: 'cleared', now }))).toContain(`"clearedFor":{"$elemMatch":{"userId":"${UID}","at":{"$gte":"${cutoff}"}}}`);
    });
});

describe('snooze times', () => {
    const now = new Date('2026-09-24T10:00:00Z');

    it('accepts a future time or "until it changes"', () => {
        expect(R.parseSnooze({ until: '2026-09-25T09:00:00Z' }, now)).toEqual({ ok: true, until: new Date('2026-09-25T09:00:00Z'), untilChange: false });
        expect(R.parseSnooze({ untilChange: true }, now)).toEqual({ ok: true, until: null, untilChange: true });
    });

    it('refuses a missing, past, unreadable or far-off time', () => {
        expect(R.parseSnooze({}, now).ok).toBe(false);
        expect(R.parseSnooze({ until: '2026-09-24T09:00:00Z' }, now).ok).toBe(false);
        expect(R.parseSnooze({ until: 'soon' }, now).ok).toBe(false);
        expect(R.parseSnooze({ until: '2028-01-01T00:00:00Z' }, now).ok).toBe(false);
    });
});

describe('snooze, unsnooze, clear and restore act only on the caller\'s own rows', () => {
    const items = [{ sourceType: 'notification', sourceId: N1 }, { sourceType: 'mention', sourceId: M1 }];

    it('snooze writes only rows addressed to req.uid, whatever the body claims', async () => {
        const res = resOf();
        await ctrl.snooze(reqOf({ items, until: new Date(Date.now() + DAY).toISOString(), userId: OTHER_UID }), res);
        expect(sent(res).status).toBe(true);
        const notes = filtersOf('updateOne', SCHEMA_TYPE.NOTIFICATIONS);
        const mentions = filtersOf('updateOne', SCHEMA_TYPE.MENTIONS);
        expect(notes.length).toBeGreaterThan(0);
        expect(mentions.length).toBeGreaterThan(0);
        notes.forEach((f) => expect(f).toEqual(expect.objectContaining({ receiverID: UID })));
        mentions.forEach((f) => expect(f).toEqual(expect.objectContaining({ mentionIds: UID })));
        expect(json(MongoDbCrudOpration.mock.calls)).not.toContain(OTHER_UID);
    });

    it('snooze stores the return time, and a mention keeps it per reader', async () => {
        const until = new Date(Date.now() + DAY);
        await ctrl.snooze(reqOf({ items, until: until.toISOString() }), resOf());
        const noteUpdates = callsOf('updateOne', SCHEMA_TYPE.NOTIFICATIONS).map(([, q]) => q.data[1]);
        expect(noteUpdates.some((u) => u.$set && +u.$set.snoozedUntil === +until)).toBe(true);
        const mentionUpdates = callsOf('updateOne', SCHEMA_TYPE.MENTIONS).map(([, q]) => q.data[1]);
        expect(mentionUpdates.some((u) => u.$push && u.$push.snoozes && u.$push.snoozes.userId === UID && +u.$push.snoozes.until === +until)).toBe(true);
    });

    it('snooze refuses a time in the past without writing', async () => {
        const res = resOf();
        await ctrl.snooze(reqOf({ items, until: new Date(Date.now() - DAY).toISOString() }), res);
        expect(sent(res).status).toBe(false);
        expect(callsOf('updateOne')).toHaveLength(0);
    });

    it('unsnooze returns the row to Primary as unread for the caller only', async () => {
        await ctrl.unsnooze(reqOf({ items }), resOf());
        filtersOf('updateOne', SCHEMA_TYPE.NOTIFICATIONS).forEach((f) => expect(f).toEqual(expect.objectContaining({ receiverID: UID })));
        filtersOf('updateOne', SCHEMA_TYPE.MENTIONS).forEach((f) => expect(f).toEqual(expect.objectContaining({ mentionIds: UID })));
        const updates = callsOf('updateOne').map(([, q]) => q.data[1]);
        expect(updates.some((u) => u.$addToSet && u.$addToSet.notSeen === UID)).toBe(true);
    });

    it('clear stamps a notification and takes the caller off a mention', async () => {
        const res = resOf();
        await ctrl.clear(reqOf({ items }), res);
        expect(sent(res).status).toBe(true);
        filtersOf('updateOne', SCHEMA_TYPE.NOTIFICATIONS).forEach((f) => expect(f).toEqual(expect.objectContaining({ receiverID: UID })));
        const noteUpdates = callsOf('updateOne', SCHEMA_TYPE.NOTIFICATIONS).map(([, q]) => q.data[1]);
        expect(noteUpdates.some((u) => u.$set && u.$set.clearedAt instanceof Date)).toBe(true);
        const mentionUpdates = callsOf('updateOne', SCHEMA_TYPE.MENTIONS).map(([, q]) => q.data[1]);
        expect(mentionUpdates.some((u) => u.$pull && u.$pull.mentionIds === UID && u.$push && u.$push.clearedFor.userId === UID)).toBe(true);
    });

    it('restore only brings back rows the caller cleared', async () => {
        await ctrl.restore(reqOf({ items }), resOf());
        filtersOf('updateOne', SCHEMA_TYPE.NOTIFICATIONS).forEach((f) => expect(f).toEqual(expect.objectContaining({ receiverID: UID })));
        filtersOf('updateOne', SCHEMA_TYPE.MENTIONS).forEach((f) => expect(json(f)).toContain(`"clearedFor":{"$elemMatch":{"userId":"${UID}"`));
        const updates = callsOf('updateOne', SCHEMA_TYPE.MENTIONS).map(([, q]) => q.data[1]);
        expect(updates.some((u) => u.$addToSet && u.$addToSet.mentionIds === UID)).toBe(true);
    });

    it('clear all acts on the current tab of the caller\'s own inbox', async () => {
        const res = resOf();
        await ctrl.clearAll(reqOf({ tab: 'other', userId: OTHER_UID }), res);
        expect(sent(res).status).toBe(true);
        const notes = filtersOf('updateMany', SCHEMA_TYPE.NOTIFICATIONS);
        expect(notes.length).toBeGreaterThan(0);
        notes.forEach((f) => {
            expect(json(f)).toContain(`"receiverID":"${UID}"`);
            expect(json(f)).toContain('{"reason":"watching"}');
        });
        expect(filtersOf('updateMany', SCHEMA_TYPE.MENTIONS)).toHaveLength(0);
        expect(json(MongoDbCrudOpration.mock.calls)).not.toContain(OTHER_UID);
    });

    it('clear all refuses the Cleared tab', async () => {
        const res = resOf();
        await ctrl.clearAll(reqOf({ tab: 'cleared' }), res);
        expect(sent(res).status).toBe(false);
        expect(callsOf('updateMany')).toHaveLength(0);
    });

    it('every action refuses a caller with no session user', async () => {
        for (const action of ['snooze', 'unsnooze', 'clear', 'restore', 'clearAll']) {
            const res = resOf();
            await ctrl[action]({ headers: { companyid: 'c1' }, body: { items, untilChange: true, tab: 'primary' }, query: {} }, res);
            expect(sent(res).status).toBe(false);
        }
        expect(callsOf('updateOne')).toHaveLength(0);
        expect(callsOf('updateMany')).toHaveLength(0);
    });
});

describe('a snoozed row returns when it is due', () => {
    it('wakes the caller\'s due rows as unread, and nobody else\'s', async () => {
        const now = new Date('2026-09-24T10:00:00Z');
        await state.wakeDue('c1', UID, now);
        const notes = callsOf('updateMany', SCHEMA_TYPE.NOTIFICATIONS).map(([, q]) => q.data);
        expect(notes.length).toBeGreaterThan(0);
        notes.forEach(([filter]) => {
            expect(filter.receiverID).toBe(UID);
            expect(filter.snoozedUntil).toEqual({ $lte: now });
        });
        expect(notes.some(([, update]) => update.$addToSet && update.$addToSet.notSeen === UID)).toBe(true);
        const mentions = callsOf('updateMany', SCHEMA_TYPE.MENTIONS).map(([, q]) => q.data);
        expect(mentions.length).toBeGreaterThan(0);
        mentions.forEach(([filter]) => expect(json(filter)).toContain(`"snoozes":{"$elemMatch":{"userId":"${UID}"`));
    });

    it('moves the unread counter up by the rows it woke', async () => {
        MongoDbCrudOpration.mockImplementation((c, q, method) => Promise.resolve(method === 'updateMany' ? { matchedCount: 2 } : []));
        await state.wakeDue('c1', UID, new Date());
        const incs = counter.updateCount.mock.calls.map(([, users, query]) => [users, query.$inc]);
        expect(incs).toContainEqual([[UID], { notification_counts: 2 }]);
    });

    it('the list wakes due rows before it reads', async () => {
        const res = resOf();
        await ctrl.list(reqOf({}, { tab: 'primary' }), res);
        const methods = MongoDbCrudOpration.mock.calls.map(([, q, m]) => `${m}:${q.type}`);
        const firstWake = methods.indexOf(`updateMany:${SCHEMA_TYPE.NOTIFICATIONS}`);
        const firstRead = methods.indexOf(`aggregate:${SCHEMA_TYPE.NOTIFICATIONS}`);
        expect(firstWake).toBeGreaterThanOrEqual(0);
        expect(firstWake).toBeLessThan(firstRead);
    });

    it('new activity on an item wakes that reader\'s "until it changes" snoozes on it', async () => {
        await state.wakeOnActivity('c1', UID, 'task-1', N1);
        const notes = filtersOf('updateMany', SCHEMA_TYPE.NOTIFICATIONS);
        expect(notes.length).toBeGreaterThan(0);
        notes.forEach((f) => expect(f).toEqual(expect.objectContaining({ receiverID: UID, taskId: 'task-1', snoozeUntilChange: true })));
        filtersOf('updateMany', SCHEMA_TYPE.MENTIONS).forEach((f) => expect(json(f)).toContain('"untilChange":true'));
    });
});

describe('the "Other" rule: updates that reached the reader only because they watch the item', () => {
    const notify = require('../Modules/Tasks/helpers/handleNotification');
    const prepare = require('../Modules/notification/prepare-notification-data/controllerV2');

    it('counts a task\'s creator, assignees and anyone mentioned as directly involved', () => {
        const direct = notify.directUsersFor({
            type: 'tasks',
            taskData: { Task_Leader: 'lead', AssigneeUserId: ['a1', 'a2'], watchers: ['w1'] },
            mentionUserId: ['m1'],
        });
        expect(direct.sort()).toEqual(['a1', 'a2', 'lead', 'm1']);
    });

    it('counts a project\'s leads and anyone mentioned as directly involved', () => {
        const direct = notify.directUsersFor({ type: 'project', projectData: { LeadUserId: ['l1'], AssigneeUserId: ['p1'] }, mentionUserId: [] });
        expect(direct).toEqual(['l1']);
    });

    it('leaves chat and other rows without a reason, so they stay in Primary', () => {
        expect(notify.directUsersFor({ type: 'chat' })).toBeUndefined();
        expect(R.reasonFor('u', undefined)).toBeUndefined();
        expect(R.reasonFor('u', ['u'])).toBe('direct');
        expect(R.reasonFor('u', ['x'])).toBe('watching');
    });

    it('stamps each recipient\'s row with its own reason', async () => {
        const settings = ['w1', 'a1'].map((userId) => ({ userId, tasks: { items: [{ key: 'task_status', browser: true, email: false }] } }));
        const spy = jest.spyOn(prepare, 'createNotificationsData').mockResolvedValue({});
        jest.spyOn(require('../Modules/notification/prepare-notification-data/user-controllerV2'), 'getUsersDetails').mockResolvedValue([{ _id: 'w1' }, { _id: 'a1' }, { _id: 'sender' }]);
        jest.spyOn(prepare, 'getWasabiImageUrl').mockResolvedValue('');
        const rows = await prepare.manageNotificationSettings({
            key: 'task_status', type: 'tasks', userId: 'sender', companyId: 'c1', assigneeUsers: ['w1', 'a1'], directUsers: ['a1'],
        }, settings);
        const byReceiver = Object.fromEntries(rows.map((r) => [r.receiverID, r]));
        expect(byReceiver.w1.reason).toBe('watching');
        expect(byReceiver.a1.reason).toBe('direct');
        expect(rows.every((r) => !('directUsers' in r))).toBe(true);
        spy.mockRestore();
    });
});
