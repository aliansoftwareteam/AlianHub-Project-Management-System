jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Modules/Automations/engine/matcher', () => ({ match: jest.fn(), invalidateAll: jest.fn() }));
jest.mock('../Modules/Automations/engine/runner', () => ({ createRun: jest.fn(), execute: jest.fn() }));

const path = require('path');
const { spawnSync } = require('child_process');
const logger = require('../Config/loggerConfig');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const socketEmitter = require('../event/socketEventEmitter');
const domainEventBus = require('../event/domainEventBus');
const matcher = require('../Modules/Automations/engine/matcher');
const runner = require('../Modules/Automations/engine/runner');
const engine = require('../Modules/Automations/engine');
const { publishFormSubmitted } = require('../Modules/Automations/engine/formEvent');

const COMPANY_ID = '6a8ee973d625fca52e519a12';
const TASK_ID = '6f0000000000000000000701';
const PROJECT_ID = '6a9954186dd786246031e47b';
const RULE_A = '6f0000000000000000000b01';
const RULE_B = '6f0000000000000000000b02';
const DEBOUNCE_MS = 2000;
const CHILD = path.join(__dirname, 'fixtures', 'automationDispatchChild.js');

const taskDoc = () => ({ _id: TASK_ID, CompanyId: COMPANY_ID, ProjectID: PROJECT_ID, TaskName: 'Fix the thing', TaskKey: '--', Task_Priority: 'LOW' });

const writes = {
    'a created task': () => socketEmitter.emit('insert', { type: 'insert', module: 'task', data: taskDoc() }),
    'a priority change': () => socketEmitter.emit('update', { type: 'update', module: 'task', data: taskDoc(), updatedFields: { Task_Priority: 'HIGH' } }),
};

const formSubmission = () => ({ companyId: COMPANY_ID, form: { _id: 'f1', ProjectID: PROJECT_ID }, answers: [], task: { _id: TASK_ID, TaskKey: 'AR-1' }, actor: { kind: 'system' } });

const rejectWithoutReason = () => Promise.reject(undefined);
const settle = () => new Promise((resolve) => { setTimeout(resolve, 20); });
const loggedWith = (...ids) => logger.error.mock.calls.map(([line]) => String(line)).filter((line) => ids.every((id) => line.includes(id)));

function afterDebounce(write) {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    try {
        write();
        jest.advanceTimersByTime(DEBOUNCE_MS);
    } finally {
        jest.useRealTimers();
    }
    return settle();
}

beforeAll(async () => {
    process.env.AUTOMATION_QUEUE_DRIVER = 'inline';
    domainEventBus.start();
    await engine.start();
});

afterAll(async () => {
    await engine.stop();
    delete process.env.AUTOMATION_QUEUE_DRIVER;
});

beforeEach(() => {
    jest.resetAllMocks();
    domainEventBus.setRecording(false);
});

describe('automation dispatch rejections', () => {
    // Jest gives each test file its own process object, so an unhandledRejection listener here never fires; the child sees the real one.
    it('leaves the process without an unhandled rejection when the dispatcher rejects without a reason', () => {
        const child = spawnSync(process.execPath, [CHILD, COMPANY_ID, TASK_ID], {
            encoding: 'utf8',
            timeout: 30000,
            env: { ...process.env, AUTOMATION_ENGINE: 'true', AUTOMATION_QUEUE_DRIVER: 'inline', AUTOMATION_EVENT_LOG: 'false' },
        });

        expect({ status: child.status, stderr: child.stderr }).toMatchObject({ status: 0 });
        const { errors, unhandled } = JSON.parse(child.stdout);
        expect(unhandled).toEqual([]);
        expect(errors.filter((line) => line.includes(TASK_ID) && line.includes(COMPANY_ID))).toHaveLength(1);
    });

    describe.each(Object.keys(writes))('for %s', (name) => {
        it('logs a rejected rule lookup with the task and company ids', async () => {
            matcher.match.mockRejectedValue(new Error('rule store offline'));

            await afterDebounce(writes[name]);

            expect(matcher.match).toHaveBeenCalledTimes(1);
            expect(loggedWith(TASK_ID, COMPANY_ID, 'rule store offline')).toHaveLength(1);
        });

        it('logs a rejection without a reason with the task and company ids', async () => {
            matcher.match.mockImplementation(rejectWithoutReason);

            await afterDebounce(writes[name]);

            expect(loggedWith(TASK_ID, COMPANY_ID)).toHaveLength(1);
        });
    });

    it('still runs the other matching rules when one cannot be queued', async () => {
        matcher.match.mockResolvedValue([{ _id: RULE_A, name: 'A' }, { _id: RULE_B, name: 'B' }]);
        runner.createRun.mockRejectedValueOnce(new Error('write conflict')).mockResolvedValueOnce({ _id: 'run-b' });
        runner.execute.mockResolvedValue({ status: 'success' });

        await afterDebounce(writes['a created task']);

        expect(runner.execute).toHaveBeenCalledTimes(1);
        expect(runner.execute).toHaveBeenCalledWith(expect.objectContaining({ companyId: COMPANY_ID, runId: 'run-b', ruleId: RULE_B }));
        expect(loggedWith(TASK_ID, COMPANY_ID, RULE_A, 'write conflict')).toHaveLength(1);
    });

    it('logs a run that fails inside the inline queue with the rule, task and company ids', async () => {
        matcher.match.mockResolvedValue([{ _id: RULE_A, name: 'A' }]);
        runner.createRun.mockResolvedValue({ _id: 'run-a' });
        runner.execute.mockImplementation(rejectWithoutReason);

        await afterDebounce(writes['a created task']);

        expect(loggedWith(TASK_ID, COMPANY_ID, RULE_A)).toHaveLength(1);
    });

    it('logs a failed event-log write with the task and company ids', async () => {
        domainEventBus.setRecording(true);
        matcher.match.mockResolvedValue([]);
        MongoDbCrudOpration.mockImplementation(rejectWithoutReason);

        await afterDebounce(writes['a created task']);

        expect(loggedWith(TASK_ID, COMPANY_ID)).toHaveLength(1);
    });

    it('logs a listener that throws while a task event is published instead of throwing out of the timer', async () => {
        matcher.match.mockResolvedValue([]);
        domainEventBus.bus.once('task.created', () => { throw undefined; });

        await afterDebounce(writes['a created task']);

        expect(loggedWith(TASK_ID, COMPANY_ID)).toHaveLength(1);
    });

    it('logs a rejected dispatch for a form submission that filed a task', async () => {
        matcher.match.mockImplementation(rejectWithoutReason);

        publishFormSubmitted(formSubmission());
        await settle();

        expect(loggedWith(TASK_ID, COMPANY_ID)).toHaveLength(1);
    });

    it('logs a listener that throws while a form submission is published instead of failing the submission', () => {
        domainEventBus.bus.once('form.submitted', () => { throw undefined; });

        expect(publishFormSubmitted(formSubmission())).toBeNull();
        expect(loggedWith(TASK_ID, COMPANY_ID)).toHaveLength(1);
    });
});
