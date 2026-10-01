const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { automationRulesSchema } = require('../utils/mongo-handler/createSchema');
const { driverWrites } = require('./fixtures/realTaskStore');
const domainEventBus = require('../event/domainEventBus');
const matcher = require('../Modules/Automations/engine/matcher');
const dueDates = require('../Modules/Automations/engine/dueDateTrigger');
const subtasks = require('../Modules/Automations/engine/subtaskTrigger');
const notices = require('../Modules/Automations/engine/noticeRecipients');

// fakeMongo keeps any field it is handed. These send what the engine writes through Mongoose and the
// real strict schemas, with nothing connected, and read what would reach MongoDB.

const C = '6f0000000000000000000c01';
const PROJECT = '6f0000000000000000000a01';
const PARENT = '6f0000000000000000000d01';
const SUBTASK = '6f0000000000000000000d02';
const RULE = '6f0000000000000000000b01';
const USER = '6f0000000000000000000011';
const NOW = new Date('2026-10-01T12:00:00.000Z');
const DUE = new Date('2026-10-01T11:00:00.000Z');

const Rule = mongoose.createConnection().model('automation_rules', automationRulesSchema, 'automation_rules');
let ruleWrites = [];
Rule.collection.findOneAndUpdate = async (...args) => { ruleWrites.push(args); return null; };

const callsOn = (type, method) => mockDb.calls.filter((c) => c.type === type && c.method === method);
const throughTaskSchema = async (call) => (await driverWrites(call.method, call.data)).writes[0].args;

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    matcher.invalidateAll();
    ruleWrites = [];
});

describe('the due date trigger against the task schema', () => {
    beforeEach(async () => {
        mockDb.seed(SCHEMA_TYPE.AUTOMATION_RULES, { enabled: true, deletedStatusKey: 0, version: 2, trigger: { type: 'event', event: 'task.due_date_passed' }, conditions: {}, steps: [] });
        mockDb.seed(SCHEMA_TYPE.TASKS, { _id: PARENT, TaskName: 'Report', TaskKey: 'WEB-1', CompanyId: C, ProjectID: PROJECT, isParentTask: true, statusType: 'active', deletedStatusKey: 0, DueDate: DUE });
        await dueDates.tickCompany(C, { now: NOW });
    });

    it('asks MongoDB for tasks whose due date is not the one already fired for', async () => {
        const [filter] = await throughTaskSchema(callsOn(SCHEMA_TYPE.TASKS, 'find')[0]);
        expect(filter.$expr).toEqual({ $ne: ['$DueDate', '$dueDatePassedFor'] });
        expect(filter.DueDate.$lte).toEqual(NOW);
        expect(filter.DueDate.$gt).toBeInstanceOf(Date);
    });

    it('stores the due date it fired for, as a date, without touching updatedAt', async () => {
        const [filter, update] = await throughTaskSchema(callsOn(SCHEMA_TYPE.TASKS, 'findOneAndUpdate')[0]);
        expect(update.$set.dueDatePassedFor).toEqual(DUE);
        expect(update.$set.updatedAt).toBeUndefined();
        expect(filter.dueDatePassedFor).toEqual({ $ne: DUE });
        expect(String(filter._id)).toBe(PARENT);
    });
});

describe('the subtasks trigger against the task schema', () => {
    it('stores its flag on the parent without touching updatedAt', async () => {
        mockDb.seed(SCHEMA_TYPE.TASKS, { _id: PARENT, TaskName: 'Launch', TaskKey: 'WEB-1', CompanyId: C, ProjectID: PROJECT, isParentTask: true, statusType: 'active', deletedStatusKey: 0 });
        const subtask = mockDb.seed(SCHEMA_TYPE.TASKS, { _id: SUBTASK, TaskName: 'Copy', TaskKey: 'WEB-1-a', CompanyId: C, ProjectID: PROJECT, isParentTask: false, ParentTaskId: PARENT, statusType: 'close', deletedStatusKey: 0 });
        await subtasks.onEnvelope(domainEventBus.buildEnvelope({ companyId: C, type: 'task.status_changed', doc: subtask, changedFields: new Set(['statusType']), previous: null, actor: { kind: 'user', userId: USER }, depth: 0 }));

        const [filter, update] = await throughTaskSchema(callsOn(SCHEMA_TYPE.TASKS, 'findOneAndUpdate')[0]);
        expect(update.$set).toEqual({ subtasksAllDone: true });
        expect(filter.subtasksAllDone).toEqual({ $ne: true });
        expect(String(filter._id)).toBe(PARENT);
    });
});

describe('the notify rate limit against the rule schema', () => {
    it('stores its counters under the rule without touching updatedAt', async () => {
        mockDb.seed(SCHEMA_TYPE.AUTOMATION_RULES, { _id: RULE, name: 'Tell', version: 2, deletedStatusKey: 0 });
        const hour = Math.floor(NOW.getTime() / (60 * 60 * 1000));
        const claimThroughSchema = async () => {
            mockDb.calls.length = 0;
            ruleWrites = [];
            expect(await notices.claimSlot(C, RULE, USER, NOW.getTime())).toBe(true);
            for (const call of callsOn(SCHEMA_TYPE.AUTOMATION_RULES, 'findOneAndUpdate')) {
                // eslint-disable-next-line no-await-in-loop
                await Rule.findOneAndUpdate(...call.data);
            }
            return ruleWrites.map(([, update]) => update);
        };

        const opening = await claimThroughSchema();
        expect(opening[opening.length - 1]).toEqual({ $set: { [`notifyWindows.${USER}`]: { hour, count: 1 } } });

        const next = await claimThroughSchema();
        expect(next).toEqual([{ $inc: { [`notifyWindows.${USER}.count`]: 1 } }]);
    });
});
